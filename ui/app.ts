import { App, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Envelope, Cell } from '../src/types.js';

const META_KEY = 'com.appliedcontexts.acts-excel/result';
const app = new App({ name: 'ACTS Excel', version: '0.0.1' }, {});
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
const text = (v: Cell) => v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v);
const fmt = (n: number) => n.toLocaleString();
let current: Envelope | undefined;
let busy = false;
let chart = false;
let cell: { result_id: string; row: number; column: string; next_offset: number | null; total_chars: number; text: string; offset: number } | undefined;
let modes: string[] = [];
let fullscreen = false;
const button = (title: string, action: () => Promise<void> | void, cls = '') => {
  const b = node('button', title, cls); b.disabled = busy;
  b.onclick = () => { void action(); }; return b;
};
const message = (s: string) => { el('message').textContent = s; };
const payload = (result: any) => result._meta?.[META_KEY];

async function call(name: string, args: Record<string, unknown>, consume = true) {
  if (busy) return;
  busy = true; el('app').setAttribute('aria-busy', 'true');
  document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
  message('Working…');
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'The operation failed.');
    if (consume) receive(result);
    message(''); const p = payload(result); return p?.kind === 'cell' ? p.cell : p;
  } catch (e) { message(e instanceof Error ? e.message : String(e)); }
  finally { busy = false; el('app').removeAttribute('aria-busy'); document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; }); }
}

function metric(value: number | string, label: string) {
  const m = node('div', '', 'metric'); m.append(node('strong', typeof value === 'number' ? fmt(value) : value), node('span', label)); return m;
}
function receive(result: any) {
  const p = payload(result);
  if (!p) { message('This result has no display data. The assistant can still read its text response.'); return; }
  el('title').textContent = p.title;
  el('status').textContent = p.kind === 'error' ? 'Needs attention' : 'Complete';
  el('status').className = `badge${p.kind === 'error' ? ' error' : ''}`;
  el('metrics').replaceChildren(); el('body').replaceChildren(); el('notes').replaceChildren(); el('footer').replaceChildren();
  if (p.kind === 'error') { el('body').append(node('div', p.message, 'error-panel')); return; }
  if (p.kind === 'cell') { el('body').append(node('pre', p.cell.text, 'file-path')); return; }
  current = p; chart = false; render();
}
function render() {
  const p = current; if (!p) return;
  el('metrics').replaceChildren(); el('body').replaceChildren(); el('notes').replaceChildren(); el('footer').replaceChildren();
  if (p.kind === 'export') {
    const panel = node('div', '', 'export-panel'); panel.append(node('strong', `${fmt(Number(p.rows[0]?.[0] ?? 0))} rows exported`), node('div', p.path || '', 'file-path'));
    el('body').append(panel);
  } else {
    if (p.kind === 'ingest') el('metrics').append(metric(p.total, 'sheets imported'), metric(p.rows.reduce((n, r) => n + Number(r[2]), 0), 'rows in listed sheets'), metric('Ready', 'for SQL analysis'));
    else el('metrics').append(metric(p.total, p.kind === 'catalog' ? (p.table ? 'columns' : 'saved tables') : 'result rows'), metric(p.columns.length, 'columns'), metric(p.count, 'rows in this preview'));
    const toolbar = node('div', '', 'toolbar'); toolbar.append(node('span', p.table || 'Data preview', 'eyebrow'));
    const numeric = p.columns.findIndex((c, i) => /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC/.test(c.type) && p.rows.some(r => Number.isFinite(Number(r[i])) && r[i] !== null));
    if (numeric >= 0 && p.rows.length > 1 && ['query', 'transform'].includes(p.kind)) toolbar.append(button(chart ? 'Table' : 'Chart', () => { chart = !chart; render(); }));
    el('body').append(toolbar);
    if (!p.rows.length) el('body').append(node('div', p.total ? (p.offset >= p.total ? 'You reached the end of this result.' : 'This preview is too wide. Ask the assistant to select fewer columns or retrieve a cell.') : 'No rows matched. Try a different filter.', 'empty'));
    else if (p.kind === 'ingest') drawSheets(p);
    else if (chart && numeric >= 0) drawBars(p, numeric);
    else drawTable(p);
  }
  const notes = [...p.notes];
  if (p.elided?.length) notes.push('Some values are shortened for this preview. Select a cell to read the complete value. Exports always contain full values.');
  if (notes.length) { const d = node('details'); d.append(node('summary', `${notes.length} reading note${notes.length > 1 ? 's' : ''}`)); notes.forEach(n => d.append(node('div', n, 'note'))); el('notes').append(d); }
  const paging = node('div', '', 'pagination');
  if (p.result_id) {
    const id = p.result_id;
    if (p.offset > 0) paging.append(button('←', async () => { await call('read_result', { result_id: id, offset: Math.max(0, p.offset - 30) }); }));
    paging.append(node('span', p.count ? `${fmt(p.offset + 1)}–${fmt(p.offset + p.count)} of ${fmt(p.total)}` : `${fmt(p.total)} saved rows`));
    if (p.next_offset !== null && p.next_offset > p.offset) paging.append(button('Next →', async () => { await call('read_result', { result_id: id, offset: p.next_offset }); }));
    el('footer').append(paging);
    const exports = node('div', '', 'export-actions'); const select = node('select'); select.setAttribute('aria-label', 'Export format');
    for (const f of ['xlsx', 'csv', 'parquet', 'json']) { const option = node('option', f.toUpperCase()); option.value = f; select.append(option); }
    exports.append(select, button('Export', async () => {
      const result = await call('export', { result_id: id, format: select.value }, false);
      if (result?.path) message(`Saved ${result.path}`);
    }, 'primary'));
    el('footer').append(exports);
  }
}

