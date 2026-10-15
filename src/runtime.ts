import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

type DuckDB = typeof import('@duckdb/node-api');
let loading: Promise<DuckDB> | undefined;

async function install(home: string): Promise<DuckDB> {
  const source = new URL('../runtime/', import.meta.url);
  const lock = await readFile(new URL('package-lock.json', source));
  const hash = createHash('sha256').update(lock).digest('hex').slice(0, 24);
  const parent = process.env.ACTS_EXCEL_RUNTIME_HOME || join(home, 'runtime');
  const target = join(parent, `${process.platform}-${process.arch}-${hash}`);
  const ready = async () => (await readFile(join(target, '.ready'), 'utf8').catch(() => '')) === hash;
  if (!await ready()) {
    await mkdir(parent, { recursive: true });
    const stage = await mkdtemp(join(parent, '.install-'));
    try {
      await writeFile(join(stage, 'package.json'), await readFile(new URL('package.json', source)));
      await writeFile(join(stage, 'package-lock.json'), lock);
      console.error('ACTS Excel: installing its locked DuckDB dependency. First use requires internet access.');
      await new Promise<void>((resolve, reject) => {
        const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'];
        const child = process.platform === 'win32'
          ? spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: stage, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
          : spawn('npm', args, { cwd: stage, stdio: ['ignore', 'ignore', 'pipe'] });
        let errorText = '';
        child.stderr.on('data', data => { errorText = (errorText + data).slice(-4000); });
        child.once('error', error => reject(new Error(`Cannot run npm to install DuckDB: ${error.message}. Install Node.js 22+ with npm, then retry this tool.`)));
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`DuckDB setup failed (npm exit ${code}). Check internet access to registry.npmjs.org and retry this tool. ${errorText}`)));
      });
      await writeFile(join(stage, '.ready'), hash);
      try { await rename(stage, target); }
      catch (error) { if (!await ready()) throw error; }
    } finally {
      await rm(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
  return createRequire(join(target, 'package.json'))('@duckdb/node-api') as DuckDB;
}

export function getDuckDB(home: string): Promise<DuckDB> {
  loading ??= (process.argv.includes('--plugin') ? install(home) : import('@duckdb/node-api'))
    .catch(error => { loading = undefined; throw error; });
  return loading;
}
