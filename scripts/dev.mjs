import { spawn } from 'node:child_process';
import { createServer as createPortProbe } from 'node:net';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const specs = [ ['order',3101], ['query',3102], ['driver',3103], ['dispatch',3104], ['pricing',3105], ['gateway',8083] ];
const ports = Object.fromEntries(specs.map(([name, port]) => [name, Number(process.env[`${name.toUpperCase()}_PORT`] || port)]));
const host = process.env.HOST || '127.0.0.1';
const dataDirectory = path.resolve(process.env.DATA_DIR || 'data');
const urls = Object.fromEntries(specs.map(([name]) => [`${name.toUpperCase()}_URL`, `http://127.0.0.1:${ports[name]}`]));
// Refuse a duplicate launch before spawning children or replacing the process record.
for (const [name] of specs) {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => {
    probe.once('error', error => reject(new Error(`${name} 端口 ${ports[name]} 已被占用或不可监听（${error.code}）。请先访问现有网页或停止之前的启动组。`)));
    probe.listen(ports[name], host, () => probe.close(resolve));
  });
}
const children = [];
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  for (const { child } of children) if (!child.killed) child.kill('SIGTERM');
}
for (const [name] of specs) {
  const child = spawn(process.execPath, [path.join(root, 'services', name, 'main.mjs')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, ...urls, HOST: host, PORT: String(ports[name]), DB_PATH: path.join(dataDirectory, `${name}.sqlite`) },
  });
  children.push({ name, child });
  child.on('error', error => { console.error(`${name}: ${error.message}`); stop(); process.exitCode = 1; });
  child.on('exit', code => { if (!stopping && code !== 0) { console.error(`${name} exited (${code}); stopping this launch group.`); stop(); process.exitCode = 1; } });
}
mkdirSync(path.join(root, '.runtime'), { recursive: true });
writeFileSync(path.join(root, '.runtime', 'processes.json'), JSON.stringify({ started_at: new Date().toISOString(), supervisor_pid: process.pid, services: children.map(({ name, child }) => ({ name, pid: child.pid, port: ports[name] })) }, null, 2));
console.log(`沪行已启动 5 个业务进程与网关。浏览器：http://localhost:${ports.gateway} ；Ctrl+C 停止，数据保留。`);
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
