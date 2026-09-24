import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { discoverCloudFoundryDestinations, getCloudFoundryTarget, resolveConfiguredCloudFoundryDestination } from '../src/cf-destination.mjs';

const SPACE_GUID = 'space-123';
const DESTINATION_GUID = 'destination-instance-123';
const DESTINATION_INSTANCE = 'destination-service';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockCf({ origin, instances = true, spaceGuid = SPACE_GUID } = {}) {
  const calls = [];
  const createdKeys = [];
  const credentials = {
    uri: origin,
    url: `${origin}/uaa`,
    clientid: 'destination-client',
    clientsecret: 'destination-service-secret'
  };
  const execFileImpl = (_command, args, _options, callback) => {
    calls.push([...args]);
    let output = '';
    const path = args[0] === 'curl' ? args[1] : '';
    if (args[0] === 'version') output = 'cf version 8.18.0+1234567';
    else if (args[0] === 'target') output = 'space: MASS\n';
    else if (args[0] === 'space' && args[1] === 'MASS' && args[2] === '--guid') output = `${spaceGuid}\n`;
    else if (args[0] === 'oauth-token') output = 'bearer cf-user-jwt';
    else if (args[0] === 'curl' && path.startsWith('/v3/service_instances?')) {
      output = JSON.stringify({ resources: instances ? [{
        guid: DESTINATION_GUID,
        name: DESTINATION_INSTANCE,
        relationships: {
          service_plan: { data: { guid: 'plan-guid' } },
          space: { data: { guid: SPACE_GUID } }
        }
      }] : [] });
    } else if (args[0] === 'curl' && path === `/v3/service_instances/${DESTINATION_GUID}`) {
      output = JSON.stringify({
        guid: DESTINATION_GUID,
        name: DESTINATION_INSTANCE,
        relationships: { space: { data: { guid: SPACE_GUID } } }
      });
    } else if (args[0] === 'curl' && path === '/v3/service_plans/plan-guid') {
      output = JSON.stringify({ relationships: { service_offering: { data: { guid: 'offering-guid' } } } });
    } else if (args[0] === 'curl' && path === '/v3/service_offerings/offering-guid') {
      output = JSON.stringify({ name: 'Destination' });
    } else if (args[0] === 'create-service-key') {
      createdKeys.push({ instanceName: args[1], keyName: args[2] });
    } else if (args[0] === 'service-key' && args[1] === '--json') {
      output = JSON.stringify({ credentials: { ...credentials, uri: origin } });
    } else {
      callback(new Error('untrusted CLI stderr with secret=must-not-leak'), '', 'secret=must-not-leak');
      return;
    }
    callback(null, output, '');
  };
  return { calls, createdKeys, credentials, execFileImpl };
}

function destinationApi(records, detail) {
  const observed = { tokenAuthorization: [], listAuthorization: [], adtAuthorization: [], detailRequests: [] };
  const server = createServer((request, response) => {
    if (request.url === '/uaa/oauth/token') {
      observed.tokenAuthorization.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'api-access-token', expires_in: 300 }));
      return;
    }
    if (request.url === '/destination-configuration/v1/instanceDestinations') {
      observed.listAuthorization.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(records));
      return;
    }
    if (request.url === `/destination-configuration/v1/instanceDestinations/${encodeURIComponent(detail?.name || '')}` && detail) {
      observed.detailRequests.push(request.url);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(detail.body));
      return;
    }
    if (request.url === '/sap/bc/adt/discovery') {
      observed.adtAuthorization.push(request.headers.authorization);
      response.writeHead(401);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return { server, observed };
}

const envForLocal = () => ({ PATH: process.env.PATH, HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '127.0.0.1,localhost' });

