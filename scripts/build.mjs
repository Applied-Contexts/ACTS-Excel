import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, readdir, copyFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const app = JSON.parse(await readFile('package.json', 'utf8'));
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const server = await build({
  entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, metafile: true, external: ['@duckdb/node-api'],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __actsCreateRequire } from 'node:module'; const require = __actsCreateRequire(import.meta.url);" },
});
await writeFile('dist/build-meta.json', JSON.stringify(server.metafile, null, 2));
await chmod('dist/server.mjs', 0o755);
await writeFile('dist/build-info.json', JSON.stringify({ version: app.version, source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }, null, 2) + '\n');
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
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false });
const template = await readFile('ui/index.html', 'utf8');
const css = await readFile('ui/style.css', 'utf8');
await writeFile('dist/app.html', template.replace('STYLE_CONTENT', () => css).replace('SCRIPT_CONTENT', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script')));
console.log(`Built ACTS Excel ${app.version}. Native dependencies are installed by npm.`);
