import { config } from '../../common/config.mjs';
import { log } from '../../common/http.mjs';
import { createOrder } from './service.mjs';

const cfg = config('order', 3101);
const service = createOrder(cfg);
service.server.listen(cfg.port, cfg.host, () => {
  log('order', 'listening', { host: cfg.host, port: cfg.port }); service.startWorkers();
});
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await service.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
