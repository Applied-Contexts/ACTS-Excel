export const targets = {
  'darwin-arm64': 'osx_arm64',
  'darwin-x64': 'osx_amd64',
  'linux-arm64': 'linux_arm64',
  'linux-arm64-musl': 'linux_arm64_musl',
  'linux-x64': 'linux_amd64',
  'linux-x64-musl': 'linux_amd64_musl',
  'win32-arm64': 'windows_arm64',
  'win32-x64': 'windows_amd64',
};

export const archiveLimit = 100_000_000;

export function validateTarget(target) {
  if (!Object.hasOwn(targets, target)) throw new Error(`Unsupported target ${target}. Choose: ${Object.keys(targets).join(', ')}`);
  return target;
}
