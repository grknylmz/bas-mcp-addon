import { mkdtemp, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mutants = [
  {
    name: 'wide progress emoji returns',
    mutate: source => source.replace("progress: { icon: '…', color: 'cyan' }", "progress: { icon: '⏳', color: 'cyan' }")
  },
  {
    name: 'animated spinner frames return',
    mutate: source => source.replace("spinner: { interval: 80, frames: [''] }", "spinner: { interval: 80, frames: ['⠇'] }")
  },
  {
    name: 'prompt output no longer exposes terminal columns',
    mutate: source => source.replace("for (const property of ['isTTY', 'columns', 'rows'])", "for (const property of ['isTTY', 'rows'])")
  },
  {
    name: 'prompt output no longer exposes terminal rows',
    mutate: source => source.replace("for (const property of ['isTTY', 'columns', 'rows'])", "for (const property of ['isTTY', 'columns'])")
  }
];

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

const root = process.cwd();
let survived = 0;

for (const mutant of mutants) {
  const directory = await mkdtemp(join(tmpdir(), 'bas-mutation-'));
  try {
    await cp(join(root, 'src'), join(directory, 'src'), { recursive: true });
    await cp(join(root, 'test'), join(directory, 'test'), { recursive: true });
    const path = join(directory, 'src', 'terminal-ui.mjs');
    const original = await readFile(path, 'utf8');
    const mutated = mutant.mutate(original);
    if (mutated === original) throw new Error(`Mutant did not change source: ${mutant.name}`);
    await writeFile(path, mutated);

    const result = await run(process.execPath, ['--test', join(directory, 'test', 'terminal-ui.test.mjs')], { cwd: directory });
    if (result.code === 0) {
      survived += 1;
      console.error(`SURVIVED: ${mutant.name}`);
      console.error(result.stdout);
      console.error(result.stderr);
    } else {
      console.log(`KILLED: ${mutant.name}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (survived > 0) {
  console.error(`${survived} mutation(s) survived`);
  process.exit(1);
}
console.log(`All ${mutants.length} terminal UI mutants killed.`);
