import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const agentPath = join(root, '.github', 'agents', 'abap-developer.agent.md');
const skillsRoot = join(root, '.github', 'skills');
const expectedSkills = [
  'abap-debugging',
  'abap-development',
  'abap-runtime-analysis',
  'abap-testing-quality',
  'cds-development',
  'rap-development',
  'rap-service-delivery',
  'sap-transport-release'
];

async function readMarkdown(path) {
  return readFile(path, 'utf8');
}

function parseFrontmatter(markdown, path) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match, `${path} must start with YAML frontmatter`);
  const metadata = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `${path} has invalid frontmatter line: ${line}`);
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return metadata;
}

function assertMentionsLiveToolDiscovery(markdown, path) {
  assert.match(markdown, /tools\/list/i, `${path} must require live MCP tool discovery`);
  assert.match(markdown, /destination-prefixed|destination-prefixed names/i, `${path} must tell agents to use actual destination-prefixed tool names`);
  assert.match(markdown, /schema/i, `${path} must tell agents to follow live tool schemas`);
}

function assertValidationPolicy(markdown, path) {
  assert.match(markdown, /ABAP Unit|RunUnitTests/i, `${path} must include ABAP Unit or test execution guidance`);
  assert.match(markdown, /runtime validation|Self-validate|executable validation|reproduce/i, `${path} must require executable/runtime validation evidence`);
  assert.match(markdown, /activate|activation/i, `${path} must handle activation state or blockers`);
  assert.match(markdown, /report|Record|document/i, `${path} must require observed outcome reporting`);
}

function assertNoUnsafeTransportClaims(markdown, path) {
  const releaseMentions = markdown.match(/ReleaseTransport|release\/deletion|release and deletion|release is unavailable|release action/gi) || [];
  assert.ok(releaseMentions.length > 0 || !/transport/i.test(markdown), `${path} transport guidance should explicitly handle release limitations when transport is discussed`);
  assert.doesNotMatch(markdown, /use\s+`?ReleaseTransport`?|call\s+`?ReleaseTransport`?|with\s+`?ReleaseTransport`?/i, `${path} must not instruct the agent to release transports through this addon`);
  assert.doesNotMatch(markdown, /use\s+`?DeleteTransport`?|call\s+`?DeleteTransport`?|with\s+`?DeleteTransport`?/i, `${path} must not instruct the agent to delete transports through this addon`);
}

test('packaged Copilot agent and skill inventory is complete and canonical', async () => {
  assert.equal((await stat(agentPath)).isFile(), true);
  const actualSkills = (await readdir(skillsRoot)).sort();
  assert.deepEqual(actualSkills, expectedSkills);
  for (const skill of expectedSkills) {
    assert.equal((await stat(join(skillsRoot, skill, 'SKILL.md'))).isFile(), true, `${skill} must have SKILL.md`);
  }
});

test('ABAP Developer agent has valid metadata and invokes the packaged skills', async () => {
  const markdown = await readMarkdown(agentPath);
  const metadata = parseFrontmatter(markdown, agentPath);
  assert.deepEqual(Object.keys(metadata).sort(), ['description', 'name', 'target', 'user-invocable']);
  assert.equal(metadata.name, 'ABAP Developer');
  assert.equal(metadata.target, 'vscode');
  assert.equal(metadata['user-invocable'], 'true');
  assert.match(metadata.description, /ABAP/i);
  assert.match(metadata.description, /BAS|SAP/i);

  for (const skill of ['ABAP implementation', 'RAP', 'CDS', 'debugging', 'transport']) {
    assert.match(markdown, new RegExp(skill, 'i'), `agent should route to ${skill} skill guidance`);
  }
  assertMentionsLiveToolDiscovery(markdown, agentPath);
  assertValidationPolicy(markdown, agentPath);
  assertNoUnsafeTransportClaims(markdown, agentPath);
});

test('each skill has valid metadata, matching name, and enforceable live-tool validation policy', async () => {
  for (const skill of expectedSkills) {
    const path = join(skillsRoot, skill, 'SKILL.md');
    const markdown = await readMarkdown(path);
    const metadata = parseFrontmatter(markdown, path);
    assert.deepEqual(Object.keys(metadata).sort(), ['description', 'name']);
    assert.equal(metadata.name, skill, `${skill} frontmatter name must match its directory`);
    assert.ok(metadata.description.length >= 40, `${skill} needs a useful description`);
    assert.match(markdown, /^#\s+\S.+$/m, `${skill} must have a top-level heading`);
    assertMentionsLiveToolDiscovery(markdown, path);
    assertNoUnsafeTransportClaims(markdown, path);
  }
});

test('implementation-oriented skills require tests, runtime evidence, activation, and separate reporting', async () => {
  for (const skill of ['abap-development', 'abap-testing-quality', 'cds-development', 'rap-development', 'sap-transport-release']) {
    const path = join(skillsRoot, skill, 'SKILL.md');
    const markdown = await readMarkdown(path);
    assertValidationPolicy(markdown, path);
    assert.match(markdown, /do not (?:treat|present|claim)|never report|not replace|not .*substitutes?/i, `${skill} must explicitly prevent substituting static checks for behavior evidence`);
  }
});

test('debugging skill requires evidence before fixes and bounded debugger use', async () => {
  const path = join(skillsRoot, 'abap-debugging', 'SKILL.md');
  const markdown = await readMarkdown(path);
  assert.match(markdown, /reproduce/i);
  assert.match(markdown, /dumps?|ListDumps/i);
  assert.match(markdown, /DebuggerDetach/i);
  assert.match(markdown, /Avoid attaching to another user's session|do not.*another user's session/i);
  assert.match(markdown, /before changing code|before proposing a cause/i);
});
