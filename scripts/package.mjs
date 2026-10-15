import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const runtime = `${pkg.name}-${pkg.version}.tgz`;
const source = 'packaging/acts-excel';
for (const path of ['plugin.json', '.codex-plugin/plugin.json']) {
  if (JSON.parse(await readFile(join(source, path), 'utf8')).version !== pkg.version) throw new Error(`Version differs from package.json: ${path}`);
}
for (const path of ['mcp.json', '.mcp.json']) {
  const server = JSON.parse(await readFile(join(source, path), 'utf8')).mcpServers['acts-excel'];
  if (server.command !== 'node' || JSON.stringify(server.args) !== JSON.stringify(['${PLUGIN_ROOT}/dist/server.mjs', '--plugin'])) throw new Error(`Plugin command differs: ${path}`);
}
const dependency = JSON.parse(await readFile(join(source, 'runtime/package.json'), 'utf8'));
if (JSON.stringify(dependency.dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('Plugin runtime dependencies differ from package.json');
await mkdir('release', { recursive: true });
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', 'release'], { stdio: 'inherit', shell: process.platform === 'win32' });
const stage = resolve('.stage/plugin/acts-excel');
await rm(stage, { recursive: true, force: true });
await cp(source, stage, { recursive: true });
await cp('dist', join(stage, 'dist'), { recursive: true, filter: path => !path.endsWith('build-meta.json') });
for (const file of ['README.md', 'LICENSE']) await cp(file, join(stage, file));
await cp('dist/build-info.json', join(stage, 'build-info.json'));
const files = {};
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path, name + '/');
    else if (entry.isFile()) files[name] = [await readFile(path), { os: 3, mtime: new Date('2026-01-01T00:00:00Z'), attrs: 0o100644 << 16 }];
    else throw new Error(`Unsupported plugin entry: ${name}`);
  }
}
await walk(stage);
const plugin = `ACTS-Excel-${pkg.version}-chatgpt.zip`;
await writeFile(join('release', plugin), zipSync(files, { level: 6 }));
for (const filename of [plugin, runtime]) {
  const bytes = await readFile(join('release', filename));
  if (bytes.length >= 100_000_000) throw new Error(`${filename} exceeds 100 MB`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join('release', `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`${filename}: ${bytes.length} bytes`);
}

await build({ entryPoints: ['tests/mcp.test.ts'], outfile: '.stage/mcp-test.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
