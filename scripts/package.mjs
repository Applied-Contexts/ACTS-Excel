import { readFile, writeFile, mkdir, cp, rm, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { zipSync } from 'fflate';
import { targets, validateTarget, archiveLimit } from './targets.mjs';

const { values } = parseArgs({ options: { target: { type: 'string' } } });
const selected = values.target ? [validateTarget(values.target)] : Object.keys(targets);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
for (const path of ['manifest.json', 'packaging/acts-excel/plugin.json', 'packaging/acts-excel/.codex-plugin/plugin.json']) {
  if (JSON.parse(await readFile(path, 'utf8')).version !== pkg.version) throw new Error(`Version differs from package.json: ${path}`);
}
execFileSync(process.execPath, ['scripts/build.mjs', ...(values.target ? ['--target', values.target] : ['--all'])], { stdio: 'inherit' });
const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await mkdir('release', { recursive: true });
const mcpb = resolve('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');

for (const target of selected) {
  const stage = resolve('.stage/packages', target, 'acts-excel');
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(stage, 'dist'), { recursive: true });
  await cp('packaging/acts-excel', stage, { recursive: true });
  for (const file of ['server.mjs', 'app.html', 'notices']) await cp(join('dist', file), join(stage, 'dist', file), { recursive: true });
  await cp(join('dist/native', target), join(stage, 'dist/native', target), { recursive: true });
  await cp(join('dist/extensions', targets[target]), join(stage, 'dist/extensions', targets[target]), { recursive: true });
  for (const file of ['README.md', 'LICENSE']) await cp(file, join(stage, file));
  const buildInfo = { ...info, source_commit: commit, targets: [target] };
  await writeFile(join(stage, 'dist/build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
  const platformManifest = { ...manifest, compatibility: { ...manifest.compatibility, platforms: [target.split('-')[0]] } };
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(platformManifest, null, 2) + '\n');
  execFileSync(process.execPath, [mcpb, 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
  const name = `ACTS-Excel-${pkg.version}-${target}`;
  execFileSync(process.execPath, [mcpb, 'pack', stage, resolve(`release/${name}.mcpb`)], { stdio: 'inherit' });
  const files = {};
  async function walk(dir, prefix = '') {
    for (const filename of (await readdir(dir)).sort()) {
      if (!prefix && filename === 'manifest.json') continue;
      const full = join(dir, filename);
      const key = prefix + filename;
      const stat = await lstat(full);
      if (stat.isDirectory()) await walk(full, key + '/');
      else if (stat.isFile()) files[key] = [await readFile(full), { os: 3, mtime: new Date('2026-01-01T00:00:00Z'), attrs: ((stat.mode & 0o777) | 0o100000) << 16 }];
      else throw new Error(`Unsupported package entry: ${full}`);
    }
  }
  await walk(stage);
  await writeFile(`release/${name}-chatgpt.zip`, zipSync(files, { level: 6 }));
  for (const suffix of ['.mcpb', '-chatgpt.zip']) {
    const filename = `${name}${suffix}`;
    const bytes = await readFile(`release/${filename}`);
    if (bytes.length >= archiveLimit) {
      await rm(`release/${filename}`);
      throw new Error(`${filename} exceeds the ${archiveLimit}-byte archive limit (${bytes.length} bytes)`);
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(`release/${filename}.sha256`, `${hash}  ${filename}\n`);
    console.log(`${filename}: ${(bytes.length / 1_000_000).toFixed(2)} MB`);
  }
}
