import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';

test('the JavaScript bundle needs only Node built-ins and ships every native import', async () => {
  const meta = JSON.parse(await readFile('dist/build-meta.json', 'utf8'));
  const imports = Object.values(meta.outputs).flatMap(output => output.imports).filter(entry => !isBuiltin(entry.path));
  assert.equal(imports.length, 8);
  for (const entry of imports) {
    assert.match(entry.path, /^\.\/native\/(linux|darwin|win32)-(x64|arm64)(-musl)?\/duckdb\.node$/);
    assert.ok((await stat(join('dist', entry.path))).isFile());
  }
  for (const platform of ['linux_amd64', 'linux_arm64', 'linux_amd64_musl', 'linux_arm64_musl', 'windows_amd64', 'windows_arm64', 'osx_amd64', 'osx_arm64']) {
    assert.ok((await stat(join('dist/extensions', platform, 'excel.duckdb_extension'))).isFile());
  }
});
