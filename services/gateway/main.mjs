import { config } from '../../common/config.mjs';
import { createGateway } from './service.mjs';

const settings = config('gateway', 8083);
const gateway = createGateway(settings);
gateway.server.listen(settings.port, settings.host, () => {
  console.log(JSON.stringify({ service: 'gateway', action: 'listening', host: settings.host, port: settings.port }));
});
gateway.server.on('error', (error) => {
  console.error(JSON.stringify({ service: 'gateway', action: 'server_error', message: error.message }));
  process.exitCode = 1;
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await gateway.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
