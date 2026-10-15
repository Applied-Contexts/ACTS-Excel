import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'acts-host-check-'));
const market = 'acts-excel-verify-' + Date.now();
const pluginRoot = join(root, 'acts-excel');
const files = unzipSync(await readFile(join('release', `ACTS-Excel-${pkg.version}-chatgpt.zip`)));
for (const [name, bytes] of Object.entries(files)) {
  const file = join(pluginRoot, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
for (const file of ['mcp.json', '.mcp.json']) {
  const config = JSON.parse(await readFile(join(pluginRoot, file), 'utf8'));
  const server = config.mcpServers['acts-excel'];
  server.env = { npm_config_cache: join(root, 'npm-cache'), ACTS_EXCEL_HOME: join(root, 'data') };
  await writeFile(join(pluginRoot, file), JSON.stringify(config));
}
await mkdir(join(root, '.agents/plugins'), { recursive: true });
await mkdir(join(root, '.git'));
const marketplacePath = join(root, '.agents/plugins/marketplace.json');
await writeFile(marketplacePath, JSON.stringify({ name: market, plugins: [{ name: 'acts-excel', source: { source: 'local', path: './acts-excel' } }] }));
const child = spawn(process.env.ACTS_TEST_CODEX || 'codex', ['app-server', '--enable', 'plugins'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let sequence = 0;
const pending = new Map();
child.stderr.resume();
child.once('error', error => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
});
createInterface({ input: child.stdout }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
const send = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 120000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
let installed = false;
let uninstalled = false;
try {
  await send('initialize', { clientInfo: { name: 'acts-excel-install-check', version: pkg.version }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const result = await send('plugin/install', { marketplacePath, pluginName: 'acts-excel' });
  installed = true;
  console.log('Host plugin/install:', JSON.stringify(result));
  const status = await send('mcpServerStatus/list', { limit: 100 });
  const server = status.data.find(server => server.pluginId === `acts-excel@${market}`);
  assert.ok(server, 'Installed plugin missing from host MCP status');
  console.log('Host MCP status:', JSON.stringify({ name: server.name, pluginId: server.pluginId, serverInfo: server.serverInfo, tools: Object.keys(server.tools) }));
  assert.equal(Object.keys(server.tools).length, 8);
  assert.equal(server.serverInfo?.version, pkg.version);
} finally {
  try {
    if (installed) {
      console.log('Host plugin/uninstall:', JSON.stringify(await send('plugin/uninstall', { pluginId: `acts-excel@${market}` })));
      uninstalled = true;
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    if (child.exitCode === null) await new Promise(resolve => { child.once('close', resolve); child.kill(); });
    if (!installed || uninstalled) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    else console.error(`Test plugin remains installed from ${root}`);
  }
}
