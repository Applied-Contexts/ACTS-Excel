import { open } from 'yauzl';
import { XMLParser } from 'fast-xml-parser';

export async function sheetNames(path: string): Promise<{ name: string; hidden: boolean }[]> {
  const xml = await new Promise<string>((resolve, reject) => {
    open(path, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Invalid workbook archive'));
      let found = false;
      zip.on('error', reject);
      zip.on('end', () => { if (!found) reject(new Error('Workbook has no xl/workbook.xml')); });
      zip.on('entry', entry => {
        if (entry.fileName !== 'xl/workbook.xml') return zip.readEntry();
        found = true;
        if (entry.uncompressedSize > 4 * 1024 * 1024) { zip.close(); return reject(new Error('Workbook metadata exceeds 4 MiB')); }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) { zip.close(); return reject(err ?? new Error('Cannot read workbook metadata')); }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('error', e => { zip.close(); reject(e); });
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) stream.destroy(new Error('Workbook metadata exceeds 4 MiB'));
            else chunks.push(chunk);
          });
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks).toString('utf8')); });
        });
      });
      zip.readEntry();
    });
  });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Workbook metadata contains unsupported XML declarations');
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: true, parseAttributeValue: false }).parse(xml);
  const raw = parsed?.workbook?.sheets?.sheet;
  const sheets = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((s: Record<string, string>) => ({ name: String(s['@_name']), hidden: ['hidden', 'veryHidden'].includes(s['@_state']) }));
  if (!sheets.length || sheets.length > 512) throw new Error('Workbook must contain between 1 and 512 sheets');
  return sheets;
}