function drawSheets(p: Envelope) {
  const sheets = node('div', '', 'sheets');
  for (const row of p.rows) {
    const card = node('div', '', 'sheet-card');
    const heading = node('div', '', 'sheet-heading'); heading.append(node('strong', String(row[1])), node('span', `${fmt(Number(row[2]))} rows`, 'badge'));
    card.append(heading, button('Inspect columns →', async () => { await call('catalog', { table: row[0] }); }, 'cell elided'));
    try { const notes = JSON.parse(String(row[3])); for (const note of notes) card.append(node('div', String(note), 'note')); } catch { card.append(node('div', 'Select this row’s notes for complete reading details.', 'note')); }
    sheets.append(card);
  }
  el('body').append(sheets);
}

function drawTable(p: Envelope) {
  const wrap = node('div', '', 'table-wrap'); const table = node('table');
  const head = node('thead'); const hr = node('tr'); hr.append(node('th', '#'));
  p.columns.forEach(c => { const th = node('th', c.name); th.scope = 'col'; th.append(node('span', c.type, 'type')); hr.append(th); });
  head.append(hr); table.append(head); const body = node('tbody');
  p.rows.forEach((row, r) => {
    const tr = node('tr'); tr.append(node('td', String(p.offset + r + 1), 'row-index'));
    row.forEach((value, c) => {
      const td = node('td');
      const short = p.elided?.some(e => e.row === p.offset + r && e.column === p.columns[c].name);
      const label = text(value);
      if (p.result_id && (short || label.length > 90)) {
        const b = button(label.slice(0, 250), () => showCell(p.result_id!, p.offset + r, p.columns[c].name), `cell${short ? ' elided' : ''}`);
        b.setAttribute('aria-label', `Read full ${p.columns[c].name}, row ${p.offset + r + 1}`); td.append(b);
      } else if (p.columns[c].name === 'sql_table' && typeof value === 'string') {
        td.append(button(value, async () => { await call('catalog', { table: value }); }, 'cell elided'));
      } else td.textContent = label;
      tr.append(td);
    }); body.append(tr);
  });
  table.append(body); wrap.append(table); el('body').append(wrap);
}
function drawBars(p: Envelope, column: number) {
  const label = p.columns.findIndex((_, i) => i !== column);
  const subset = p.rows.slice(0, 12); const max = Math.max(...subset.map(r => Math.abs(Number(r[column])) || 0), 1);
  const bars = node('div', '', 'bars'); bars.append(node('div', `${p.columns[column].name} · first ${subset.length} preview rows · bar lengths show magnitude`, 'note'));
  subset.forEach((r, i) => { const row = node('div', '', 'bar-row'); const track = node('div', '', 'bar-track'); const fill = node('div', '', 'bar-fill'); fill.style.width = `${Math.abs(Number(r[column])) / max * 100}%`; track.append(fill); row.append(node('span', label >= 0 ? text(r[label]) : String(p.offset + i + 1), 'bar-label'), track, node('span', text(r[column]), 'bar-value')); bars.append(row); });
  el('body').append(bars);
}
async function showCell(result_id: string, row: number, column: string) {
  const value = await call('read_cell', { result_id, row, column }, false); if (!value) return;
  cell = value; el('cell-title').textContent = `${column} · row ${row + 1}`; el('cell-text').textContent = value.text;
  updateCell(); el<HTMLDialogElement>('cell-dialog').showModal();
}
function updateCell() { if (!cell) return; el('cell-count').textContent = `${fmt((el('cell-text').textContent || '').length)} / ${fmt(cell.total_chars)} characters`; el('more-cell').hidden = cell.next_offset === null; }
el('more-cell').onclick = async () => {
  if (!cell || cell.next_offset === null) return;
  const value = await call('read_cell', { result_id: cell.result_id, row: cell.row, column: cell.column, offset: cell.next_offset }, false);
  if (value) { el('cell-text').textContent += value.text; cell = value; updateCell(); }
};
el('close-cell').onclick = () => el<HTMLDialogElement>('cell-dialog').close();
el('expand').onclick = () => { const open = el('details').hidden; el('details').hidden = !open; el('expand').textContent = open ? '⌃' : '⌄'; el('expand').setAttribute('aria-expanded', String(open)); el('expand').setAttribute('aria-label', open ? 'Collapse details' : 'Expand details'); };
el('fullscreen').onclick = async () => { try { await app.requestDisplayMode({ mode: fullscreen ? 'inline' : 'fullscreen' }); } catch (e) { message(String(e)); } };
function theme(context: McpUiHostContext) {
  if (context.theme) { document.documentElement.dataset.theme = context.theme; document.documentElement.style.colorScheme = context.theme; }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.availableDisplayModes) modes = context.availableDisplayModes;
  fullscreen = context.displayMode === 'fullscreen';
  el('fullscreen').hidden = !modes.includes('fullscreen');
  el('fullscreen').setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Fullscreen');
  if (context.safeAreaInsets) for (const [side, value] of Object.entries(context.safeAreaInsets)) document.body.style.setProperty(`padding-${side}`, `${value}px`);
}
app.ontoolresult = receive;
app.ontoolinput = () => { el('status').textContent = 'Working'; };
app.ontoolcancelled = () => { el('status').textContent = 'Cancelled'; message('This operation was cancelled.'); };
app.onhostcontextchanged = theme;
app.connect().then(() => { const context = app.getHostContext(); if (context) theme(context); }).catch(e => message(`Could not connect to the host: ${String(e)}`));
