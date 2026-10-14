import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

export async function validatePortableCommand(command, root) {
  if (typeof command !== 'string' || !command || command !== command.trim()) throw new Error('Portable MCP command must be a bare executable name or a contained ./ path');
  if (/^[A-Za-z0-9_.-]+$/.test(command) && command !== '.' && command !== '..') return;
  const segments = command.startsWith('./') ? command.slice(2).split('/') : [];
  if (!segments.length || segments.some(part => !part || part === '.' || part === '..' || /[\\:$\x00-\x1f]/.test(part))) throw new Error(`Portable MCP command must be a bare executable name or a contained ./ path: ${command}`);
  const base = await realpath(root);
  const executable = await realpath(resolve(base, ...segments));
  const path = relative(base, executable);
  if (!path || path.startsWith('..') || isAbsolute(path) || !(await stat(executable)).isFile()) throw new Error(`Portable MCP executable must be a file inside the plugin: ${command}`);
}
