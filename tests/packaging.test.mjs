import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';

test('the bundle delegates native platform selection to the published DuckDB package', async () => {
  const meta = JSON.parse(await readFile('dist/build-meta.json', 'utf8'));
  const imports = Object.values(meta.outputs).flatMap(output => output.imports).filter(entry => !isBuiltin(entry.path));
  assert.deepEqual(imports.map(entry => entry.path), ['@duckdb/node-api']);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@duckdb/node-api']);
  assert.equal(pkg.bin['acts-excel'], 'dist/server.mjs');
});
