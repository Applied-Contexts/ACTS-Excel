import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { unzipSync } from 'fflate';

const exec = promisify(execFile);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const runtime = `${pkg.name}-${pkg.version}.tgz`;
const plugin = `ACTS-Excel-${pkg.version}-chatgpt.zip`;

test('portable plugin installs the npm runtime from an empty cache and completes MCP workflows', { timeout: 300000 }, async t => {
  for (const name of [runtime, plugin]) {
    const bytes = await readFile(join('release', name));
    assert.ok(bytes.length < 100_000_000);
    assert.equal(await readFile(join('release', name + '.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  }
  const files = unzipSync(await readFile(join('release', plugin)));
  assert.deepEqual(Object.keys(files).sort(), ['.codex-plugin/plugin.json', '.mcp.json', 'LICENSE', 'README.md', 'build-info.json', 'mcp.json', 'plugin.json']);
  const json = name => JSON.parse(Buffer.from(files[name]).toString('utf8'));
  for (const name of ['plugin.json', '.codex-plugin/plugin.json', 'build-info.json']) assert.equal(json(name).version, pkg.version);
  const config = json('mcp.json');
  const server = config.mcpServers['acts-excel'];
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['--yes', `--package=${pkg.repository}/releases/download/v${pkg.version}/${runtime}`, 'acts-excel']);
  assert.deepEqual(json('.mcp.json').mcpServers, config.mcpServers);
  const root = await mkdtemp(join(tmpdir(), 'acts package with spaces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const archive = await readFile(join('release', runtime));
  const http = createServer((request, response) => {
    if (request.url !== '/' + runtime) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(archive);
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  if (!process.env.ACTS_TEST_PUBLISHED) server.args[1] = `--package=http://127.0.0.1:${http.address().port}/${runtime}`;
  server.cwd = root;
  const configPath = join(root, 'mcp.json');
  await writeFile(configPath, JSON.stringify(config));
  const env = { ...process.env, ACTS_TEST_CONFIG: configPath, npm_config_cache: join(root, 'npm cache') };
  delete env.NODE_TEST_CONTEXT;
  for (const phase of ['cold', 'cached']) {
    if (phase === 'cached') env.npm_config_offline = 'true';
    try {
      const { stdout } = await exec(process.execPath, ['--test', '--test-reporter=tap', '.stage/mcp-test.mjs'], { cwd: resolve('.'), env, timeout: 140000 });
      assert.match(stdout, /# pass 1\b/, stdout);
      t.diagnostic(`${phase}: native runtime installation, eight tools, CSV/SQL, XLSX export passed`);
    } catch (error) { assert.fail(`${phase}: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`); }
  }
});
