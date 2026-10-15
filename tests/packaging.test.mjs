import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';

test('the bundle includes JavaScript dependencies and loads native files from the archive', async () => {
  const meta = JSON.parse(await readFile('dist/build-meta.json', 'utf8'));
  const imports = Object.values(meta.outputs).flatMap(output => output.imports).filter(entry => !isBuiltin(entry.path));
  assert.ok(imports.length >= 6);
  assert.ok(imports.every(entry => /^\.\/native\/[a-z0-9-]+\/duckdb\.node$/.test(entry.path)));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@duckdb/node-api']);
});
