import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMcpEntries, collectCloudFoundryKeyReferencesFromAllEntries, collectManagedCloudFoundryKeyReferences, installMcpConfig, readMcpConfig } from '../src/mcp-config.mjs';

const bas = {
  source: 'bas', name: 'shared', serverName: 'shared', url: 'http://shared.dest',
  client: '001', authentication: 'NoAuthentication', probe: { status: 'available', available: true }
};

function cfDestination(spaceGuid, destinationInstanceGuid, keyName, proxyType = 'Internet') {
  return {
    source: 'cloud-foundry',
    name: 'shared',
    serverName: `cf:${spaceGuid}:${destinationInstanceGuid}:shared`,
    client: '100',
    authentication: 'BasicAuthentication',
    proxyType,
    probe: { status: 'auth-required', available: true },
    cf: {
      spaceGuid,
      destinationInstanceGuid,
      destinationInstanceName: `destination-${destinationInstanceGuid}`,
      destinationKeyName: keyName,
      ...(proxyType === 'OnPremise' ? {
        connectivityInstanceGuid: 'connectivity-guid',
        connectivityInstanceName: 'connectivity-service',
        connectivityKeyName: 'connectivity-key'
      } : {})
    }
  };
}

test('writes source-qualified CF entries beside same-named BAS destinations', () => {
  const first = cfDestination('space-one', 'instance-one', 'key-one');
  const second = cfDestination('space-one', 'instance-two', 'key-two');
  const entries = buildMcpEntries([bas, first, second], { H2O_URL: 'http://h2o.example' });
  assert.deepEqual(Object.keys(entries).sort(), [
    'cf:space-one:instance-one:shared',
    'cf:space-one:instance-two:shared',
    'shared'
  ]);
  assert.deepEqual(entries['cf:space-one:instance-one:shared'].env, {
    H2O_URL: 'http://h2o.example',
    SAP_ALLOW_TRANSPORTABLE_EDITS: 'true',
    SAP_AI_DEV_TOOLKIT_DESTINATION_SOURCE: 'cloud-foundry',
    SAP_AI_DEV_TOOLKIT_DESTINATION: 'shared',
    BAS_CF_SPACE_GUID: 'space-one',
    BAS_CF_DESTINATION_INSTANCE_GUID: 'instance-one',
    BAS_CF_DESTINATION_INSTANCE: 'destination-instance-one',
    BAS_CF_DESTINATION_KEY: 'key-one',
    BAS_CF_DESTINATION_NAME: 'shared'
  });
  assert.equal(entries.shared.env.SAP_AI_DEV_TOOLKIT_DESTINATION, 'shared');
  assert.equal(JSON.stringify(entries).includes('shared.dest'), false);
  assert.equal(JSON.stringify(entries).includes('Password'), false);

  const onPremise = buildMcpEntries([cfDestination('space-one', 'onprem-instance', 'destination-key', 'OnPremise')], { H2O_URL: 'http://h2o.example' });
  assert.equal(onPremise['cf:space-one:onprem-instance:shared'].env.BAS_CF_CONNECTIVITY_KEY, 'connectivity-key');
});

test('extracts key references only from package-managed Cloud Foundry entries', () => {
  const cloudFoundry = buildMcpEntries([
    cfDestination('space-one', 'instance-one', 'destination-key', 'OnPremise')
  ], { H2O_URL: 'http://h2o.example' })['cf:space-one:instance-one:shared'];
  const managedNpx = {
    ...cloudFoundry,
    command: 'npx',
    args: ['--yes', '--package=sap-ai-dev-toolkit@0.1.0', 'sap-ai-dev-toolkit']
  };
  const config = { servers: {
    first: cloudFoundry,
    duplicate: managedNpx,
    unmanaged: { ...cloudFoundry, BAS_EXT: undefined },
    otherPackage: { ...cloudFoundry, command: 'other' },
    otherSource: { ...cloudFoundry, env: { ...cloudFoundry.env, SAP_AI_DEV_TOOLKIT_DESTINATION_SOURCE: 'bas' } }
  } };
  assert.deepEqual(collectManagedCloudFoundryKeyReferences(config), [
    { kind: 'destination', spaceGuid: 'space-one', instanceGuid: 'instance-one', instanceName: 'destination-instance-one', keyName: 'destination-key' },
    { kind: 'connectivity', spaceGuid: 'space-one', instanceGuid: 'connectivity-guid', instanceName: 'connectivity-service', keyName: 'connectivity-key' }
  ]);
  const userConfig = { servers: {
    customServer: { command: 'custom-launcher', env: { ...cloudFoundry.env, SAP_AI_DEV_TOOLKIT_DESTINATION_SOURCE: undefined } },
    noEnvironment: { command: 'custom-launcher' }
  } };
  assert.deepEqual(collectCloudFoundryKeyReferencesFromAllEntries(userConfig), [
    { kind: 'destination', spaceGuid: 'space-one', instanceGuid: 'instance-one', instanceName: 'destination-instance-one', keyName: 'destination-key' },
    { kind: 'connectivity', spaceGuid: 'space-one', instanceGuid: 'connectivity-guid', instanceName: 'connectivity-service', keyName: 'connectivity-key' }
  ]);
});

