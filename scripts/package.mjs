import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { build } from 'esbuild';
import { architectures, targets, archiveLimit, extractedLimit } from './targets.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const source = 'packaging/acts-excel';
for (const path of ['plugin.json', '.codex-plugin/plugin.json']) {
  if (JSON.parse(await readFile(join(source, path), 'utf8')).version !== pkg.version) throw new Error(`Version differs from package.json: ${path}`);
}
for (const path of ['mcp.json', '.mcp.json']) {
  const server = JSON.parse(await readFile(join(source, path), 'utf8')).mcpServers['acts-excel'];
  if (server.command !== 'node' || JSON.stringify(server.args) !== JSON.stringify(['${PLUGIN_ROOT}/dist/server.mjs'])) throw new Error(`Plugin command differs: ${path}`);
}
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
await mkdir('release', { recursive: true });
const buildInfo = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
for (const arch of architectures) {
  const selected = Object.keys(targets).filter(target => target.endsWith(`-${arch}`));
  const stage = resolve('.stage/plugin', arch, 'acts-excel');
  await rm(stage, { recursive: true, force: true });
  await cp(source, stage, { recursive: true });
  await cp('dist', join(stage, 'dist'), { recursive: true, filter: path => {
    if (path.endsWith('build-meta.json')) return false;
    const relative = path.replaceAll('\\', '/');
    if (relative.startsWith('dist/native/')) return selected.some(target => relative === `dist/native/${target}` || relative.startsWith(`dist/native/${target}/`));
    if (relative.startsWith('dist/extensions/')) return selected.some(target => relative === `dist/extensions/${targets[target]}` || relative.startsWith(`dist/extensions/${targets[target]}/`));
    return true;
  } });
  for (const file of ['README.md', 'LICENSE']) await cp(file, join(stage, file));
  const info = { ...buildInfo, targets: selected };
  for (const path of ['build-info.json', 'dist/build-info.json']) await writeFile(join(stage, path), JSON.stringify(info, null, 2) + '\n');
  const files = {};
  let extracted = 0;
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, name + '/');
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        extracted += bytes.length;
        files[name] = [bytes, { os: 3, mtime: new Date('2026-01-01T00:00:00Z'), attrs: 0o100644 << 16 }];
      } else throw new Error(`Unsupported plugin entry: ${name}`);
    }
  }
  await walk(stage);
  if (extracted > extractedLimit) throw new Error(`${arch} exceeds the extracted-size limit`);
  const filename = `ACTS-Excel-${pkg.version}-${arch}-chatgpt.zip`;
  const bytes = zipSync(files, { level: 9 });
  if (bytes.length >= archiveLimit) throw new Error(`${filename} exceeds 100 MB`);
  await writeFile(join('release', filename), bytes);
  await writeFile(join('release', `${filename}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
  console.log(`${filename}: ${bytes.length} compressed bytes; ${extracted} extracted bytes`);
}
await build({ entryPoints: ['tests/mcp.test.ts'], outfile: '.stage/mcp-test.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import { createRequire as __actsCreateRequire } from 'node:module'; const require = __actsCreateRequire(import.meta.url);" } });
