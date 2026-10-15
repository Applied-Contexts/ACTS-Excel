import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DuckDBInstance } from '@duckdb/node-api';
import { targets, archiveLimit } from '../scripts/targets.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
const db = await DuckDBInstance.create(':memory:');
const connection = await db.connect();
const platform = (await connection.runAndReadAll('PRAGMA platform')).getRowsJson()[0][0];
connection.closeSync();
db.closeSync();

for (const target of info.targets) {
  for (const suffix of ['-chatgpt.zip', '.mcpb']) {
    const filename = `ACTS-Excel-${pkg.version}-${target}${suffix}`;
    test(`${filename} is bounded, self-contained and contains only ${target}`, { timeout: 180000 }, async t => {
      const bytes = await readFile(join('release', filename));
      assert.ok(bytes.length < archiveLimit, `${bytes.length} bytes exceeds archive limit`);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      assert.equal(await readFile(join('release', `${filename}.sha256`), 'utf8'), `${checksum}  ${filename}\n`);
      const files = unzipSync(bytes);
      const names = Object.keys(files).filter(name => !name.endsWith('/'));
      assert.deepEqual([...new Set(names.filter(name => name.startsWith('dist/native/')).map(name => name.split('/')[2]))], [target]);
      assert.deepEqual([...new Set(names.filter(name => name.startsWith('dist/extensions/')).map(name => name.split('/')[2]))], [targets[target]]);
      for (const name of ['dist/server.mjs', 'dist/app.html', 'dist/build-info.json', 'README.md', 'LICENSE', `dist/native/${target}/duckdb.node`, `dist/extensions/${targets[target]}/excel.duckdb_extension`]) assert.ok(files[name]?.length, name);
      assert.ok(names.some(name => name.startsWith('dist/notices/')));
      assert.ok(!names.some(name => /(^|\/)(node_modules|\.git|\.env|build-meta.json)(\/|$)/.test(name)));
      const json = name => JSON.parse(Buffer.from(files[name]).toString('utf8'));
      for (const name of ['plugin.json', '.codex-plugin/plugin.json', 'dist/build-info.json']) assert.equal(json(name).version, pkg.version);
      assert.deepEqual(json('dist/build-info.json').targets, [target]);
      assert.match(json('dist/build-info.json').source_commit, /^[a-f0-9]{40}$/);
      const portable = json('mcp.json').mcpServers['acts-excel'];
      assert.deepEqual(portable, { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/dist/server.mjs'], cwd: '${PLUGIN_ROOT}' });
      if (suffix === '.mcpb') {
        assert.equal(json('manifest.json').version, pkg.version);
        assert.deepEqual(json('manifest.json').compatibility.platforms, [target.split('-')[0]]);
      } else assert.equal(files['manifest.json'], undefined);
      if (targets[target] !== platform) return;
      const extracted = await mkdtemp(join(tmpdir(), 'acts-package with spaces-'));
      t.after(() => rm(extracted, { recursive: true, force: true }));
      for (const name of names) {
        assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
        const path = join(extracted, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, files[name]);
      }
      const env = { ...process.env, ACTS_TEST_SERVER: join(extracted, 'dist/server.mjs'), ACTS_TEST_FORMAT: suffix === '.mcpb' ? 'mcpb' : 'chatgpt' };
      delete env.NODE_TEST_CONTEXT;
      try {
        const output = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/mcp.test.ts'], {
          cwd: resolve('.'), env, timeout: 150000, encoding: 'utf8',
        });
        assert.match(output, /# pass 2\b/, output);
      } catch (error) {
        assert.fail(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
      }
    });
  }
}
