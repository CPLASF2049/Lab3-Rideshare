import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../../common/config.mjs';
import { createDispatch } from './service.mjs';

export { createDispatch } from './service.mjs';

export function main() {
  const settings = config('dispatch', 3104);
  const service = createDispatch(settings);
  service.server.listen(settings.port, settings.host, () => {
    console.log(JSON.stringify({ service: 'dispatch', order_id: null, action: 'listening', port: service.server.address().port }));
  });
  service.startWorkers();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => { process.exitCode = 0; }));
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
