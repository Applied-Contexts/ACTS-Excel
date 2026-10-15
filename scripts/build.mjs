import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parseArgs } from 'node:util';
import { targets, validateTarget } from './targets.mjs';

const { values } = parseArgs({ options: { all: { type: 'boolean' }, target: { type: 'string' } } });
if (values.all && values.target) throw new Error('Use --all or --target, not both');
if (values.target) validateTarget(values.target);
const app = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const db = await DuckDBInstance.create(':memory:');
const connection = await db.connect();
const version = (await connection.runAndReadAll('SELECT version()')).getRowsJson()[0][0];
const platform = (await connection.runAndReadAll('PRAGMA platform')).getRowsJson()[0][0];
const selected = values.all ? Object.keys(targets) : [validateTarget(values.target || Object.keys(targets).find(target => targets[target] === platform))];
const bindings = selected.map(target => {
  const name = `node_modules/@duckdb/node-bindings-${target}`;
  const pkg = lock.packages[name];
  if (!pkg?.resolved || !pkg.integrity) throw new Error(`Missing locked native dependency: ${name}`);
  return [name, pkg];
});
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('.stage/downloads', { recursive: true });

async function download(url, filename, integrity) {
  let bytes;
  try { bytes = await readFile(filename); } catch {}
  const valid = data => {
    if (!data) return false;
    if (!integrity) return true;
    const [algorithm, digest] = integrity.split('-');
    return createHash(algorithm).update(data).digest('base64') === digest;
  };
  if (!valid(bytes)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot download ${url}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error(`Integrity mismatch: ${url}`);
    await writeFile(filename, bytes);
  }
  return bytes;
}

await Promise.all(bindings.map(async ([name, pkg]) => {
  const target = name.slice('node_modules/@duckdb/node-bindings-'.length);
  const native = join('dist/native', target);
  const archive = resolve(`.stage/downloads/duckdb-${pkg.version}-${target}.tgz`);
  await download(pkg.resolved, archive, pkg.integrity);
  await mkdir(native, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', native]);
  for (const file of await readdir(native)) {
    if (!/\.(node|dll|so|dylib)$/.test(file) && file !== 'LICENSE') await rm(join(native, file));
  }
  const extensionPlatform = targets[target];
  const extensionDir = join('dist/extensions', extensionPlatform);
  const extension = await download(`https://extensions.duckdb.org/${version}/${extensionPlatform}/excel.duckdb_extension.gz`, `.stage/downloads/excel-${version}-${extensionPlatform}.gz`);
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, 'excel.duckdb_extension'), gunzipSync(extension));
}));

const server = await build({
  entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, metafile: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [{ name: 'duckdb-native', setup(context) {
    context.onResolve({ filter: /^@duckdb\/node-bindings-[^/]+\/duckdb\.node$/ }, ({ path }) => ({ path: `./native/${path.slice('@duckdb/node-bindings-'.length)}`, external: true }));
  } }],
});
await writeFile('dist/build-meta.json', JSON.stringify(server.metafile, null, 2));
await writeFile('dist/build-info.json', JSON.stringify({ version: app.version, duckdb_version: version, targets: selected }, null, 2));
const packages = new Set(Object.keys(server.metafile.inputs).flatMap(path => {
  const marker = path.lastIndexOf('node_modules/');
  if (marker < 0) return [];
  const prefix = path.slice(0, marker + 'node_modules/'.length);
  const name = path.slice(prefix.length).split('/').slice(0, path[prefix.length] === '@' ? 2 : 1).join('/');
  return [prefix + name];
}));
await mkdir('dist/notices', { recursive: true });
for (const dir of packages) {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  for (const file of await readdir(dir)) {
    if (/^(license|licence|notice|copying)(\.|$)/i.test(file)) await copyFile(join(dir, file), join('dist/notices', `${pkg.name.replaceAll('/', '-')}-${file}`));
  }
}
await writeFile('dist/notices/DuckDB-Excel-LICENSE', await download('https://raw.githubusercontent.com/duckdb/duckdb-excel/81bb84b115b97cc4edec4827714cac80da0127e1/LICENSE', '.stage/downloads/duckdb-excel-81bb84b-LICENSE'));
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false });
const template = await readFile('ui/index.html', 'utf8');
const css = await readFile('ui/style.css', 'utf8');
await writeFile('dist/app.html', template.replace('STYLE_CONTENT', () => css).replace('SCRIPT_CONTENT', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
if (selected.some(target => targets[target] === platform)) await connection.run(`LOAD '${resolve(`dist/extensions/${platform}/excel.duckdb_extension`).replaceAll("'", "''").replaceAll('\\', '/')}'`);
connection.closeSync(); db.closeSync();
console.log(`Built ACTS-Excel ${app.version} for ${selected.join(', ')} with offline Excel extensions.`);
