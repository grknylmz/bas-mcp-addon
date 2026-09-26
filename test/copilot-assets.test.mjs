import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

test('migrates the previous managed-file manifest without losing update ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sap-ai-toolkit-assets-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'package');
  const home = join(directory, 'home');
  const target = join(home, '.copilot', 'agents', 'abap-developer.agent.md');
  const oldManifest = join(home, '.copilot', '.bas-mcp-addon-assets.json');
  await writeAsset(root, 'agents/abap-developer.agent.md', 'managed revision one');
  await writeAsset(root, 'skills/example/SKILL.md', 'skill revision one');
  const first = await installUserCopilotAssets({ home, root });
  assert.equal(first.installed, 2);

  const managedContent = await readFile(target);
  const managedHash = createHash('sha256').update(managedContent).digest('hex');
  await rm(join(home, '.copilot', '.sap-ai-dev-toolkit-assets.json'));
  await writeFile(oldManifest, JSON.stringify({ version: 1, files: { [join('agents', 'abap-developer.agent.md')]: managedHash } }));
  await writeAsset(root, 'agents/abap-developer.agent.md', 'managed revision two');

  const migrated = await installUserCopilotAssets({ home, root });
  assert.equal(migrated.updated, 1);
  assert.equal(await readFile(target, 'utf8'), 'managed revision two');
  await assert.rejects(readFile(oldManifest), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(home, '.copilot', '.sap-ai-dev-toolkit-assets.json'), 'utf8')).version, 1);
});
