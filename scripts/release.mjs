import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { unzipSync } from 'fflate';

const { values } = parseArgs({ options: { 'notes-file': { type: 'string' }, prerelease: { type: 'boolean' } } });
if (!values['notes-file']) throw new Error('Pass --notes-file PATH with release notes and actual platform test coverage');
if (!(await readFile(values['notes-file'], 'utf8')).trim()) throw new Error('Release notes must not be empty');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('Release from a clean, committed checkout');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const repo = new URL(pkg.repository).pathname.slice(1).replace(/\.git$/, '');
const tag = `v${pkg.version}`;
const commit = git(['rev-parse', 'HEAD']);
if (git(['rev-parse', `${tag}^{commit}`]) !== commit) throw new Error(`${tag} must point to HEAD`);
const remoteTag = git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).split('\n');
if (!remoteTag.some(line => line.split('\t')[0] === commit)) throw new Error(`Push ${tag} to origin before releasing`);
const assets = [];
const expected = new Map();
for (const name of [`ACTS-Excel-${pkg.version}-chatgpt.zip`, `${pkg.name}-${pkg.version}.tgz`]) {
  const path = `release/${name}`;
  const bytes = await readFile(path);
  if (bytes.length >= 100_000_000) throw new Error(`${name} exceeds the archive size limit`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const checksum = await readFile(`${path}.sha256`);
  if (checksum.toString('utf8') !== `${hash}  ${name}\n`) throw new Error(`Checksum mismatch: ${name}`);
  const info = name.endsWith('.zip')
    ? JSON.parse(Buffer.from(unzipSync(bytes)['build-info.json']).toString('utf8'))
    : JSON.parse(execFileSync('tar', ['-xOf', path, 'package/dist/build-info.json'], { encoding: 'utf8' }));
  if (info.source_commit !== commit || info.version !== pkg.version) throw new Error(`Stale or mismatched build: ${name}`);
  assets.push(path, `${path}.sha256`);
  expected.set(name, { size: bytes.length, digest: `sha256:${hash}` });
  expected.set(`${name}.sha256`, { size: checksum.length, digest: `sha256:${createHash('sha256').update(checksum).digest('hex')}` });
}
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `ACTS Excel ${pkg.version}`, '--notes-file', values['notes-file'], ...(values.prerelease ? ['--prerelease'] : []), ...assets]);
const { apiUrl } = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'apiUrl']));
const uploaded = JSON.parse(gh(['api', apiUrl]));
if (uploaded.assets.length !== expected.size) throw new Error('Uploaded asset count differs; release remains a draft');
for (const asset of uploaded.assets) {
  const file = expected.get(asset.name);
  if (!file || asset.state !== 'uploaded' || asset.size !== file.size || (asset.digest && asset.digest !== file.digest)) throw new Error(`Upload verification failed for ${asset.name}; release remains a draft`);
}
gh(['release', 'edit', tag, '--repo', repo, '--draft=false']);
console.log(JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'url'])).url);
