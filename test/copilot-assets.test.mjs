import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installUserCopilotAssets } from '../scripts/install-user-copilot-assets.mjs';

async function writeAsset(root, path, content) {
  const filename = join(root, '.github', path);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

test('updates unchanged global assets and preserves user-edited customizations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bas-copilot-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'package');
  const home = join(directory, 'home');
  const agentSource = 'agents/abap-developer.agent.md';
  const skillSource = 'skills/example/SKILL.md';
  await writeAsset(root, agentSource, 'agent revision one');
  await writeAsset(root, skillSource, 'skill revision one');

  const initial = await installUserCopilotAssets({ home, root });
  assert.equal(initial.installed, 2);
  assert.deepEqual(initial.conflicts, []);

  await writeFile(join(home, '.copilot', 'agents', 'abap-developer.agent.md'), 'user customization');
  await writeAsset(root, agentSource, 'agent revision two');
  await writeAsset(root, skillSource, 'skill revision two');
  const update = await installUserCopilotAssets({ home, root });

  assert.equal(update.updated, 1);
  assert.deepEqual(update.conflicts, [join('agents', 'abap-developer.agent.md')]);
  assert.equal(await readFile(join(home, '.copilot', 'agents', 'abap-developer.agent.md'), 'utf8'), 'user customization');
  assert.equal(await readFile(join(home, '.copilot', 'skills', 'example', 'SKILL.md'), 'utf8'), 'skill revision two');
});
