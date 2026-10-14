import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../src/reply.js';
import type { Page } from '../src/types.js';

const page = (rows: Page['rows']): Page => ({ kind: 'query', title: 'Query complete', result_id: 'a'.repeat(32), columns: [{ name: 'id', type: 'BIGINT' }, { name: 'body', type: 'VARCHAR' }], rows, total: rows.length, offset: 0, notes: [] });

test('actual rendered response fits, its measured size is exact and elision names recovery', () => {
  const rows = Array.from({ length: 60 }, (_, i) => [i, '🧮漢字 | \\ ` \n "'.repeat(1000)]);
  const p = page(rows);
  for (const response_format of ['markdown', 'json'] as const) for (const max_chars of [2000, 4000, 8000, 25000]) {
    const result = budget(p, { max_chars, response_format });
    assert.ok(result.text.length <= max_chars, `${result.text.length} > ${max_chars}`);
    assert.equal(result.envelope.budget.used_chars, result.text.length);
    assert.equal(result.envelope.next_offset, result.envelope.count < p.total ? result.envelope.count : null);
    assert.ok(result.envelope.elided.length > 0);
    assert.match(result.envelope.budget.recovery!, /read_cell/);
    assert.equal(p.rows[0][1], rows[0][1]);
  }
});

test('pages advance by delivered rows without omissions or duplicates', () => {
  const rows = Array.from({ length: 105 }, (_, i) => [i, `Row ${i} `.repeat(40)]);
  let offset = 0; const delivered: number[] = [];
  while (offset < rows.length) {
    const p = { ...page(rows.slice(offset, offset + 30)), offset, total: rows.length };
    const result = budget(p, { max_chars: 2000 });
    delivered.push(...result.envelope.rows.map(r => Number(r[0])));
    assert.ok(result.envelope.count > 0);
    offset = result.envelope.next_offset ?? rows.length;
  }
  assert.deepEqual(delivered, rows.map(r => r[0]));
});

test('full mode never silently clips cells and gives an explicit recovery for oversized rows', () => {
  const p = page([[1, 'x'.repeat(20000)]]);
  const tiny = budget(p, { max_chars: 2000, full: true });
  assert.equal(tiny.envelope.count, 0);
  assert.equal(tiny.envelope.total, 1);
  assert.equal(tiny.envelope.next_offset, 0);
  assert.match(tiny.text, /No row fits/);
  assert.equal(tiny.envelope.elided.length, 0);
  const full = budget(p, { max_chars: 25000, full: true });
  assert.equal(full.envelope.rows[0][1], p.rows[0][1]);
});

test('very wide results state schema omission without exceeding the budget', () => {
  const p = page([Array.from({ length: 500 }, () => 'x')]);
  p.columns = Array.from({ length: 500 }, (_, i) => ({ name: `column_${i}_${'a'.repeat(100)}`, type: 'VARCHAR' }));
  const result = budget(p, { max_chars: 2000 });
  assert.ok(result.text.length <= 2000);
  assert.match(result.text, /fewer columns|select fields/);
});
