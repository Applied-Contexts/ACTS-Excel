import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../src/engine.js';
import { workbook } from './fixtures.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'acts-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, engine: new Engine(join(dir, 'db'), resolve('dist/excel.duckdb_extension')) };
}

test('CSV ingestion, SQL analysis, immutable pagination, transformation and exact exports', async t => {
  const { dir, engine } = await fixture(t);
  const path = join(dir, "sales'book.csv");
  await writeFile(path, 'region,revenue,notes\nEast,120,first\nWest,250,second\nEast,180,third\n');
  const report = await engine.ingest({ path });
  const table = String(report.rows[0][0]);
  assert.equal(report.rows[0][2], '3');
  assert.equal((await engine.ingest({ path })).rows[0][0], table);
  assert.equal((await engine.catalog()).total, 1);
  assert.equal((await engine.catalog(table)).total, 3);
  const query = await engine.query(`SELECT region, sum(revenue) revenue FROM ${table} GROUP BY region ORDER BY revenue DESC`);
  assert.deepEqual(query.rows, [['East', '300'], ['West', '250']]);
  assert.deepEqual((await engine.read({ result_id: query.result_id!, offset: 1, limit: 1 })).rows, [['West', '250']]);
  assert.deepEqual((await engine.read({ result_id: query.result_id!, offset: 100 })).rows, []);
  const transformed = await engine.query(`SELECT region, revenue * ? AS doubled FROM ${table} WHERE revenue > ?`, [2, 150], 'clean_sales');
  assert.equal(transformed.total, 2);
  await assert.rejects(engine.query('SELECT 1', [], 'clean_sales'), /already exists/);
  assert.equal((await engine.query(`SELECT * FROM ${table}`)).total, 3);
  const volatile = await engine.query('SELECT random() AS value FROM range(50)');
  assert.deepEqual((await engine.read({ result_id: volatile.result_id!, limit: 30 })).rows, volatile.rows);
  const exported = await engine.export({ result_id: query.result_id, format: 'xlsx', path: join(dir, 'report.xlsx') });
  const roundtrip = await engine.ingest({ path: exported.path! });
  const roundtripData = await engine.query(`SELECT * FROM ${roundtrip.rows[0][0]}`);
  assert.deepEqual(roundtripData.rows, [['East', 300], ['West', 250]]);
  await assert.rejects(engine.export({ result_id: query.result_id, format: 'xlsx', path: exported.path }), /EEXIST/);
  const exact = await engine.query("SELECT 9223372036854775807::BIGINT AS id, 1.234567890123456789::DECIMAL(20,18) AS precise, '🧮' AS unicode, NULL AS missing");
  assert.equal(exact.rows[0][0], '9223372036854775807');
  assert.equal(exact.rows[0][1], '1.234567890123456789');
  const parquet = await engine.export({ result_id: exact.result_id, format: 'parquet' });
  const pi = await engine.ingest({ path: parquet.path! });
  assert.deepEqual((await engine.query(`SELECT * FROM ${pi.rows[0][0]}`)).rows, exact.rows);
  const json = await engine.export({ result_id: query.result_id, format: 'json' });
  assert.equal(JSON.parse(await readFile(json.path!, 'utf8')).length, 2);
  await engine.forget([query.result_id!], ['clean_sales']);
  await assert.rejects(engine.read({ result_id: query.result_id! }), /Result not found/);
  assert.equal((await engine.read({ result_id: transformed.result_id! })).total, 2);
  const restarted = new Engine(engine.home, resolve('dist/excel.duckdb_extension'));
  assert.equal((await restarted.catalog()).total, 3);
});

test('multi-sheet XLSX retains blank rows, mixed types, Unicode and hidden sheets', async t => {
  const { dir, engine } = await fixture(t);
  const path = join(dir, 'mixed.xlsx');
  await writeFile(path, workbook([
    { name: 'Sales & Tax', rows: [['name', 'amount'], ['first', 12], [null, null], ['last', 30]] },
    { name: 'Mixed', rows: [['code', 'value'], [1, 5], ['001A', 'text']] },
    { name: 'Hidden 🧮', hidden: true, rows: [['label'], ['=HYPERLINK("bad")']] },
  ]));
  const report = await engine.ingest({ path, header: true });
  assert.equal(report.total, 3);
  const mixed = report.rows.find(r => r[1] === 'Mixed')!;
  assert.match(String(mixed[3]), /Mixed cell types/);
  assert.deepEqual((await engine.query(`SELECT * FROM ${mixed[0]}`)).rows, [['1', '5'], ['001A', 'text']]);
  const sales = report.rows.find(r => r[1] === 'Sales & Tax')!;
  assert.equal(Number(sales[2]), 3);
  assert.deepEqual((await engine.query(`SELECT * FROM ${sales[0]} WHERE name='last'`)).rows, [['last', 30]]);
  const hidden = report.rows.find(r => r[1] === 'Hidden 🧮')!;
  assert.match(String(hidden[3]), /Hidden worksheet/);
  const only = await engine.ingest({ path, sheet: 'Mixed', header: true });
  assert.equal(only.total, 1);
});