test('imports instance Destination records with redacted descriptors and disables unsupported records', async t => {
  let origin;
  const records = [
    {
      Name: 'internet-basic',
      Type: 'hTtP',
      URL: 'http://127.0.0.1:1',
      Authentication: 'bAsIcAuThEnTiCaTiOn',
      ProxyType: 'iNtErNeT',
      Properties: [
        { Key: 'sap-client', Value: '123' },
        { Key: 'User', Value: 'sap-user' },
        { Key: 'Password', Value: 'sap-password' }
      ]
    },
    { Name: 'detail system' },
    { Name: 'not-http', Type: 'RFC', URL: 'http://127.0.0.1:1', Authentication: 'NoAuthentication', ProxyType: 'Internet' },
    { Name: 'userinfo-url', Type: 'HTTP', URL: 'http://user:password@127.0.0.1:1', Authentication: 'NoAuthentication', ProxyType: 'Internet' },
    { Name: 'incomplete-basic', Type: 'HTTP', URL: 'http://127.0.0.1:1', Authentication: 'BasicAuthentication', ProxyType: 'Internet', User: 'only-user' },
    { Name: '', Type: 'HTTP', URL: 'http://127.0.0.1:1', Authentication: 'NoAuthentication', ProxyType: 'Internet' }
  ];
  const api = destinationApi(records, {
    name: 'detail system',
    body: { destinationConfiguration: {
      Name: 'detail system', Type: 'HTTP', URL: 'http://127.0.0.1:1',
      Authentication: 'NoAuthentication', ProxyType: 'Internet',
      Properties: [{ Key: 'sap-client', Value: '250' }]
    } }
  });
  origin = await listen(api.server);
  // Point service-key credentials at the local Destination API while retaining a separate SAP target.
  const targetServer = createServer((request, response) => {
    if (request.url === '/sap/bc/adt/discovery') {
      api.observed.adtAuthorization.push(request.headers.authorization);
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const targetOrigin = await listen(targetServer);
  t.after(async () => {
    await new Promise(resolve => api.server.close(resolve));
    await new Promise(resolve => targetServer.close(resolve));
  });

  records[0].URL = targetOrigin;
  records[1] = { Name: 'detail system' };
  api.server.removeAllListeners('request');
  api.server.on('request', (request, response) => {
    if (request.url === '/uaa/oauth/token') {
      api.observed.tokenAuthorization.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'api-access-token', expires_in: 300 }));
    } else if (request.url === '/destination-configuration/v1/instanceDestinations') {
      api.observed.listAuthorization.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(records));
    } else if (request.url === `/destination-configuration/v1/instanceDestinations/detail%20system`) {
      api.observed.detailRequests.push(request.url);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ destinationConfiguration: {
        Name: 'detail system', Type: 'HTTP', URL: targetOrigin,
        Authentication: 'NoAuthentication', ProxyType: 'Internet',
        Properties: [{ Key: 'sap-client', Value: '250' }]
      } }));
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  const cf = mockCf({ origin });
  const result = await discoverCloudFoundryDestinations({
    env: envForLocal(), spaceGuid: SPACE_GUID, execFileImpl: cf.execFileImpl,
    fetchImpl: globalThis.fetch, input: process.stdin, output: process.stdout
  });

  assert.equal(cf.createdKeys.length, 1);
  assert.match(cf.createdKeys[0].keyName, /^bas-mcp-addon-[0-9a-f-]{36}$/);
  assert.deepEqual(result.createdKeys.map(({ kind, spaceGuid, instanceGuid, instanceName, keyName }) => [kind, spaceGuid, instanceGuid, instanceName, keyName]), [
    ['destination', SPACE_GUID, DESTINATION_GUID, DESTINATION_INSTANCE, cf.createdKeys[0].keyName]
  ]);
  const imported = result.destinations.find(item => item.name === 'internet-basic');
  assert.equal(imported.source, 'cloud-foundry');
  assert.equal(imported.serverName, `cf:${SPACE_GUID}:${DESTINATION_GUID}:internet-basic`);
  assert.equal(imported.client, '123');
  assert.equal(imported.authentication, 'BasicAuthentication');
  assert.equal(imported.proxyType, 'Internet');
  assert.equal(imported.probe.status, 'auth-required');
  assert.deepEqual(imported.cf, {
    spaceGuid: SPACE_GUID,
    destinationInstanceGuid: DESTINATION_GUID,
    destinationInstanceName: DESTINATION_INSTANCE,
    destinationKeyName: cf.createdKeys[0].keyName
  });
  assert.equal(result.destinations.find(item => item.name === 'detail system').client, '250');
  assert.equal(api.observed.detailRequests.length, 1);
  assert.match(result.destinations.find(item => item.name === 'not-http').disabledReason, /Type must be HTTP/);
  assert.match(result.destinations.find(item => item.name === 'userinfo-url').disabledReason, /embedded user information/);
  assert.match(result.destinations.find(item => item.name === 'incomplete-basic').disabledReason, /requires both User and Password/);
  assert.ok(result.warnings.some(warning => /Skipped 1 unnamed destination record/.test(warning)));
  assert.deepEqual(api.observed.tokenAuthorization, [`Basic ${Buffer.from('destination-client:destination-service-secret').toString('base64')}`]);
  assert.deepEqual(api.observed.listAuthorization, ['Bearer api-access-token']);
  assert.ok(api.observed.adtAuthorization.includes(`Basic ${Buffer.from('sap-user:sap-password').toString('base64')}`));
  const safe = JSON.stringify({ destinations: result.destinations, createdKeys: result.createdKeys, warnings: result.warnings });
  for (const secret of ['destination-service-secret', 'api-access-token', 'sap-password', 'sap-user', 'http://127.0.0.1']) assert.equal(safe.includes(secret), false);
});

