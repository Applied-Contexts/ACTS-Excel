import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';
import { targets } from '../scripts/targets.mjs';

test('the JavaScript bundle needs only Node built-ins and ships the selected native targets', async () => {
  const meta = JSON.parse(await readFile('dist/build-meta.json', 'utf8'));
  const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
  const imports = Object.values(meta.outputs).flatMap(output => output.imports).filter(entry => !isBuiltin(entry.path));
  assert.equal(imports.length, 8);
  for (const entry of imports) {
    assert.match(entry.path, /^\.\/native\/(linux|darwin|win32)-(x64|arm64)(-musl)?\/duckdb\.node$/);
    if (info.targets.includes(entry.path.split('/')[2])) assert.ok((await stat(join('dist', entry.path))).isFile());
  }
  for (const target of info.targets) {
    const platform = targets[target];
    assert.ok(platform);
    assert.ok((await stat(join('dist/extensions', platform, 'excel.duckdb_extension'))).isFile());
  }
});
