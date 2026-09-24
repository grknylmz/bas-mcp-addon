import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const UPSTREAM_COMMIT = '9886d2727f47506368b0a3c2f1c1766f1200f747';

const platformMap = {
  'linux:x64': ['linux', 'x64', ''],
  'linux:arm64': ['linux', 'arm64', ''],
  'darwin:x64': ['darwin', 'x64', ''],
  'darwin:arm64': ['darwin', 'arm64', ''],
  'win32:x64': ['windows', 'x64', '.exe']
};

export function binaryTarget(platform = process.platform, arch = process.arch) {
  const target = platformMap[`${platform}:${arch}`];
  if (!target) throw new Error(`Unsupported platform ${platform}/${arch}. Set BAS_VSP_BINARY or build cmd/vsp with scripts/build-vsp.mjs.`);
  return { os: target[0], arch: target[1], extension: target[2], asset: `vsp-${target[0]}-${target[1]}${target[2]}` };
}

export function bundledBinaryPath(platform = process.platform, arch = process.arch) {
  return join(packageRoot, 'dist', binaryTarget(platform, arch).asset);
}

export function packageRepositoryUrl(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) throw new Error('package.json repository.url is required to resolve VSP release assets');
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
}

export function releaseBaseUrl(pkg, version = pkg.version) {
  const override = process.env.BAS_VSP_RELEASE_BASE_URL;
  if (override) return `${override.replace(/\/$/, '')}/v${version}`;
  const repo = packageRepositoryUrl(pkg).replace(/^ssh:\/\/git@github.com:/, 'https://github.com/').replace(/^git@github.com:/, 'https://github.com/');
  if (!repo.startsWith('http')) throw new Error('package repository URL must be an HTTPS URL for release assets');
  return `${repo}/releases/download/v${version}`;
}

export function cacheDirectory() {
  return process.env.BAS_VSP_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'bas-mcp-addon');
}

export function cachedBinaryPath(pkg, platform = process.platform, arch = process.arch) {
  const target = binaryTarget(platform, arch);
  return join(cacheDirectory(), `${pkg.name}-${pkg.version}-${target.asset}`);
}

export async function findBinary(pkg, options = {}) {
  const env = options.env || process.env;
  if (env.BAS_VSP_BINARY) return env.BAS_VSP_BINARY;
  if (!env.BAS_VSP_BINARY_URL) {
    const bundled = bundledBinaryPath(options.platform, options.arch);
    try { await stat(bundled); return bundled; } catch {}
  }
  const path = cachedBinaryPath(pkg, options.platform, options.arch);
  try { await stat(path); return path; } catch { return null; }
}

export async function installBinary(pkg, options = {}) {
  const env = options.env || process.env;
  if (env.BAS_VSP_BINARY) return env.BAS_VSP_BINARY;
  if (!env.BAS_VSP_BINARY_URL) {
    const bundled = bundledBinaryPath(options.platform, options.arch);
    try { await stat(bundled); return bundled; } catch {}
  }
  const target = binaryTarget(options.platform, options.arch);
  const base = releaseBaseUrl(pkg, pkg.version);
  const assetUrl = env.BAS_VSP_BINARY_URL || `${base}/${target.asset}`;
  const checksumUrl = `${base}/checksums.txt`;
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(`VSP binary download failed (${response.status}); set BAS_VSP_BINARY or BAS_VSP_BINARY_URL`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const checksumResponse = await fetch(checksumUrl);
  if (!checksumResponse.ok) throw new Error(`VSP checksum download failed (${checksumResponse.status}); set BAS_VSP_BINARY or BAS_VSP_BINARY_URL`);
  const checksumText = await checksumResponse.text();
  const expected = checksumText.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts.length >= 2 && (parts[1] === target.asset || parts[1].endsWith(`/${target.asset}`)))?.[0];
  if (!expected) throw new Error(`checksums.txt has no entry for ${target.asset}; set BAS_VSP_BINARY or BAS_VSP_BINARY_URL`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`VSP checksum mismatch for ${target.asset}`);
  const dir = cacheDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const destination = cachedBinaryPath(pkg, options.platform, options.arch);
  const temporary = join(tmpdir(), `bas-vsp-${process.pid}-${Date.now()}`);
  await writeFile(temporary, bytes, { mode: 0o700 });
  await chmod(temporary, 0o700);
  await rename(temporary, destination);
  await chmod(destination, 0o700);
  return destination;
}

export async function ensureBinary(pkg, options = {}) {
  const existing = await findBinary(pkg, options);
  if (existing) return existing;
  return installBinary(pkg, options);
}
