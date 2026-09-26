import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brandedEnvValue } from '../src/branding.mjs';

const exec = promisify(execFile);
export const GO_VERSION = brandedEnvValue(process.env, 'GO_VERSION') || 'go1.27.1';
const GO_RELEASES = {
  'linux:x64': { archive: `${GO_VERSION}.linux-amd64.tar.gz`, sha256: '63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445' },
  'linux:arm64': { archive: `${GO_VERSION}.linux-arm64.tar.gz`, sha256: '3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec' }
};

function localGoPath() {
  return join(brandedEnvValue(process.env, 'GO_ROOT') || join(homedir(), '.local', 'go'), GO_VERSION, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
}

function candidateGo() {
  if (process.env.GO_BINARY) return process.env.GO_BINARY;
  const result = spawnSync('go', ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status === 0) return 'go';
  const local = localGoPath();
  const localResult = spawnSync(local, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return localResult.status === 0 ? local : null;
}

export async function installGo() {
  const release = GO_RELEASES[`${process.platform}:${process.arch}`];
  if (!release) throw new Error(`Go is missing and automatic installation is supported only for Linux x64/arm64. Install ${GO_VERSION} manually and ensure go is on PATH.`);
  const response = await fetch(`https://go.dev/dl/${release.archive}`);
  if (!response.ok) throw new Error(`Go download failed with HTTP ${response.status}; install ${GO_VERSION} manually and ensure go is on PATH.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  const expected = brandedEnvValue(process.env, 'GO_SHA256') || release.sha256;
  if (actual !== expected) throw new Error(`Go checksum mismatch for ${release.archive}`);
  const root = join(brandedEnvValue(process.env, 'GO_ROOT') || join(homedir(), '.local', 'go'), GO_VERSION);
  await mkdir(root, { recursive: true, mode: 0o755 });
  const archive = join(tmpdir(), `${release.archive}.${process.pid}`);
  await writeFile(archive, bytes, { mode: 0o600 });
  await exec('tar', ['-xzf', archive, '-C', root, '--strip-components=1'], { stdio: 'inherit' });
  await rm(archive, { force: true });
  const goPath = join(root, 'bin', 'go');
  await chmod(goPath, 0o755);
  const userBin = join(homedir(), '.local', 'bin');
  await mkdir(userBin, { recursive: true, mode: 0o755 });
  try { await symlink(goPath, join(userBin, process.platform === 'win32' ? 'go.exe' : 'go')); } catch {}
  return goPath;
}

export async function ensureGo() {
  const existing = candidateGo();
  if (existing) return existing;
  return installGo();
}

if (process.argv[1]?.endsWith('ensure-go.mjs')) {
  ensureGo().then(path => console.error(`Go available at ${path}`)).catch(error => { console.error(`ensure-go: ${error.message}`); process.exitCode = 1; });
}
