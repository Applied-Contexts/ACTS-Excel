import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const exec = promisify(execFile);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const runtime = `${pkg.name}-${pkg.version}.tgz`;
const plugin = `ACTS-Excel-${pkg.version}-chatgpt.zip`;

test('portable plugin initializes before setup, installs locked dependencies, and reuses them offline', { timeout: 300000 }, async t => {
  for (const name of [runtime, plugin]) {
    const bytes = await readFile(join('release', name));
    assert.ok(bytes.length < 100_000_000);
    assert.equal(await readFile(join('release', name + '.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  }
  const files = unzipSync(await readFile(join('release', plugin)));
  for (const name of ['.codex-plugin/plugin.json', '.mcp.json', 'LICENSE', 'README.md', 'build-info.json', 'mcp.json', 'plugin.json', 'dist/server.mjs', 'dist/app.html', 'runtime/package.json', 'runtime/package-lock.json']) assert.ok(files[name], `Missing ${name}`);
  assert.ok(!Object.keys(files).some(name => /node_modules|\.(dll|node|duckdb_extension)$/.test(name)));
  const json = name => JSON.parse(Buffer.from(files[name]).toString('utf8'));
  for (const name of ['plugin.json', '.codex-plugin/plugin.json', 'build-info.json']) assert.equal(json(name).version, pkg.version);
  const config = json('mcp.json');
  const server = config.mcpServers['acts-excel'];
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/dist/server.mjs', '--plugin']);
  assert.deepEqual(json('.mcp.json').mcpServers, config.mcpServers);
  const root = await mkdtemp(join(tmpdir(), 'acts package with spaces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  server.cwd = root;
  const configPath = join(root, 'mcp.json');
  await writeFile(configPath, JSON.stringify(config));
  const env = { ...process.env, ACTS_TEST_CONFIG: configPath, ACTS_TEST_RUNTIME_HOME: join(root, 'native runtime'), npm_config_cache: join(root, 'npm cache') };
  delete env.NODE_TEST_CONTEXT;
  for (const phase of ['missing-npm', 'cold', 'cached']) {
    try {
      const { stdout } = await exec(process.execPath, ['--test', '--test-reporter=tap', '.stage/mcp-test.mjs'], { cwd: resolve('.'), env: { ...env, ...(phase === 'cached' ? { npm_config_offline: 'true' } : {}), ...(phase === 'missing-npm' ? { ACTS_TEST_NO_NPM: '1' } : {}) }, timeout: 140000 });
      assert.match(stdout, /# pass 1\b/, stdout);
      for (const line of stdout.split('\n').filter(line => line.includes('MCP discovery completed'))) t.diagnostic(`${phase}: ${line.replace(/^#\s*/, '')}`);
      t.diagnostic(phase === 'missing-npm' ? 'Discovery works without npm; setup error is actionable and leaves the server connected' : `${phase}: native runtime installation, eight tools, CSV/SQL, XLSX export passed`);
    } catch (error) { assert.fail(`${phase}: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`); }
  }
});
