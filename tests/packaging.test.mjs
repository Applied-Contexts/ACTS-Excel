import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePortableCommand } from '../scripts/plugin-package.mjs';

test('portable command rejects the 0.0.1 importer failure and paths outside the plugin', async () => {
  for (const command of ['${PLUGIN_ROOT}/runtime/node.exe', '../runtime/node.exe', './runtime/../../node.exe', 'C:\\runtime\\node.exe']) {
    await assert.rejects(validatePortableCommand(command, '.'), /bare executable name or a contained/);
  }
});

test('portable command accepts the bundled executable and rejects a missing runtime', async t => {
  const root = await mkdtemp(join(tmpdir(), 'acts-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'runtime'));
  await writeFile(join(root, 'runtime', 'node.exe'), 'fixture');
  await validatePortableCommand('./runtime/node.exe', root);
  await validatePortableCommand('node', root);
  await assert.rejects(validatePortableCommand('./runtime/missing.exe', root), /ENOENT/);
});
