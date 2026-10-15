import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, readdir, copyFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { targets } from './targets.mjs';

const app = JSON.parse(await readFile('package.json', 'utf8'));
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('.stage/downloads', { recursive: true });
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const database = await DuckDBInstance.create(':memory:');
const connection = await database.connect();
const version = String((await connection.runAndReadAll('SELECT version()')).getRowsJson()[0][0]);
const platform = String((await connection.runAndReadAll('PRAGMA platform')).getRowsJson()[0][0]);
connection.closeSync();
database.closeSync();
const downloaded = {};
async function download(url, name, integrity) {
  const path = join('.stage/downloads', name);
  let bytes = await readFile(path).catch(() => undefined);
  const valid = bytes => {
    if (!bytes) return false;
    if (!integrity) return true;
    const [algorithm, digest] = integrity.split('-');
    return createHash(algorithm).update(bytes).digest('base64') === digest;
  };
  if (!valid(bytes)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error(`Integrity mismatch: ${url}`);
    await writeFile(path, bytes);
  }
  downloaded[name] = createHash('sha256').update(bytes).digest('hex');
  return bytes;
}
for (const [target, extensionPlatform] of Object.entries(targets)) {
  const pkg = lock.packages[`node_modules/@duckdb/node-bindings-${target}`];
  if (!pkg?.resolved || !pkg.integrity) throw new Error(`Missing locked dependency for ${target}`);
  const archive = `duckdb-${pkg.version}-${target}.tgz`;
  await download(pkg.resolved, archive, pkg.integrity);
  const native = join('dist/native', target);
  await mkdir(native, { recursive: true });
  execFileSync('tar', ['-xzf', resolve('.stage/downloads', archive), '--strip-components=1', '-C', native]);
  for (const file of await readdir(native)) {
    if (!/\.(node|dll|so|dylib)$/.test(file) && file !== 'LICENSE') await rm(join(native, file));
  }
  const extensionDir = join('dist/extensions', extensionPlatform);
  await mkdir(extensionDir, { recursive: true });
  const bytes = await download(`https://extensions.duckdb.org/${version}/${extensionPlatform}/excel.duckdb_extension.gz`, `excel-${version}-${extensionPlatform}.gz`);
  await writeFile(join(extensionDir, 'excel.duckdb_extension'), gunzipSync(bytes));
}
const server = await build({
  entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, metafile: true,
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __actsCreateRequire } from 'node:module'; const require = __actsCreateRequire(import.meta.url);" },
  plugins: [{ name: 'native-files', setup(context) {
    context.onResolve({ filter: /^@duckdb\/node-bindings-[^/]+\/duckdb\.node$/ }, ({ path }) => ({ path: `./native/${path.slice('@duckdb/node-bindings-'.length)}`, external: true }));
  } }],
});
await writeFile('dist/build-meta.json', JSON.stringify(server.metafile, null, 2));
await chmod('dist/server.mjs', 0o755);
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
await writeFile('dist/notices/DuckDB-Excel-LICENSE', await download('https://raw.githubusercontent.com/duckdb/duckdb-excel/81bb84b115b97cc4edec4827714cac80da0127e1/LICENSE', 'duckdb-excel-81bb84b-LICENSE'));
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false });
const template = await readFile('ui/index.html', 'utf8');
const css = await readFile('ui/style.css', 'utf8');
await writeFile('dist/app.html', template.replace('STYLE_CONTENT', () => css).replace('SCRIPT_CONTENT', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
const check = await DuckDBInstance.create(':memory:');
const checkConnection = await check.connect();
try {
  const extension = resolve('dist/extensions', platform, 'excel.duckdb_extension').replaceAll("'", "''");
  await checkConnection.run(`LOAD '${extension}'`);
} finally { checkConnection.closeSync(); check.closeSync(); }
await writeFile('dist/build-info.json', JSON.stringify({ version: app.version, source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), duckdb_version: version, targets: Object.keys(targets), downloads: downloaded }, null, 2) + '\n');
console.log(`Built ACTS Excel ${app.version} with bundled native libraries and Excel extensions.`);
