import { config } from '../../common/config.mjs';
import { log } from '../../common/http.mjs';
import { createQuery } from './service.mjs';

const cfg = config('query', 3102);
const service = createQuery(cfg);
service.server.listen(cfg.port, cfg.host, () => log('query', 'listening', { host: cfg.host, port: cfg.port }));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await service.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
