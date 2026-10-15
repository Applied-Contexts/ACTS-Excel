import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, toNamespacedPath } from 'node:path';
import { META_KEY } from '../src/reply.js';

test('stdio discovery works through host-normalized entrypoint paths', { timeout: 60000, skip: !!process.env.ACTS_TEST_CONFIG }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'acts-startup-'));
  const serverPath = resolve(process.env.ACTS_TEST_SERVER || 'dist/server.mjs');
  let entry = toNamespacedPath(serverPath);
  if (process.platform !== 'win32') {
    entry = join(home, 'server.mjs');
    await symlink(serverPath, entry);
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: home, env: { ACTS_EXCEL_HOME: home }, stderr: 'pipe' });
  const client = new Client({ name: 'ACTS startup test', version: '1.0.0' });
  t.after(async () => { await client.close(); await rm(home, { recursive: true, force: true }); });
  await client.connect(transport, { timeout: 120000 });
  assert.equal((await client.listTools()).tools.length, 8);
});

test('packaged stdio protocol exposes all eight app tools and completes the assistant workflow', { timeout: 180000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'acts-mcp-'));
  const serverPath = resolve(process.env.ACTS_TEST_SERVER || 'dist/server.mjs');
  const root = resolve(dirname(serverPath), '..');
  const expand = (value: string) => value.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${__dirname}', root);
  const config = process.env.ACTS_TEST_CONFIG
    ? JSON.parse(await readFile(process.env.ACTS_TEST_CONFIG, 'utf8')).mcpServers['acts-excel']
    : undefined;
  const command = config ? expand(config.command) : process.execPath;
  const args = config ? config.args.map(expand) : [serverPath];
  const cwd = config?.cwd ? expand(config.cwd) : undefined;
  const transport = new StdioClientTransport({ command, args, cwd, env: { PATH: process.env.PATH || '', ACTS_EXCEL_HOME: home, ...(process.env.npm_config_cache ? { npm_config_cache: process.env.npm_config_cache } : {}) }, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr?.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
  const client = new Client({ name: 'ACTS integration test', version: '1.0.0' });
  t.after(async () => {
    if (process.platform === 'win32' && command === 'npx' && transport.pid) {
      try { execFileSync('taskkill', ['/pid', String(transport.pid), '/t', '/f'], { stdio: 'ignore' }); } catch {}
    }
    await client.close();
    await rm(home, { recursive: true, force: true });
  });
  try { await client.connect(transport, { timeout: 120000 }); }
  catch (error) { throw new Error(`${error}\n${diagnostics}`); }
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 8);
  for (const tool of tools.tools) assert.ok((tool._meta?.ui as { resourceUri: string }).resourceUri.startsWith('ui://acts-excel/'));
  const resources = await client.listResources();
  const resource = await client.readResource({ uri: resources.resources[0].uri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(String('text' in resource.contents[0] ? resource.contents[0].text : ''), /ACTS Excel/);
  const path = join(home, 'input.csv'); await writeFile(path, 'name,amount\nA,10\nB,20\n');
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    assert.equal(result.structuredContent, undefined);
    const p = result._meta![META_KEY] as any; return p.kind === 'cell' ? p.cell : p;
  };
  const imported = await invoke('ingest', { path });
  const query = await invoke('query', { sql: `SELECT sum(amount) AS total FROM ${imported.rows[0][0]}`, max_chars: 2000 });
  assert.equal(query.rows[0][0], '30');
  assert.equal((await invoke('read_result', { result_id: query.result_id })).rows[0][0], '30');
  assert.equal((await invoke('read_cell', { result_id: query.result_id, row: 0, column: 'total' })).text, '30');
  const longColumn = '\t'.repeat(900);
  const wide = await invoke('query', { sql: `SELECT repeat('x', 3000) AS "${longColumn}"`, max_chars: 2000 });
  const cellResult = await client.callTool({ name: 'read_cell', arguments: { result_id: wide.result_id, row: 0, column: longColumn, max_chars: 2000 } });
  assert.equal(cellResult.isError, undefined);
  const cellText = (cellResult.content as { text: string }[])[0].text;
  assert.ok(cellText.length <= 2000);
  assert.ok(JSON.parse(cellText).text.length > 0);
  const exported = await invoke('export', { result_id: query.result_id, format: 'xlsx' });
  assert.ok(exported.path.endsWith('.xlsx'));
  const error = await client.callTool({ name: 'query', arguments: { sql: 'DROP SCHEMA data CASCADE' } });
  assert.equal(error.isError, true);
  assert.equal((error._meta![META_KEY] as any).kind, 'error');
  const invalid = await client.callTool({ name: 'read_result', arguments: { result_id: '../escape' } });
  assert.equal(invalid.isError, true);
});
