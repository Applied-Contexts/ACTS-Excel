import { readFile, writeFile, mkdir, cp, rm, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const stage = resolve('.stage/acts-excel');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions differ');
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir('release', { recursive: true });
await cp('dist', join(stage, 'dist'), { recursive: true });
await rm(join(stage, 'dist/build-meta.json'));
await cp('packaging/acts-excel', stage, { recursive: true });
await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(stage, 'build-info.json'), JSON.stringify({ version: pkg.version, source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), targets: await readdir(join(stage, 'dist/native')) }, null, 2));
const mcpb = resolve('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');
execFileSync(process.execPath, [mcpb, 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
const name = `ACTS-Excel-${pkg.version}`;
execFileSync(process.execPath, [mcpb, 'pack', stage, resolve(`release/${name}.mcpb`)], { stdio: 'inherit' });
const files = {};
async function walk(dir, prefix = '') {
  for (const name of (await readdir(dir)).sort()) {
    if (name === 'manifest.json') continue;
    const full = join(dir, name); const key = prefix + name; const stat = await lstat(full);
    if (stat.isDirectory()) await walk(full, key + '/');
    else if (stat.isFile()) files[key] = [await readFile(full), { os: 3, mtime: new Date('2026-01-01T00:00:00Z'), attrs: ((stat.mode & 0o777) | 0o100000) << 16 }];
  }
}
await walk(stage);
await writeFile(`release/${name}-chatgpt.zip`, zipSync(files, { level: 6 }));
for (const suffix of ['.mcpb', '-chatgpt.zip']) {
  const filename = `${name}${suffix}`;
  const hash = createHash('sha256').update(await readFile(`release/${filename}`)).digest('hex');
  await writeFile(`release/${filename}.sha256`, `${hash}  ${filename}\n`);
}
console.log(`Packaged ${name} for Windows, macOS and Linux, x64 and ARM64.`);