test('installs and removes CF entries without deleting unrelated MCP servers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bas-mcp-cf-config-'));
  const path = join(directory, 'mcp.json');
  await writeFile(path, JSON.stringify({
    unrelated: true,
    servers: { userServer: { type: 'stdio', command: 'custom-server' } }
  }));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await installMcpConfig([bas, cfDestination('space-one', 'instance-one', 'managed-key')], {
    env: { H2O_URL: 'http://h2o.example' },
    path,
    command: 'npx',
    args: ['--yes', '--package=sap-ai-dev-toolkit@0.1.0', 'sap-ai-dev-toolkit']
  });
  assert.deepEqual(Object.keys(result.servers).sort(), ['cf:space-one:instance-one:shared', 'shared']);
  const written = await readMcpConfig(path);
  assert.equal(written.unrelated, true);
  assert.deepEqual(Object.keys(written.servers).sort(), ['cf:space-one:instance-one:shared', 'shared', 'userServer']);
  assert.deepEqual(collectManagedCloudFoundryKeyReferences(written), [
    { kind: 'destination', spaceGuid: 'space-one', instanceGuid: 'instance-one', instanceName: 'destination-instance-one', keyName: 'managed-key' }
  ]);

  await installMcpConfig([], { env: { H2O_URL: 'http://h2o.example' }, path });
  const cleared = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(Object.keys(cleared.servers), ['userServer']);
});

test('wizard replaces legacy launcher entries with the branded command and environment', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sap-ai-toolkit-migration-'));
  const path = join(directory, 'mcp.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({
    servers: {
      shared: {
        type: 'stdio',
        command: 'bas-vsp-mcp',
        env: { H2O_URL: 'http://h2o.example', BAS_VSP_DESTINATION: 'shared' },
        BAS_EXT: 'true'
      },
      userServer: { type: 'stdio', command: 'custom-server' }
    }
  }));

  await installMcpConfig([bas], { env: { H2O_URL: 'http://h2o.example', BAS_VSP_MCP_CONFIG: path } });
  const migrated = await readMcpConfig(path);
  assert.deepEqual(Object.keys(migrated.servers).sort(), ['shared', 'userServer']);
  assert.equal(migrated.servers.shared.command, 'sap-ai-dev-toolkit');
  assert.equal(migrated.servers.shared.env.SAP_AI_DEV_TOOLKIT_DESTINATION, 'shared');
  assert.equal(migrated.servers.shared.env.BAS_VSP_DESTINATION, undefined);
  assert.equal(migrated.servers.userServer.command, 'custom-server');
});

test('recognizes old npx Cloud Foundry entries so setup can reuse their service keys', () => {
  const current = buildMcpEntries([cfDestination('space-one', 'instance-one', 'old-key')], { H2O_URL: 'http://h2o.example' })['cf:space-one:instance-one:shared'];
  const legacy = {
    ...current,
    command: 'npx',
    args: ['--yes', '--package=bas-mcp-addon@0.1.0', 'bas-vsp-mcp'],
    env: {
      ...current.env,
      BAS_VSP_DESTINATION_SOURCE: current.env.SAP_AI_DEV_TOOLKIT_DESTINATION_SOURCE,
      BAS_VSP_DESTINATION: current.env.SAP_AI_DEV_TOOLKIT_DESTINATION
    }
  };
  delete legacy.env.SAP_AI_DEV_TOOLKIT_DESTINATION_SOURCE;
  delete legacy.env.SAP_AI_DEV_TOOLKIT_DESTINATION;
  assert.deepEqual(collectManagedCloudFoundryKeyReferences({ servers: { legacy } }), [
    { kind: 'destination', spaceGuid: 'space-one', instanceGuid: 'instance-one', instanceName: 'destination-instance-one', keyName: 'old-key' }
  ]);
});
