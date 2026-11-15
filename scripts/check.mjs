import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required for built-in SQLite.');
let checked = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['vendor','.git','.runtime','data','node_modules'].includes(item.name)) continue;
    const absolute = path.join(dir, item.name);
    if (item.isDirectory()) walk(absolute);
    else if (/\.(mjs|js)$/.test(item.name)) {
      const result = spawnSync(process.execPath, ['--check', absolute], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw result.error || new Error(`Syntax error: ${path.relative(root, absolute)}`);
      checked++;
    }
  }
}
walk(root);
for (const file of ['README.md','docs/report.md','docs/architecture.png','docs/data-model.png','compose.yaml','frontend/vendor/leaflet/LICENSE']) {
  if (!existsSync(path.join(root, file))) throw new Error(`Missing deliverable: ${file}`);
}
const contract = JSON.parse(readFileSync(path.join(root, 'contracts', 'openapi.json'), 'utf8'));
function validateReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    let target = contract;
    for (const token of value.$ref.slice(2).split('/')) target = target?.[token.replaceAll('~1','/').replaceAll('~0','~')];
    if (!target) throw new Error(`Unresolved OpenAPI reference: ${value.$ref}`);
  }
  for (const child of Object.values(value)) validateReferences(child);
}
validateReferences(contract);
const operations = Object.values(contract.paths).flatMap(p => Object.values(p));
if (new Set(operations.map(o => o.operationId)).size !== operations.length) throw new Error('Duplicate OpenAPI operationId');
console.log(`PASS: ${checked} JavaScript modules parse; ${operations.length} API operations and references are consistent; required deliverables exist; Node ${process.version}.`);
