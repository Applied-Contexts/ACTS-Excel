import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const key = 'com.appliedcontexts.acts-excel/result';
const result = {
  kind: 'query', title: 'Query complete', result_id: 'a'.repeat(32), columns: [{ name: 'Region', type: 'VARCHAR' }, { name: 'Revenue', type: 'DOUBLE' }, { name: 'Notes', type: 'VARCHAR' }],
  rows: [['North America', 142800, 'Quarterly report …[4200 chars elided]… complete'], ['Europe', 98200, '<img src=x onerror=alert(1)>'], ['Asia Pacific', 86400, 'Ahead of forecast'], ['Latin America', 38500, 'New accounts']],
  total: 1250, count: 4, offset: 0, next_offset: 4, notes: ['Full result saved locally. Exports include every row and complete cell values.'],
  elided: [{ row: 0, column: 'Notes', chars: 4250 }], budget: { max_chars: 8000, used_chars: 1270, rows_deferred: 26 },
};
test('real MCP App handshake, table, full cell, paging, themes, export and escaping', async ({ page }) => {
  const html = await readFile('dist/app.html', 'utf8');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<iframe title="ACTS Excel" style="border:0;width:820px;height:650px"></iframe>');
  await page.evaluate(({ html, result, key }) => {
    const frame = document.querySelector('iframe')!;
    (window as any).calls = [];
    window.addEventListener('message', e => {
      const m = e.data; if (e.source !== frame.contentWindow) return;
      const send = (data: unknown) => frame.contentWindow!.postMessage(data, '*');
      if (m.method === 'ui/initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'Test host', version: '1.0.0' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } } });
      if (m.method === 'ui/notifications/initialized') send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'Query complete' }], _meta: { [key]: result } } });
      if (m.method === 'tools/call') {
        (window as any).calls.push(m.params);
        const p = m.params.name === 'read_cell' ? { kind: 'cell', title: 'Full cell value', cell: { result_id: result.result_id, row: 0, column: 'Notes', text: 'The complete original note.', total_chars: 27, offset: 0, next_offset: null } } : m.params.name === 'export' ? { kind: 'export', path: '/Users/example/Exports/revenue.xlsx' } : { ...result, offset: 4, rows: [['Next region', 100, 'Full value']], count: 1, next_offset: null };
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'Done' }], _meta: { [key]: p } } });
      }
    });
    frame.srcdoc = html;
  }, { html, result, key });
  const app = page.frameLocator('iframe');
  await expect(app.getByText('Query complete')).toBeVisible();
  await expect(app.getByRole('cell', { name: 'North America' })).toBeVisible();
  await expect(app.locator('img')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/tool-face-light.png', animations: 'disabled' });
  await app.getByRole('button', { name: 'Read full Notes, row 1' }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await expect(app.getByText('The complete original note.')).toBeVisible();
  await app.getByRole('button', { name: 'Close cell' }).click();
  await app.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(app.locator('.bar-fill')).toHaveCount(4);
  await app.getByRole('button', { name: 'Table', exact: true }).click();
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(app.getByText('Saved /Users/example/Exports/revenue.xlsx')).toBeVisible();
  await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, '*'));
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/tool-face-dark.png', animations: 'disabled' });
  await app.getByRole('button', { name: 'Next →' }).click();
  await expect(app.getByRole('cell', { name: 'Next region' })).toBeVisible();
  await app.getByRole('button', { name: 'Collapse details' }).click();
  await expect(app.locator('#details')).toBeHidden();
  await app.getByRole('button', { name: 'Expand details' }).click();
  const send = async (payload: object) => page.evaluate(({ key, payload }) => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'Result' }], _meta: { [key]: payload } } }, '*'), { key, payload });
  await send({ ...result, kind: 'ingest', title: '2 sheets ready · sales.xlsx', rows: [['data.sales', 'Sales', '1250', '["Cached formula values imported."]'], ['data.rates', 'Rates', '10', '[]']], total: 2, count: 2, next_offset: null });
  await expect(app.getByText('Cached formula values imported.')).toBeVisible();
  await expect(app.getByRole('button', { name: 'Inspect columns →' })).toHaveCount(2);
  await send({ ...result, kind: 'export', title: 'Export ready', rows: [[1250]], path: '/exports/sales.xlsx' });
  await expect(app.getByText('1,250 rows exported')).toBeVisible();
  await send({ kind: 'error', title: 'Import failed', message: 'File not found. Check the absolute path.' });
  await expect(app.getByText('Needs attention')).toBeVisible();
  await expect(app.getByText('File not found. Check the absolute path.')).toBeVisible();
  expect(errors).toEqual([]);
});
