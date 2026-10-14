import { readFile, writeFile, mkdir, cp, rm, readdir, lstat, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const root = process.cwd();
const stage = resolve('.stage/acts-excel');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions differ');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir('release', { recursive: true });
for (const file of ['package.json', 'package-lock.json']) await cp(file, join(stage, file));
await cp('dist', join(stage, 'dist'), { recursive: true });
await cp('packaging/acts-excel', stage, { recursive: true });
await mkdir(join(stage, 'runtime'), { recursive: true });
const runtimeName = process.platform === 'win32' ? 'node.exe' : 'node';
await cp(process.execPath, join(stage, 'runtime', runtimeName));
await chmod(join(stage, 'runtime', runtimeName), 0o755);
for (const filename of ['mcp.json', '.mcp.json']) {
  const config = JSON.parse(await readFile(join(stage, filename), 'utf8'));
  const placeholder = filename === 'mcp.json' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
  config.mcpServers['acts-excel'].command = `${placeholder}/runtime/${runtimeName}`;
  await writeFile(join(stage, filename), JSON.stringify(config, null, 2));
}
await mkdir(join(stage, 'notices'), { recursive: true });
for (const [name, url] of [
  ['Node-LICENSE', `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`],
  ['DuckDB-Excel-LICENSE', 'https://raw.githubusercontent.com/duckdb/duckdb-excel/81bb84b115b97cc4edec4827714cac80da0127e1/LICENSE'],
]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot retrieve ${name}: ${response.status}`);
  await writeFile(join(stage, 'notices', name), await response.text());
}
await writeFile(join(stage, 'build-info.json'), JSON.stringify({ version: pkg.version, node: process.versions.node, platform: process.platform, arch: process.arch, excel_sha256: createHash('sha256').update(await readFile(join(stage, 'dist/excel.duckdb_extension'))).digest('hex') }, null, 2));
manifest.compatibility.platforms = [process.platform];
await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (!process.env.npm_execpath) throw new Error('Run via npm run bundle');
execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
const mcpb = resolve('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');
execFileSync(process.execPath, [mcpb, 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
const name = `ACTS-Excel-${pkg.version}-${process.platform}-${process.arch}`;
execFileSync(process.execPath, [mcpb, 'pack', stage, resolve(`release/${name}.mcpb`)], { stdio: 'inherit' });
const files = {};
async function walk(dir, prefix = '') {
  for (const name of (await readdir(dir)).sort()) {
    if (name === '.bin' || name === '.package-lock.json' || name === 'manifest.json') continue;
    const full = join(dir, name); const key = prefix + name; const stat = await lstat(full);
    if (stat.isDirectory()) await walk(full, key + '/');
    else if (stat.isFile()) files[key] = [await readFile(full), { mtime: new Date('2026-01-01T00:00:00Z'), attrs: ((stat.mode & 0o777) | 0o100000) << 16 }];
  }
}
await walk(stage);
await writeFile(`release/${name}-chatgpt.zip`, zipSync(files, { level: 6 }));
for (const suffix of ['.mcpb', '-chatgpt.zip']) {
  const filename = `${name}${suffix}`;
  const hash = createHash('sha256').update(await readFile(join('release', filename))).digest('hex');
  await writeFile(join('release', `${filename}.sha256`), `${hash}  ${filename}\n`);
}
console.log(`Packaged ${name} for Claude Desktop and ChatGPT Desktop.`);
