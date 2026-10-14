import { readFile, writeFile, mkdir, cp, rm, readdir, lstat, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const platforms = { 'win32-x64': 'windows_amd64', 'linux-x64': 'linux_amd64' };
const target = process.argv[2] || 'win32-x64';
if (!(target in platforms)) throw new Error(`Unsupported target: ${target}`);
const [platform, arch] = target.split('-');
const stage = resolve(`.stage/${target}/acts-excel`);
const cache = resolve('.stage/downloads');
await mkdir(cache, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot download ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const native = await DuckDBInstance.create(':memory:');
const connection = await native.connect();
const duckdbVersion = (await connection.runAndReadAll('SELECT version()')).getRowsJson()[0][0];
connection.closeSync(); native.closeSync();
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
const runtimeName = platform === 'win32' ? 'node.exe' : 'node';
const nodeBase = `https://nodejs.org/dist/v${process.versions.node}`;
const nodeFile = platform === 'win32' ? `win-${arch}/node.exe` : `node-v${process.versions.node}-${target}.tar.gz`;
const sums = (await download(`${nodeBase}/SHASUMS256.txt`)).toString('utf8');
const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === nodeFile)?.[0];
if (!expected) throw new Error(`No official Node checksum for ${nodeFile}`);
const cachedNode = join(cache, nodeFile.replaceAll('/', '-'));
let nodeBytes;
try { nodeBytes = await readFile(cachedNode); } catch {}
if (!nodeBytes || sha256(nodeBytes) !== expected) {
  nodeBytes = await download(`${nodeBase}/${nodeFile}`);
  if (sha256(nodeBytes) !== expected) throw new Error('Node runtime checksum mismatch');
  await writeFile(cachedNode, nodeBytes);
}
if (platform === 'win32') await writeFile(join(stage, 'runtime', runtimeName), nodeBytes);
else {
  const member = `node-v${process.versions.node}-${target}/bin/node`;
  const executable = execFileSync('tar', ['-xOzf', cachedNode, member], { maxBuffer: 200 * 1024 * 1024 });
  await writeFile(join(stage, 'runtime', runtimeName), executable);
}
const extensionFile = join(cache, `${duckdbVersion}-${platforms[target]}-excel.duckdb_extension`);
let extension;
try { extension = await readFile(extensionFile); } catch {
  extension = gunzipSync(await download(`https://extensions.duckdb.org/${duckdbVersion}/${platforms[target]}/excel.duckdb_extension.gz`));
  await writeFile(extensionFile, extension);
}
await writeFile(join(stage, 'dist/excel.duckdb_extension'), extension);
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
await writeFile(join(stage, 'build-info.json'), JSON.stringify({ version: pkg.version, source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.versions.node, platform, arch, node_sha256: sha256(await readFile(join(stage, 'runtime', runtimeName))), duckdb: duckdbVersion, excel_sha256: sha256(extension) }, null, 2));
manifest.compatibility.platforms = [platform];
manifest.server.mcp_config.command = `${'${__dirname}'}/runtime/${runtimeName}`;
await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (!process.env.npm_execpath) throw new Error('Run via npm run bundle');
execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${platform}`, `--cpu=${arch}`, '--libc=glibc'], { cwd: stage, stdio: 'inherit' });
const bindingNames = (await readdir(join(stage, 'node_modules/@duckdb'))).filter(name => name.startsWith('node-bindings-'));
if (bindingNames.length !== 1 || bindingNames[0] !== `node-bindings-${target}`) throw new Error(`Unexpected native bindings: ${bindingNames.join(', ')}`);
const binding = join(stage, 'node_modules/@duckdb', bindingNames[0], 'duckdb.node');
await lstat(binding);
const mcpb = resolve('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');
execFileSync(process.execPath, [mcpb, 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
const output = resolve(platform === 'win32' ? 'release' : '.stage/local-smoke');
await mkdir(output, { recursive: true });
const name = `ACTS-Excel-${pkg.version}-${target}`;
execFileSync(process.execPath, [mcpb, 'pack', stage, join(output, `${name}.mcpb`)], { stdio: 'inherit' });
const files = {};
async function walk(dir, prefix = '') {
  for (const name of (await readdir(dir)).sort()) {
    if (name === '.bin' || name === '.package-lock.json' || name === 'manifest.json') continue;
    const full = join(dir, name); const key = prefix + name; const stat = await lstat(full);
    if (stat.isDirectory()) await walk(full, key + '/');
    else if (stat.isFile()) files[key] = [await readFile(full), { os: 3, mtime: new Date('2026-01-01T00:00:00Z'), attrs: ((stat.mode & 0o777) | 0o100000) << 16 }];
  }
}
await walk(stage);
await writeFile(join(output, `${name}-chatgpt.zip`), zipSync(files, { level: 6 }));
for (const suffix of ['.mcpb', '-chatgpt.zip']) {
  const filename = `${name}${suffix}`;
  const hash = createHash('sha256').update(await readFile(join(output, filename))).digest('hex');
  await writeFile(join(output, `${filename}.sha256`), `${hash}  ${filename}\n`);
}
console.log(`Packaged ${name} for Claude Desktop and ChatGPT Desktop.`);
