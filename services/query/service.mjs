import { openDb, migrate, transaction, now } from '../../common/db.mjs';
import { config } from '../../common/config.mjs';
import { createServer, HttpError, httpJson, response, log } from '../../common/http.mjs';
import { validateOrderEvent } from '../../common/order-event.mjs';

const activeSql = "('MATCHING','ASSIGNING','ACCEPTED','ARRIVED','IN_PROGRESS')";
export function createQuery(options = {}) {
  const cfg = { ...config('query', 3102), ...options };
  const db = openDb(cfg.dbPath);
  migrate(db, `
    CREATE TABLE IF NOT EXISTS order_views (
      id TEXT PRIMARY KEY, rider_id TEXT NOT NULL, driver_id TEXT, status TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL, projected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rider_history ON order_views(rider_id);
    CREATE INDEX IF NOT EXISTS driver_current ON order_views(driver_id,status);
    CREATE TABLE IF NOT EXISTS inbox (
      event_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version INTEGER NOT NULL, processed_at TEXT NOT NULL
    );
  `);
  const getDriver = options.getDriver || (id => httpJson(`${cfg.driverUrl}/internal/drivers/${encodeURIComponent(id)}`));
  async function loadDriver(id) {
    const { driver } = await getDriver(id) || {};
    if (!driver || typeof driver !== 'object' || Array.isArray(driver) || driver.id !== id) {
      throw new HttpError(502, 'BAD_UPSTREAM_RESPONSE', '司机资料格式无效');
    }
    return driver;
  }
  function project(event) {
    validateOrderEvent(event);
    const d = event.data;
    return transaction(db, () => {
      if (db.prepare('SELECT 1 FROM inbox WHERE event_id=?').get(event.event_id)) return { duplicate: true, applied: false };
      const result = db.prepare(`INSERT INTO order_views(id,rider_id,driver_id,status,version,snapshot,projected_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET rider_id=excluded.rider_id,driver_id=excluded.driver_id,status=excluded.status,
        version=excluded.version,snapshot=excluded.snapshot,projected_at=excluded.projected_at WHERE excluded.version>order_views.version`).run(d.id, d.rider_id, d.driver_id || null, d.status, d.version, JSON.stringify(d), now());
      db.prepare('INSERT INTO inbox VALUES(?,?,?,?)').run(event.event_id, d.id, event.version, now());
      log('query', 'event_projected', { order_id: d.id, event_id: event.event_id, version: d.version, applied: result.changes === 1 });
      return { duplicate: false, applied: result.changes === 1 };
    });
  }
  function authorize(order, actor) {
    if (actor.role === 'RIDER' ? order.rider_id !== actor.id : order.driver_id !== actor.id && order.pending_driver_id !== actor.id) throw new HttpError(403, 'NOT_YOUR_ORDER', '只能查询自己的订单');
  }
  const find = id => {
    const row = db.prepare('SELECT snapshot,projected_at FROM order_views WHERE id=?').get(id);
    return row ? { order: JSON.parse(row.snapshot), projected_at: row.projected_at } : null;
  };
  async function combine(found, minVersion = 0, initialWarnings = []) {
    const { order, projected_at } = found;
    let driver = null; const warnings = [...initialWarnings];
    if (order.driver_id) {
      try { driver = await loadDriver(order.driver_id); }
      catch { warnings.push({ code: 'DRIVER_UNAVAILABLE', message: '司机资料暂时不可用；订单状态仍可查看和操作，请稍后刷新。' }); }
    }
    return { order, driver, projection_version: order.version, projected_at, sync_pending: order.version < minVersion, partial: warnings.length > 0, warnings };
  }
  const routes = [
    { method: 'GET', path: '/health', role: 'PUBLIC', handler: () => ({ status: 'ok', service: 'query', database: db.prepare('SELECT 1 AS ok').get().ok === 1 ? 'ok' : 'error' }) },
    { method: 'POST', path: '/internal/events', role: 'INTERNAL', handler: c => project(c.body) },
    { method: 'GET', path: '/orders/history', role: 'RIDER', handler: c => ({ orders: db.prepare('SELECT snapshot FROM order_views WHERE rider_id=? ORDER BY json_extract(snapshot,\'$.created_at\') DESC LIMIT 100').all(c.actor.id).map(r => JSON.parse(r.snapshot)), source: 'order-query', eventual_consistency: true }) },
    { method: 'GET', path: '/orders/current', role: 'ANY', handler: async c => {
      let found; const warnings = [];
      if (c.actor.role === 'DRIVER') {
        try {
          const driver = await loadDriver(c.actor.id);
          if (!driver.active_order_id) return { order: null, sync_pending: false, partial: false, warnings };
          found = find(driver.active_order_id);
          if (!found) return response(202, { order: null, sync_pending: true, partial: false, warnings });
        } catch {
          warnings.push({ code: 'DRIVER_UNAVAILABLE', message: '当前司机状态暂时无法确认，显示最近同步的订单。' });
          const row = db.prepare(`SELECT id FROM order_views WHERE driver_id=? AND status IN ${activeSql} ORDER BY json_extract(snapshot,'$.created_at') DESC,id DESC LIMIT 1`).get(c.actor.id);
          found = row ? find(row.id) : null;
        }
      } else {
        const row = db.prepare(`SELECT id FROM order_views WHERE rider_id=? AND status IN ${activeSql} ORDER BY json_extract(snapshot,'$.created_at') DESC LIMIT 1`).get(c.actor.id);
        found = row ? find(row.id) : null;
      }
      if (!found) return { order: null, partial: warnings.length > 0, sync_pending: false, warnings };
      authorize(found.order, c.actor); return combine(found, 0, warnings);
    } },
    { method: 'GET', path: '/orders/:id', role: 'ANY', handler: async c => {
      const minVersion = Number(c.query.get('min_version') || 0);
      if (!Number.isSafeInteger(minVersion) || minVersion < 0) throw new HttpError(400, 'INVALID_VERSION', '查询版本须为非负整数');
      const found = find(c.params.id);
      if (!found) {
        if (minVersion > 0) return response(202, { order: null, sync_pending: true, partial: false, warnings: [] });
        throw new HttpError(404, 'ORDER_NOT_FOUND', '订单尚未同步或不存在，请稍后刷新');
      }
      authorize(found.order, c.actor);
      const result = await combine(found, minVersion);
      return result.sync_pending ? response(202, result) : result;
    } },
  ];
  const server = createServer({ service: 'query', routes });
  async function close() {
    if (server.listening) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    db.close();
  }
  return { server, db, project, close };
}
