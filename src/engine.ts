import { DuckDBInstance, StatementType, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat, link, unlink, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { sheetNames } from './workbook.js';
import type { Cell, Column, Page } from './types.js';

export const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
export const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const uid = () => randomUUID().replaceAll('-', '');
const slug = (s: string) => s.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45).toLowerCase() || 'sheet';
const tableRef = (name: string) => `data.${ident(name)}`;
const resultsRef = (id: string) => `results.${ident(`r_${id}`)}`;
const dataHome = () => process.env.ACTS_EXCEL_HOME || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || homedir(), 'ACTS-Excel') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'ACTS-Excel') : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'acts-excel'));
export type IngestOptions = { path: string; sheet?: string; header?: boolean; range?: string; all_text?: boolean };
export type ReadOptions = { result_id: string; offset?: number; limit?: number; columns?: string[] };

export class Engine {
  readonly home: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(home = dataHome(), private extension?: string, private timeout = 60000) {
    this.home = resolve(home);
  }

  private async task<T>(external: boolean, excel: boolean, work: (c: DuckDBConnection) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      await mkdir(this.home, { recursive: true, mode: 0o700 });
      const db = await DuckDBInstance.create(join(this.home, 'workspace.duckdb'), {
        memory_limit: '1GB', threads: '4', max_temp_directory_size: '2GB',
        autoinstall_known_extensions: 'false', autoload_known_extensions: 'false',
        enable_external_access: String(external || excel), allow_community_extensions: 'false',
        extension_directory: join(this.home, 'extensions'),
      });
      let c: DuckDBConnection | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        c = await db.connect();
        await c.run('CREATE SCHEMA IF NOT EXISTS data; CREATE SCHEMA IF NOT EXISTS results; CREATE SCHEMA IF NOT EXISTS _acts');
        await c.run('CREATE TABLE IF NOT EXISTS _acts.tables(name VARCHAR PRIMARY KEY, source VARCHAR, sheet VARCHAR, rows BIGINT, notes VARCHAR, created TIMESTAMP DEFAULT current_timestamp)');
        await c.run('CREATE TABLE IF NOT EXISTS _acts.results(id VARCHAR PRIMARY KEY, kind VARCHAR, title VARCHAR, notes VARCHAR, table_name VARCHAR, created TIMESTAMP DEFAULT current_timestamp)');
        await c.run("SET search_path='data,main'; SET preserve_insertion_order=true");
        if (excel) {
          if (this.extension) await c.run(`LOAD ${literal(this.extension)}`);
          else {
            await c.run('INSTALL excel FROM core');
            await c.run('LOAD excel');
          }
        }
        if (!external && excel) await c.run('SET enable_external_access=false');
        await c.run('SET lock_configuration=true');
        timer = setTimeout(() => c?.interrupt(), this.timeout);
        return await work(c);
      } finally {
        if (timer) clearTimeout(timer);
        c?.closeSync();
        db.closeSync();
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  async setup() { await this.task(false, true, async () => undefined); }

  private async transaction<T>(c: DuckDBConnection, work: () => Promise<T>) {
    await c.run('BEGIN');
    try { const result = await work(); await c.run('COMMIT'); return result; }
    catch (error) { await c.run('ROLLBACK'); throw error; }
  }

  private async select(c: DuckDBConnection, sql: string, params: DuckDBValue[] = []) {
    const extracted = await c.extractStatements(sql);
    if (extracted.count !== 1) throw new Error('Use one SELECT or WITH query. Transformations create a new table from the query.');
    const prepared = await extracted.prepare(0);
    try {
      if (prepared.statementType !== StatementType.SELECT) throw new Error('Only SELECT/WITH queries are accepted. Use transform to save derived tables and export to write files.');
      if (prepared.parameterCount !== params.length) throw new Error(`SQL expects ${prepared.parameterCount} parameters; received ${params.length}.`);
    } finally { prepared.destroySync(); }
    const statement = sql.trim().replace(/;+\s*$/, '');
    return /^SUMMARIZE\b/i.test(statement) ? `SELECT * FROM (${statement})` : statement;
  }

  private async snapshot(c: DuckDBConnection, sql: string, kind: string, title: string, notes: string[] = [], table?: string, params: DuckDBValue[] = []): Promise<Page> {
    const id = uid();
    await c.run(`CREATE TABLE ${resultsRef(id)} AS ${sql}`, params.length ? params : undefined);
    await c.run('INSERT INTO _acts.results(id,kind,title,notes,table_name) VALUES (?,?,?,?,?)', [id, kind, title, JSON.stringify(notes), table ?? null]);
    return this.page(c, { result_id: id });
  }

  private async page(c: DuckDBConnection, options: ReadOptions): Promise<Page> {
    const meta = (await c.runAndReadAll('SELECT * FROM _acts.results WHERE id=?', [options.result_id])).getRowObjectsJson()[0];
    if (!meta) throw new Error('Result not found. Run the query again, or use catalog to inspect saved tables.');
    const ref = resultsRef(options.result_id);
    const all = await c.runAndReadAll(`SELECT * FROM ${ref} LIMIT 0`);
    const columns = all.columnNames().map((name, i) => ({ name, type: all.columnType(i).toString() }));
    const selected = options.columns ? options.columns.map(name => {
      const found = columns.find(c => c.name === name);
      if (!found) throw new Error(`Unknown column ${JSON.stringify(name)}. Available: ${columns.map(c => c.name).join(', ')}`);
      return found;
    }) : columns;
    const offset = options.offset ?? 0;
    const total = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM ${ref}`)).getRowObjectsJson()[0].n);
    const rows = await c.runAndReadAll(`SELECT ${selected.map(c => ident(c.name)).join(',')} FROM ${ref} ORDER BY rowid LIMIT ? OFFSET ?`, [options.limit ?? 30, offset]);
    return { kind: String(meta.kind), title: String(meta.title), result_id: options.result_id, ...(meta.table_name ? { table: String(meta.table_name) } : {}), columns: selected, rows: rows.getRowsJson() as Cell[][], total, offset, notes: JSON.parse(String(meta.notes)) };
  }

  async ingest(options: IngestOptions): Promise<Page> {
    if (!isAbsolute(options.path) || options.path.startsWith('\\\\') || options.path.startsWith('//')) throw new Error('Provide an absolute local file path. Network paths and URLs are not supported.');
    const path = await realpath(options.path);
    if (path.startsWith('\\\\') || path.startsWith('//')) throw new Error('Network paths are not supported.');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Path must point to a file.');
    if (info.size > 1024 ** 3) throw new Error('Input exceeds the 1 GiB limit. Split the file or use a smaller Parquet export.');
    const ext = extname(path).toLowerCase();
    if (!['.xlsx', '.csv', '.tsv', '.parquet', '.json', '.jsonl', '.ndjson'].includes(ext)) throw new Error('Supported: .xlsx, .csv, .tsv, .parquet, .json, .jsonl, .ndjson. Save legacy .xls/.xlsb or macro workbooks as .xlsx first.');
    if (ext !== '.xlsx' && (options.sheet || options.range)) throw new Error('sheet and range are XLSX options.');
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(this.home, 'ingest-'));
    const source = join(staging, `input${ext}`);
    try {
    await copyFile(path, source);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(source)) digest.update(chunk);
    digest.update(JSON.stringify({ header: options.header, range: options.range, all_text: options.all_text }));
    const hash = digest.digest('hex').slice(0, 12);
    const sheets = ext === '.xlsx' ? await sheetNames(source) : [{ name: basename(path, ext), hidden: false }];
    const selected = options.sheet ? sheets.filter(s => s.name === options.sheet) : sheets;
    if (!selected.length) throw new Error(`Sheet not found. Available sheets: ${sheets.map(s => JSON.stringify(s.name)).join(', ')}`);
    return await this.task(true, ext === '.xlsx', async c => {
      const imported: string[] = [];
      const staged: { name: string; stage: string; sheet: string; rows: number; notes: string[] }[] = [];
      for (let i = 0; i < selected.length; i++) {
        const sheet = selected[i];
        const name = `${slug(basename(path, ext))}_${slug(sheet.name)}_${hash}_${sheets.indexOf(sheet)}`;
        const exists = (await c.runAndReadAll('SELECT name FROM _acts.tables WHERE name=?', [name])).getRowsJson().length > 0;
        if (!exists) {
          const notes: string[] = [];
          const stage = ident(`stage_${uid()}`);
          if (sheet.hidden) notes.push('Hidden worksheet included.');
          let reader: string;
          if (ext === '.xlsx') {
            const opts = [`sheet=${literal(sheet.name)}`, 'stop_at_empty=false', 'ignore_errors=false', ...(options.header === undefined ? [] : [`header=${options.header}`]), ...(options.range ? [`range=${literal(options.range)}`] : [])];
            const read = (allText: boolean) => `read_xlsx(${literal(source)}, ${opts.join(',')}, all_varchar=${allText})`;
            reader = read(options.all_text ?? false);
            notes.push('Imported cached values. Formulas are not recalculated; formatting, charts and macros are not carried into data exports.');
            try { await c.run(`CREATE TEMP TABLE ${stage} AS SELECT * FROM ${reader}`); }
            catch (error) {
              const message = String(error);
              if (!options.all_text && /convert|conversion|cast/i.test(message)) {
                await c.run(`CREATE TEMP TABLE ${stage} AS SELECT * FROM ${read(true)}`);
                notes.push('Mixed cell types: imported this sheet as text to preserve values. Cast selected columns in SQL.');
              } else if (/No rows found|Could not find.*range|Invalid.*range.*empty/i.test(message)) {
                await c.run(`CREATE TEMP TABLE ${stage}(empty_sheet VARCHAR)`);
                notes.push('Empty worksheet: no data cells found. The placeholder column is not source data.');
              } else throw new Error(`Sheet ${JSON.stringify(sheet.name)} could not be imported: ${message}. Use sheet/range/header to select the data region.`);
            }
          } else {
            reader = ext === '.parquet' ? `read_parquet(${literal(source)})` : ['.json', '.jsonl', '.ndjson'].includes(ext) ? `read_json_auto(${literal(source)}, maximum_object_size=16777216)` : `read_csv(${literal(source)}, sample_size=-1, all_varchar=${options.all_text ?? false}${options.header === undefined ? '' : `,header=${options.header}`}${ext === '.tsv' ? ",delim='\\t'" : ''})`;
            await c.run(`CREATE TEMP TABLE ${stage} AS SELECT * FROM ${reader}`);
          }
          const rows = Number((await c.runAndReadAll(`SELECT count(*) n FROM ${stage}`)).getRowObjectsJson()[0].n);
          staged.push({ name, stage, sheet: sheet.name, rows, notes });
        }
        imported.push(name);
      }
      const latest = await stat(path);
      if (latest.size !== info.size || latest.mtimeMs !== info.mtimeMs) throw new Error('The input file changed during ingestion. Retry after saving it.');
      return this.transaction(c, async () => {
        for (const item of staged) {
          await c.run(`CREATE TABLE ${tableRef(item.name)} AS SELECT * FROM ${item.stage}`);
          await c.run('INSERT INTO _acts.tables(name,source,sheet,rows,notes) VALUES (?,?,?,?,?)', [item.name, path, item.sheet, item.rows, JSON.stringify(item.notes)]);
        }
        const placeholders = imported.map(() => '?').join(',');
        return this.snapshot(c, `SELECT 'data.' || name AS sql_table, sheet, rows, notes FROM _acts.tables WHERE name IN (${placeholders}) ORDER BY created,name`, 'ingest', `${selected.length} sheet${selected.length === 1 ? '' : 's'} ready · ${basename(path).slice(0, 160)}`, ['Use catalog(table) for columns, then query(sql). Re-ingesting identical data and options reuses saved tables.'], undefined, imported);
      });
    });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }

  async query(sql: string, params: DuckDBValue[] = [], name?: string): Promise<Page> {
    return this.task(false, false, c => this.transaction(c, async () => {
      const statement = await this.select(c, sql, params);
      if (name !== undefined) {
        const n = slug(name);
        if (n !== name || !/^[a-z][a-z0-9_]*$/.test(n)) throw new Error('Use a lowercase SQL table name starting with a letter, up to 45 letters, digits or underscores.');
        await c.run(`CREATE TABLE ${tableRef(n)} AS ${statement}`, params.length ? params : undefined);
        const rows = Number((await c.runAndReadAll(`SELECT count(*) n FROM ${tableRef(n)}`)).getRowObjectsJson()[0].n);
        await c.run('INSERT INTO _acts.tables(name,source,sheet,rows,notes) VALUES (?,?,?,?,?)', [n, 'SQL transformation', '', rows, '[]']);
        return this.snapshot(c, `SELECT * FROM ${tableRef(n)}`, 'transform', `Saved ${n}`, ['Source tables are unchanged.'], `data.${n}`);
      }
      return this.snapshot(c, statement, 'query', 'Query complete', [], undefined, params);
    }));
  }

  async catalog(table?: string): Promise<Page> {
    return this.task(false, false, c => this.transaction(c, async () => {
      if (table) {
        const name = await this.knownTable(c, table);
        return this.snapshot(c, `SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_schema='data' AND table_name=? ORDER BY ordinal_position`, 'catalog', `Columns in ${name}`, ['Use SQL SUMMARIZE to profile values, or SELECT aggregates to analyze only the data you need.'], `data.${name}`, [name]);
      }
      return this.snapshot(c, "SELECT 'data.' || name AS sql_table, sheet, rows, source, created FROM _acts.tables ORDER BY created DESC,name", 'catalog', 'Your local tables');
    }));
  }

  async read(options: ReadOptions): Promise<Page> { return this.task(false, false, c => this.page(c, options)); }

  async cell(id: string, row: number, column: string, offset: number, chars: number) {
    return this.task(false, false, async c => {
      const page = await this.page(c, { result_id: id, offset: row, limit: 1, columns: [column] });
      if (!page.rows.length) throw new Error(`Row ${row} is outside this result (${page.total} rows).`);
      const value = page.rows[0][0];
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return { result_id: id, row, column, encoding: typeof value === 'string' ? 'text' : 'json', total_chars: text.length, offset, text: text.slice(offset, offset + chars), next_offset: offset + chars < text.length ? offset + chars : null };
    });
  }

  private async knownTable(c: DuckDBConnection, table: string) {
    const name = table.startsWith('data.') ? table.slice(5) : table;
    if (!(await c.runAndReadAll('SELECT name FROM _acts.tables WHERE name=?', [name])).getRowsJson().length) throw new Error('Table not found. Call catalog to list saved tables.');
    return name;
  }

  async export(options: { result_id?: string; table?: string; path?: string; format: 'xlsx' | 'csv' | 'parquet' | 'json' }): Promise<Page> {
    if (!!options.result_id === !!options.table) throw new Error('Provide exactly one of result_id or table.');
    const ext = `.${options.format}`;
    const target = options.path ?? join(this.home, 'exports', `export-${uid().slice(0, 12)}${ext}`);
    if (!isAbsolute(target) || target.startsWith('\\\\') || target.startsWith('//')) throw new Error('Export path must be an absolute local path.');
    if (extname(target).toLowerCase() !== ext) throw new Error(`Export path must end with ${ext}.`);
    await mkdir(dirname(target), { recursive: true });
    const parent = await realpath(dirname(target));
    const final = join(parent, basename(target));
    const tempDir = await mkdtemp(join(parent, '.acts-export-'));
    const temp = join(tempDir, `data${ext}`);
    try {
      const page = await this.task(true, options.format === 'xlsx', async c => {
        let ref: string;
        if (options.table) ref = tableRef(await this.knownTable(c, options.table));
        else {
          await this.page(c, { result_id: options.result_id!, limit: 0 });
          ref = resultsRef(options.result_id!);
        }
        const settings = options.format === 'xlsx' ? 'FORMAT XLSX, HEADER true' : options.format === 'csv' ? 'FORMAT CSV, HEADER true' : options.format === 'json' ? 'FORMAT JSON, ARRAY true' : 'FORMAT PARQUET';
        await c.run(`COPY (SELECT * FROM ${ref} ORDER BY rowid) TO ${literal(temp)} (${settings})`);
        const rows = Number((await c.runAndReadAll(`SELECT count(*) n FROM ${ref}`)).getRowObjectsJson()[0].n);
        return { kind: 'export', title: 'Export ready', columns: [{ name: 'rows_exported', type: 'BIGINT' }], rows: [[rows]], total: 1, offset: 0, notes: options.format === 'xlsx' ? ['A data-only workbook with one sheet. Excel numeric precision is limited to 15 digits; use Parquet for exact typed values.'] : options.format === 'csv' ? ['CSV preserves raw text, including values beginning with formula characters. Use XLSX when opening untrusted text in Excel.'] : [], path: final } satisfies Page;
      });
      await link(temp, final);
      await unlink(temp);
      return page;
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  }

  async forget(ids: string[], tables: string[]): Promise<Page> {
    return this.task(false, false, c => this.transaction(c, async () => {
      for (const id of ids) {
        await this.page(c, { result_id: id, limit: 0 });
        await c.run(`DROP TABLE ${resultsRef(id)}`);
        await c.run('DELETE FROM _acts.results WHERE id=?', [id]);
      }
      for (const table of tables) {
        const name = await this.knownTable(c, table);
        await c.run(`DROP TABLE ${tableRef(name)}`);
        await c.run('DELETE FROM _acts.tables WHERE name=?', [name]);
      }
      return { kind: 'forget', title: 'Local data removed', columns: [{ name: 'results_removed', type: 'INTEGER' }, { name: 'tables_removed', type: 'INTEGER' }], rows: [[ids.length, tables.length]], total: 1, offset: 0, notes: ['Original input files and exported files are unchanged. Other result snapshots remain available.'] };
    }));
  }
}
