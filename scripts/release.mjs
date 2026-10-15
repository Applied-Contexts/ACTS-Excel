import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { targets, archiveLimit } from './targets.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const tag = `v${pkg.version}`;
if (process.env.GITHUB_REF_NAME !== tag) throw new Error('Release tag must match package.json');
const assets = [];
for (const target of Object.keys(targets)) {
  for (const suffix of ['-chatgpt.zip', '.mcpb']) {
    const name = `ACTS-Excel-${pkg.version}-${target}${suffix}`;
    const path = `release/${name}`;
    const bytes = await readFile(path);
    if (bytes.length >= archiveLimit) throw new Error(`${name} exceeds the archive size limit`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (await readFile(`${path}.sha256`, 'utf8') !== `${hash}  ${name}\n`) throw new Error(`Checksum mismatch: ${name}`);
    assets.push(path, `${path}.sha256`);
  }
}
execFileSync('gh', ['release', 'create', tag, '--verify-tag', '--draft', '--title', `ACTS Excel ${pkg.version}`, '--generate-notes', ...assets], { stdio: 'inherit' });
