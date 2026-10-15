export const targets = {
  'darwin-arm64': 'osx_arm64',
  'darwin-x64': 'osx_amd64',
  'linux-arm64': 'linux_arm64',
  'linux-x64': 'linux_amd64',
  'win32-arm64': 'windows_arm64',
  'win32-x64': 'windows_amd64',
};

export const architectures = ['x64', 'arm64'];
export const archiveLimit = 100_000_000;
export const extractedLimit = 512 * 1024 * 1024;
