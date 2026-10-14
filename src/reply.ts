import type { Cell, Envelope, Page, ReplyOptions } from './types.js';

export const META_KEY = 'com.appliedcontexts.acts-excel/result';
export const cellText = (v: Cell): string => typeof v === 'string' ? v : JSON.stringify(v);
const safe = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('`', '\\`');

export function render(e: Envelope, format: ReplyOptions['response_format']): string {
  if (format === 'json') return JSON.stringify(e);
  const lines = [e.title];
  if (e.result_id) lines.push(`Result: ${e.result_id}`);
  if (e.table) lines.push(`SQL table: ${e.table}`);
  if (e.path) lines.push(`Saved: ${e.path}`);
  lines.push(`${e.total} rows total; ${e.count} shown from offset ${e.offset}.`);
  if (e.columns.length) {
    lines.push(`| row | ${e.columns.map(c => safe(c.name)).join(' | ')} |`);
    lines.push(`| --- | ${e.columns.map(() => '---').join(' | ')} |`);
    for (let r = 0; r < e.rows.length; r++) lines.push(`| ${e.offset + r} | ${e.rows[r].map(v => safe(cellText(v))).join(' | ')} |`);
  }
  for (const note of e.notes) lines.push(`Note: ${note}`);
  if (e.next_offset !== null) lines.push(`Next: read_result(result_id=${JSON.stringify(e.result_id)}, offset=${e.next_offset}).`);
  if (e.elided.length) lines.push(`Elided cells: ${e.elided.map(c => `row ${c.row}, column ${JSON.stringify(c.column)} (${c.chars} chars)`).join('; ')}.`);
  if (e.budget.recovery) lines.push(e.budget.recovery);
  lines.push(`Budget: ${e.budget.used_chars}/${e.budget.max_chars} characters.`);
  return lines.join('\n');
}

export function budget(page: Page, options: ReplyOptions = {}): { envelope: Envelope; text: string } {
  const max = options.max_chars ?? 8000;
  const e: Envelope = {
    ...page, rows: page.rows.map(row => [...row]), columns: [...page.columns],
    notes: [...page.notes], count: page.rows.length, next_offset: null, elided: [],
    budget: { max_chars: max, used_chars: 999999999, rows_deferred: 0 },
  };
  const refresh = () => {
    e.count = e.rows.length;
    e.next_offset = e.offset + e.count < e.total ? e.offset + e.count : null;
    e.budget.rows_deferred = page.rows.length - e.rows.length;
    e.elided = e.elided.filter(x => x.row < e.offset + e.count);
    if (e.elided.length || e.budget.rows_deferred) e.budget.recovery = 'Recover with read_result(result_id, offset, full=true, max_chars), or read_cell(result_id, row, column) for exact text in chunks. Export uses every full value.';
  };
  const size = () => render(e, options.response_format).length;
  refresh();
  if (!options.full) {
    for (const floor of [512, 128, 32]) {
      const cells = page.rows.flatMap((row, r) => row.map((v, c) => ({ r, c, text: cellText(v) }))).sort((a, b) => b.text.length - a.text.length);
      for (const c of cells) {
        if (size() <= max) break;
        if (c.text.length <= floor * 2) continue;
        e.rows[c.r][c.c] = `${c.text.slice(0, floor)} …[${c.text.length - floor * 2} chars elided]… ${c.text.slice(-floor)}`;
        if (!e.elided.some(x => x.row === e.offset + c.r && x.column === e.columns[c.c].name)) e.elided.push({ row: e.offset + c.r, column: e.columns[c.c].name, chars: c.text.length });
        refresh();
      }
    }
  }
  while (size() > max && e.rows.length > 0) {
    e.rows.pop();
    refresh();
  }
  if (size() > max) {
    e.columns = [];
    e.notes = ['Schema exceeds this preview budget. Use read_result with columns to select fields, or increase max_chars.'];
    refresh();
  }
  if (e.count === 0 && page.rows.length > 0) e.budget.recovery = 'No row fits this budget. Use read_cell(result_id, row, column), select fewer columns with read_result, or increase max_chars. The result is saved in full.';
  for (let i = 0; i < 8; i++) {
    const n = size();
    if (n === e.budget.used_chars) break;
    e.budget.used_chars = n;
  }
  return { envelope: e, text: render(e, options.response_format) };
}

export function reply(page: Page, options: ReplyOptions = {}) {
  const { envelope, text } = budget(page, options);
  return { content: [{ type: 'text' as const, text }], _meta: { [META_KEY]: envelope } };
}
