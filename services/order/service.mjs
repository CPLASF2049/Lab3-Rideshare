import { openDb } from '../../common/db.mjs';
import { config } from '../../common/config.mjs';
import { createServer, httpJson, log } from '../../common/http.mjs';
import { OrderRepository } from './infrastructure/repository.mjs';
import { OrderApplication } from './application/order-service.mjs';
import { orderRoutes } from './interfaces/routes.mjs';

export function createOrder(options = {}) {
  const cfg = { ...config('order', 3101), ...options };
  const db = openDb(cfg.dbPath);
  const repository = new OrderRepository(db, ['query', 'dispatch']);
  const enc = encodeURIComponent;
  const clients = options.clients || {
    getEstimate: id => httpJson(`${cfg.pricingUrl}/internal/estimates/${enc(id)}`),
    getOffer: id => httpJson(`${cfg.dispatchUrl}/internal/offers/${enc(id)}`),
    claimOffer: p => httpJson(`${cfg.dispatchUrl}/internal/offers/${enc(p.offer_id)}/claim`, { method: 'POST', body: p }),
    reserveDriver: p => httpJson(`${cfg.driverUrl}/internal/drivers/${enc(p.driver_id)}/reserve`, { method: 'POST', body: p }),
    releaseDriver: p => httpJson(`${cfg.driverUrl}/internal/drivers/${enc(p.driver_id)}/release`, { method: 'POST', body: p }),
    resolveOffer: p => httpJson(`${cfg.dispatchUrl}/internal/offers/${enc(p.offer_id)}/resolve`, { method: 'POST', body: p }),
    calculateFare: p => httpJson(`${cfg.pricingUrl}/internal/fare`, { method: 'POST', body: p }),
    publish: (destination, event) => httpJson(`${destination === 'query' ? cfg.queryUrl : cfg.dispatchUrl}/internal/events`, { method: 'POST', body: event }),
  };
  const app = new OrderApplication({ repository, clients, clock: options.clock });
  const server = createServer({ service: 'order', routes: orderRoutes(app, repository) });
  let timer; let ticking = false; let closing = false; let currentTick = Promise.resolve();
  async function tick() {
    if (ticking || closing) return;
    ticking = true;
    currentTick = (async () => {
      await Promise.all(repository.dueJobs().map(job => app.runJob(job.id)));
      await Promise.all(repository.pendingOutbox().map(async event => {
        try {
          await clients.publish(event.destination, JSON.parse(event.payload)); repository.delivered(event);
        } catch (error) {
          repository.retryEvent(event, error);
          log('order', 'outbox_retry', { order_id: JSON.parse(event.payload).aggregate_id, event_id: event.event_id, destination: event.destination, attempt: event.attempts + 1, code: error.code || error.message });
        }
      }));
    })();
    try { await currentTick; } finally { ticking = false; }
  }
  function startWorkers() {
    if (timer) return;
    timer = setInterval(() => { tick().catch(e => log('order', 'worker_error', { message: e.message })); }, options.tickMs || 250);
    void tick();
  }
  async function close() {
    closing = true; clearInterval(timer); await currentTick;
    if (server.listening) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    db.close();
  }
  return { server, db, repository, app, tick, startWorkers, close };
}