test('probes HTTP destinations through forward proxies without CONNECT', async t => {
  const api = destinationApi([{
    Name: 'proxied-http',
    Type: 'HTTP',
    URL: 'http://abap.virtual:1443',
    Authentication: 'NoAuthentication',
    ProxyType: 'Internet'
  }]);
  const apiOrigin = await listen(api.server);
  const proxyRequests = [];
  const proxyServer = createServer((request, response) => {
    proxyRequests.push({ method: request.method, url: request.url, host: request.headers.host });
    response.writeHead(401);
    response.end();
  });
  proxyServer.on('connect', (request, socket) => {
    proxyRequests.push({ method: 'CONNECT', url: request.url, host: request.headers.host });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  const proxyOrigin = await listen(proxyServer);
  t.after(async () => {
    await new Promise(resolve => api.server.close(resolve));
    await new Promise(resolve => proxyServer.close(resolve));
  });

  const cf = mockCf({ origin: apiOrigin });
  const result = await discoverCloudFoundryDestinations({
    env: { ...envForLocal(), HTTP_PROXY: proxyOrigin },
    spaceGuid: SPACE_GUID,
    execFileImpl: cf.execFileImpl,
    fetchImpl: globalThis.fetch,
    input: process.stdin,
    output: process.stdout
  });

  assert.deepEqual(proxyRequests, [{
    method: 'GET',
    url: 'http://abap.virtual:1443/sap/bc/adt/discovery',
    host: 'abap.virtual:1443'
  }]);
  assert.equal(result.destinations[0].probe.status, 'auth-required');
});

test('skips CF import without creating a key when no Destination service exists', async () => {
  const cf = mockCf({ instances: false, origin: 'http://127.0.0.1:1' });
  const result = await discoverCloudFoundryDestinations({
    env: envForLocal(), spaceGuid: SPACE_GUID, execFileImpl: cf.execFileImpl,
    input: process.stdin, output: process.stdout
  });
  assert.deepEqual(result.destinations, []);
  assert.deepEqual(result.createdKeys, []);
  assert.equal(cf.createdKeys.length, 0);
  assert.ok(result.warnings.some(warning => /No Destination service instance/.test(warning)));
});

test('resolves a CF Basic destination only after matching the active space', async t => {
  const records = [{
    Name: 'runtime-basic', Type: 'HTTP', URL: 'http://sap.example',
    Authentication: 'BasicAuthentication', ProxyType: 'Internet',
    User: 'runtime-user', Password: 'runtime-password', 'sap-client': '007'
  }];
  const api = destinationApi(records);
  const origin = await listen(api.server);
  t.after(() => new Promise(resolve => api.server.close(resolve)));
  const cf = mockCf({ origin });
  const env = {
    ...envForLocal(),
    BAS_VSP_DESTINATION_SOURCE: 'cloud-foundry',
    BAS_VSP_DESTINATION: 'runtime-basic',
    BAS_CF_SPACE_GUID: SPACE_GUID,
    BAS_CF_DESTINATION_INSTANCE_GUID: DESTINATION_GUID,
    BAS_CF_DESTINATION_INSTANCE: DESTINATION_INSTANCE,
    BAS_CF_DESTINATION_KEY: 'managed-destination-key',
    BAS_CF_DESTINATION_NAME: 'runtime-basic'
  };
  const runtime = await resolveConfiguredCloudFoundryDestination({ env, execFileImpl: cf.execFileImpl });
  assert.equal(runtime.source, 'cloud-foundry');
  assert.equal(runtime.name, 'runtime-basic');
  assert.equal(runtime.serverName, `cf:${SPACE_GUID}:${DESTINATION_GUID}:runtime-basic`);
  assert.equal(runtime.client, '007');
  assert.deepEqual(runtime.childEnv, { SAP_USER: 'runtime-user', SAP_PASSWORD: 'runtime-password', SAP_VERBOSE: 'false' });
  assert.equal(cf.calls.some(args => args[0] === 'service-key' && args.at(-1) === 'managed-destination-key'), true);
  await assert.rejects(
    () => resolveConfiguredCloudFoundryDestination({ env: { ...env, BAS_CF_SPACE_GUID: 'different-space' }, execFileImpl: cf.execFileImpl }),
    /does not match configured space different-space/
  );
  assert.equal(JSON.stringify(cf.calls).includes('runtime-password'), false);
  assert.equal(JSON.stringify(runtime.childEnv).includes('destination-service-secret'), false);
});

test('requires cf CLI 8.18 and a targeted space before prompting', async () => {
  const oldCli = (_command, args, _options, callback) => {
    callback(null, args[0] === 'version' ? 'cf version 8.17.1' : '', '');
  };
  assert.deepEqual(await getCloudFoundryTarget({ env: {}, execFileImpl: oldCli }), {
    available: false,
    reason: 'Cloud Foundry CLI 8.18 or newer is required; CF destinations were skipped.'
  });
});
