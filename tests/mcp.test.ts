import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, toNamespacedPath } from 'node:path';
import { META_KEY } from '../src/reply.js';
import { workbook } from './fixtures.js';

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
  const root = process.env.ACTS_TEST_CONFIG ? dirname(resolve(process.env.ACTS_TEST_CONFIG)) : resolve(dirname(serverPath), '..');
  const expand = (value: string) => value.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${__dirname}', root);
  const config = process.env.ACTS_TEST_CONFIG
    ? JSON.parse(await readFile(process.env.ACTS_TEST_CONFIG, 'utf8')).mcpServers['acts-excel']
    : undefined;
  const command = config && !process.env.ACTS_TEST_ISOLATED ? expand(config.command) : process.execPath;
  const args = config ? config.args.map(expand) : [serverPath];
  const cwd = config?.cwd ? expand(config.cwd) : undefined;
  if (process.env.ACTS_TEST_ISOLATED) {
    await mkdir(join(home, 'runtime', 'invalid-old-cache'), { recursive: true });
    await writeFile(join(home, 'runtime', 'invalid-old-cache', '.ready'), 'invalid');
  }
  const transport = new StdioClientTransport({ command, args, cwd, env: {
    PATH: process.env.ACTS_TEST_ISOLATED ? join(home, 'no-executables') : process.env.PATH || '',
    ACTS_EXCEL_HOME: home,
    HOME: home, USERPROFILE: home, XDG_CACHE_HOME: join(home, 'cache'),
    npm_config_cache: join(home, 'empty-npm-cache'), npm_config_offline: 'true',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1',
  }, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr?.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
  const client = new Client({ name: 'ACTS integration test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(home, { recursive: true, force: true });
  });
  const started = Date.now();
  try { await client.connect(transport, { timeout: 10000 }); }
  catch (error) { throw new Error(`${error}\n${diagnostics}`); }
  const tools = await client.listTools();
  t.diagnostic(`MCP discovery completed in ${Date.now() - started} ms`);
  assert.ok(Date.now() - started < 10000, 'MCP initialization must complete within ten seconds');
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
  assert.ok((await invoke('catalog', {})).total >= 1);
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
  const xlsxPath = join(home, 'sales with spaces.xlsx');
  const xlsx = workbook([
    { name: 'Sales & Tax', rows: [['region', 'revenue'], ['East', 120], ['West', 250], ['East', 180]] },
    { name: 'Hidden 🧮', hidden: true, rows: [['label'], ['preserved']] },
  ]);
  await writeFile(xlsxPath, xlsx);
  const sheets = await invoke('ingest', { path: xlsxPath, header: true });
  assert.equal(sheets.total, 2);
  const table = sheets.rows.find((row: unknown[]) => row[1] === 'Sales & Tax')[0];
  const grouped = await invoke('query', { sql: `SELECT region, sum(revenue) AS revenue FROM ${table} GROUP BY region ORDER BY region` });
  assert.deepEqual(grouped.rows, [['East', 300], ['West', 250]]);
  const transformed = await invoke('transform', { sql: `SELECT * FROM ${table} WHERE revenue > 150`, name: 'large_sales' });
  assert.equal(transformed.total, 2);
  const xlsxExport = await invoke('export', { result_id: grouped.result_id, format: 'xlsx' });
  const roundtrip = await invoke('ingest', { path: xlsxExport.path, header: true });
  assert.deepEqual((await invoke('query', { sql: `SELECT * FROM ${roundtrip.rows[0][0]} ORDER BY region` })).rows, grouped.rows);
  const exact = await invoke('query', { sql: "SELECT 9223372036854775807::BIGINT AS id, 1.234567890123456789::DECIMAL(20,18) AS precise" });
  const parquet = await invoke('export', { result_id: exact.result_id, format: 'parquet' });
  const parquetTable = await invoke('ingest', { path: parquet.path });
  assert.deepEqual((await invoke('query', { sql: `SELECT * FROM ${parquetTable.rows[0][0]}` })).rows, exact.rows);
  await invoke('forget', { result_ids: [transformed.result_id], tables: ['large_sales'] });
  assert.deepEqual(await readFile(xlsxPath), Buffer.from(xlsx), 'Input workbook must remain unchanged');
  const error = await client.callTool({ name: 'query', arguments: { sql: 'DROP SCHEMA data CASCADE' } });
  assert.equal(error.isError, true);
  assert.equal((error._meta![META_KEY] as any).kind, 'error');
  const invalid = await client.callTool({ name: 'read_result', arguments: { result_id: '../escape' } });
  assert.equal(invalid.isError, true);
});