test('one bad sheet rolls back ingestion; empty worksheets are reported', async t => {
  const { dir, engine } = await fixture(t);
  const path = join(dir, 'empty.xlsx');
  await writeFile(path, workbook([{ name: 'Data', rows: [['id'], [1]] }, { name: 'Empty', rows: [] }]));
  const report = await engine.ingest({ path, header: true });
  assert.equal(report.total, 2);
  assert.equal(report.rows.find(r => r[1] === 'Empty')?.[2], '0');
  assert.match(String(report.rows.find(r => r[1] === 'Empty')?.[3]), /empty/i);
});

test('SQL cannot mutate inputs or escape to local files, network, configuration or multiple statements', async t => {
  const { dir, engine } = await fixture(t);
  const secret = join(dir, 'private.csv'); await writeFile(secret, 'secret\nprivate\n');
  for (const sql of [
    'SELECT 1; SELECT 2', 'CREATE TABLE test AS SELECT 1', 'SET enable_external_access=true',
    `SELECT * FROM read_csv('${secret.replaceAll("'", "''")}')`,
    "SELECT * FROM read_csv('https://example.com/test.csv')", 'INSTALL httpfs',
    "COPY (SELECT 1) TO '/tmp/acts-not-allowed.csv'", "ATTACH ':memory:' AS other",
  ]) await assert.rejects(engine.query(sql));
  await assert.rejects(engine.ingest({ path: 'relative.xlsx' }), /absolute/);
  await assert.rejects(engine.export({ format: 'xlsx' }), /exactly one/);
  await assert.rejects(engine.export({ result_id: 'bad', format: 'xlsx', path: join(dir, 'bad.csv') }), /end with/);
  const ok = await engine.query('SELECT ? AS value', ["'; DROP SCHEMA data CASCADE; --"]);
  assert.equal(ok.rows[0][0], "'; DROP SCHEMA data CASCADE; --");
  assert.equal((await engine.query('SELECT 42')).rows[0][0], 42);
});

test('long cells recover exactly in slices, projection works and calls serialize', async t => {
  const { engine } = await fixture(t);
  const value = 'prefix 🧮漢字\\\n|"'.repeat(5000);
  const p = await engine.query('SELECT ? AS body, 5 AS n', [value]);
  let offset = 0, recovered = '';
  for (;;) { const part = await engine.cell(p.result_id!, 0, 'body', offset, 1300); recovered += part.text; if (part.next_offset === null) break; offset = part.next_offset; }
  assert.equal(recovered, value);
  assert.deepEqual((await engine.read({ result_id: p.result_id!, columns: ['n'] })).rows, [[5]]);
  await assert.rejects(engine.cell(p.result_id!, 1, 'body', 0, 1000), /outside/);
  await assert.rejects(engine.read({ result_id: p.result_id!, columns: ['unknown'] }), /Unknown column/);
  assert.equal((await Promise.all([engine.query('SELECT 1'), engine.query('SELECT 2'), engine.catalog()])).length, 3);
});

test('a malformed second sheet leaves no partially imported tables', async t => {
  const { dir, engine } = await fixture(t);
  const { unzipSync, zipSync, strToU8 } = await import('fflate');
  const data = unzipSync(workbook([{ name: 'Good', rows: [['id'], [1]] }, { name: 'Broken', rows: [['id'], [2]] }]));
  data['xl/worksheets/sheet2.xml'] = strToU8('<worksheet><sheetData><row><c>');
  const path = join(dir, 'broken.xlsx'); await writeFile(path, zipSync(data));
  await assert.rejects(engine.ingest({ path }));
  assert.equal((await engine.catalog()).total, 0);
});

test('expensive SQL can be interrupted and the workspace remains usable', async t => {
  const { engine } = await fixture(t);
  const timed = new Engine(engine.home, resolve('dist/excel.duckdb_extension'), 500);
  await assert.rejects(timed.query('SELECT sum(a.i * b.i + random()) FROM range(1000000000) a(i), range(1000000000) b(i)'), /interrupt/i);
  assert.equal((await engine.query('SELECT 42 AS answer')).rows[0][0], 42);
  assert.equal((await engine.query('SUMMARIZE SELECT 1 AS value')).rows.length, 1);
});


test('filenames with brackets are literal files, never glob expressions', async t => {
  const { dir, engine } = await fixture(t);
  const path = join(dir, 'sales[1].csv');
  await writeFile(path, 'name\nintended\n');
  await writeFile(join(dir, 'sales1.csv'), 'name\nunintended\n');
  const imported = await engine.ingest({ path });
  assert.deepEqual((await engine.query(`SELECT * FROM ${imported.rows[0][0]}`)).rows, [['intended']]);
  const { readdir } = await import('node:fs/promises');
  assert.ok(!(await readdir(engine.home)).some(name => name.startsWith('ingest-')));
});
