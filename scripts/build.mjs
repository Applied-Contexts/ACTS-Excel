import { build } from 'esbuild';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: false });
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false });
const template = await readFile('ui/index.html', 'utf8');
const css = await readFile('ui/style.css', 'utf8');
await writeFile('dist/app.html', template.replace('STYLE_CONTENT', () => css).replace('SCRIPT_CONTENT', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
const db = await DuckDBInstance.create(':memory:');
const c = await db.connect();
const version = (await c.runAndReadAll('SELECT version()')).getRowsJson()[0][0];
const platform = (await c.runAndReadAll('PRAGMA platform')).getRowsJson()[0][0];
try { await access('dist/excel.duckdb_extension'); }
catch {
  const url = `https://extensions.duckdb.org/${version}/${platform}/excel.duckdb_extension.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot bundle Excel extension: ${response.status} ${url}`);
  await writeFile('dist/excel.duckdb_extension', gunzipSync(Buffer.from(await response.arrayBuffer())));
}
await c.run(`LOAD '${process.cwd().replaceAll("'", "''").replaceAll('\\', '/')}/dist/excel.duckdb_extension'`);
c.closeSync(); db.closeSync();
console.log(`Built ACTS-Excel with ${version} / ${platform}; Excel extension bundled for offline use.`);
