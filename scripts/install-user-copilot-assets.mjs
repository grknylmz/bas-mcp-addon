import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestName = '.bas-mcp-addon-assets.json';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function collectFiles(sourceRoot, targetPrefix, relativePath = '') {
  const files = [];
  const entries = await readdir(join(sourceRoot, relativePath), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const childPath = join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(sourceRoot, targetPrefix, childPath));
    } else if (entry.isFile()) {
      files.push({ source: join(sourceRoot, childPath), target: join(targetPrefix, childPath) });
    }
  }
  return files;
}

async function readManagedFiles(path) {
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest === null || typeof manifest !== 'object' || manifest.version !== 1 || manifest.files === null || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) return {};
    return manifest.files;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function replaceFile(path, content) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function installUserCopilotAssets({ home = process.env.HOME || homedir(), root = packageRoot } = {}) {
  const sourceRoot = join(root, '.github');
  const files = [
    ...await collectFiles(join(sourceRoot, 'agents'), 'agents'),
    ...await collectFiles(join(sourceRoot, 'skills'), 'skills')
  ];
  if (!files.some(file => file.target === join('agents', 'abap-developer.agent.md'))) {
    throw new Error('Packaged ABAP Developer agent profile is missing');
  }
  if (!files.some(file => file.target.startsWith(`skills${sep}`) && file.target.endsWith('SKILL.md'))) {
    throw new Error('Packaged Agent Skills are missing');
  }

  const copilotRoot = join(home, '.copilot');
  const manifestPath = join(copilotRoot, manifestName);
  await mkdir(copilotRoot, { recursive: true, mode: 0o755 });
  const previousFiles = await readManagedFiles(manifestPath);
  const managedFiles = { ...previousFiles };
  const conflicts = [];
  let installed = 0;
  let updated = 0;
  let unchanged = 0;

  for (const file of files) {
    const destination = join(copilotRoot, file.target);
    const content = await readFile(file.source);
    const contentHash = digest(content);
    await mkdir(dirname(destination), { recursive: true, mode: 0o755 });

    let existing;
    try {
      existing = await readFile(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await writeFile(destination, content, { flag: 'wx', mode: 0o644 });
        managedFiles[file.target] = contentHash;
        installed += 1;
        continue;
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        existing = await readFile(destination);
      }
    }

    const existingHash = digest(existing);
    if (existingHash === contentHash) {
      managedFiles[file.target] = contentHash;
      unchanged += 1;
    } else if (previousFiles[file.target] === existingHash) {
      await replaceFile(destination, content);
      managedFiles[file.target] = contentHash;
      updated += 1;
    } else {
      conflicts.push(file.target);
    }
  }

  await replaceFile(manifestPath, `${JSON.stringify({ version: 1, files: managedFiles }, null, 2)}\n`);
  return { root: copilotRoot, installed, updated, unchanged, conflicts };
}
