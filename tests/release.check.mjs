import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { architectures, targets, archiveLimit, extractedLimit } from '../scripts/targets.mjs';

const exec = promisify(execFile);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
test('complete plugin archives contain every advertised platform and work without setup', { timeout: 300000 }, async t => {
  for (const arch of architectures) {
    const name = `ACTS-Excel-${pkg.version}-${arch}-chatgpt.zip`;
    const bytes = await readFile(join('release', name));
    assert.ok(bytes.length < archiveLimit);
    assert.equal(await readFile(join('release', name + '.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
    const files = unzipSync(bytes);
    for (const name of ['plugin.json', '.codex-plugin/plugin.json', 'mcp.json', '.mcp.json', 'README.md', 'LICENSE', 'build-info.json', 'dist/server.mjs', 'dist/app.html', 'dist/notices/DuckDB-Excel-LICENSE']) assert.ok(files[name]?.length, `Missing ${name}`);
    assert.ok(Object.values(files).reduce((sum, file) => sum + file.length, 0) <= extractedLimit);
    const json = name => JSON.parse(Buffer.from(files[name]).toString('utf8'));
    for (const name of ['plugin.json', '.codex-plugin/plugin.json', 'build-info.json']) assert.equal(json(name).version, pkg.version);
    const selected = Object.keys(targets).filter(target => target.endsWith(`-${arch}`));
    assert.deepEqual(json('build-info.json').targets, selected);
    for (const target of selected) {
      assert.ok(files[`dist/native/${target}/duckdb.node`], `Missing ${target} binding`);
      assert.ok(files[`dist/native/${target}/LICENSE`], `Missing ${target} license`);
      assert.ok(files[`dist/native/${target}/${target.startsWith('win32') ? 'duckdb.dll' : target.startsWith('darwin') ? 'libduckdb.dylib' : 'libduckdb.so'}`], `Missing ${target} database library`);
      assert.ok(files[`dist/extensions/${targets[target]}/excel.duckdb_extension`], `Missing ${target} Excel extension`);
    }
    assert.ok(!Object.keys(files).some(name => name.startsWith('runtime/') || name.includes('node_modules')));
    const config = json('mcp.json');
    assert.equal(config.mcpServers['acts-excel'].command, 'node');
    assert.deepEqual(config.mcpServers['acts-excel'].args, ['${PLUGIN_ROOT}/dist/server.mjs']);
    assert.deepEqual(json('.mcp.json').mcpServers, config.mcpServers);
    t.diagnostic(`${arch}: ${bytes.length} bytes, complete Windows/Linux/macOS payloads`);
    if (arch !== process.arch) continue;
    const root = await mkdtemp(join(tmpdir(), 'acts package with spaces-'));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    config.mcpServers['acts-excel'].cwd = root;
    const configPath = join(root, 'mcp.json');
    await writeFile(configPath, JSON.stringify(config));
    const env = { ...process.env, ACTS_TEST_CONFIG: configPath, ACTS_TEST_ISOLATED: '1' };
    delete env.NODE_TEST_CONTEXT;
    try {
      const { stdout } = await exec(process.execPath, ['--test', '--test-reporter=tap', '.stage/mcp-test.mjs'], { cwd: resolve('.'), env, timeout: 120000 });
      assert.match(stdout, /# pass 1\b/, stdout);
      for (const line of stdout.split('\n').filter(line => line.includes('MCP discovery completed'))) t.diagnostic(line.replace(/^#\s*/, ''));
      t.diagnostic('All eight tools, multi-sheet XLSX, SQL, transformations, exact Parquet, XLSX round-trip, and unchanged input passed with empty dependency caches and no npm on PATH');
    } catch (error) { assert.fail(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`); }
  }
});
