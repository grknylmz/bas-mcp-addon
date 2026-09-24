import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import { createCfConnectivityProxy } from '../src/cf-connectivity.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  for (const socket of server.__sockets || []) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}

function trackSockets(server) {
  server.__sockets = new Set();
  server.on('connection', socket => {
    server.__sockets.add(socket);
    socket.once('close', () => server.__sockets.delete(socket));
  });
  return server;
}

function responseToken(token, expires = 300) {
  return new Response(JSON.stringify({ access_token: token, expires_in: expires }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

const connectivityCredentials = port => ({
  onpremise_proxy_host: '127.0.0.1',
  onpremise_proxy_http_port: port,
  token_service_url: 'https://token.example',
  clientid: 'connectivity-client',
  clientsecret: 'connectivity-secret'
});

test('routes HTTP ADT traffic through Connectivity with scoped bearer and location headers', async t => {
  const observed = { token: [], proxy: [], target: [] };
  const target = trackSockets(createServer((request, response) => {
    observed.target.push({ path: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ADT response');
  }));
  const targetPort = await listen(target);
  t.after(() => close(target));

  const btpProxy = trackSockets(createServer((request, response) => {
    observed.proxy.push({
      authorization: request.headers['proxy-authorization'],
      location: request.headers['sap-connectivity-scc-location_id'],
      path: request.url
    });
    if (request.headers['proxy-authorization'] !== 'Bearer application-token' || request.headers['sap-connectivity-scc-location_id'] !== 'scc-east') {
      response.writeHead(403);
      response.end('proxy credentials rejected');
      return;
    }
    const targetUrl = new URL(request.url);
    const headers = { ...request.headers, host: targetUrl.host };
    delete headers['proxy-authorization'];
    delete headers['sap-connectivity-scc-location_id'];
    forwardHttpRequest(targetUrl, request.method, headers, response);
    request.resume();
  }));
  const btpPort = await listen(btpProxy);
  t.after(() => close(btpProxy));

  const tokenRequests = [];
  const route = await createCfConnectivityProxy({
    destinationUrl: `http://127.0.0.1:${targetPort}`,
    connectivityCredentials: connectivityCredentials(btpPort),
    locationId: 'scc-east',
    authMode: 'application',
    fetchImpl: async (url, options) => {
      tokenRequests.push({ url: String(url), headers: options.headers, body: new URLSearchParams(options.body) });
      return responseToken('application-token');
    }
  });
  t.after(() => route.close());
  assert.deepEqual(Object.keys(route).sort(), ['close', 'url']);
  assert.equal(tokenRequests.length, 1);
  assert.equal(tokenRequests[0].url, 'https://token.example/oauth/token');
  assert.equal(tokenRequests[0].headers.authorization, `Basic ${Buffer.from('connectivity-client:connectivity-secret').toString('base64')}`);
  assert.equal(tokenRequests[0].body.get('grant_type'), 'client_credentials');

  const response = await proxyRequest(route.url, `http://127.0.0.1:${targetPort}/sap/bc/adt/discovery`, {
    authorization: 'Basic sap-user:sap-password'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, 'ADT response');
  assert.deepEqual(observed.proxy.map(request => [request.authorization, request.location]), [['Bearer application-token', 'scc-east']]);
  assert.deepEqual(observed.target.map(request => [request.path, request.authorization]), [['/sap/bc/adt/discovery', 'Basic sap-user:sap-password']]);

  const forbidden = await proxyRequest(route.url, 'http://not-the-selected-host.example/sap/bc/adt/discovery');
  assert.equal(forbidden.status, 403);
  assert.equal(observed.proxy.length, 1, 'unauthorized targets never reach the BTP proxy');
});
test('closes stalled Connectivity HTTP forwarding when the route shuts down', async t => {
  let requestReceived;
  const receivedRequest = new Promise(resolve => { requestReceived = resolve; });
  const btpProxy = trackSockets(createServer(request => {
    request.resume();
    requestReceived();
  }));
  const btpPort = await listen(btpProxy);
  t.after(() => close(btpProxy));
  const route = await createCfConnectivityProxy({
    destinationUrl: 'http://sap.example:8080',
    connectivityCredentials: connectivityCredentials(btpPort),
    authMode: 'application',
    fetchImpl: async () => responseToken('application-token')
  });
  t.after(() => route.close());

  const response = proxyRequest(route.url, 'http://sap.example:8080/sap/bc/adt/discovery', {}, 1_000);
  await receivedRequest;
  await route.close();
  await assert.rejects(response);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(btpProxy.__sockets.size, 0, 'route shutdown closes its outstanding BTP request');
});

test('uses the CF user JWT for PrincipalPropagation CONNECT and never falls back to an application token', async t => {
  const observed = { connect: [], tunnel: [] };
  const btpProxy = trackSockets(createServer());
  btpProxy.on('connect', (request, socket, head) => {
    observed.connect.push({
      target: request.url,
      authorization: request.headers['proxy-authorization'],
      location: request.headers['sap-connectivity-scc-location_id']
    });
    if (request.headers['proxy-authorization'] !== 'Bearer user-exchange-token' || request.headers['sap-connectivity-scc-location_id'] !== 'scc-west') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) observed.tunnel.push(head.toString());
    socket.on('data', data => observed.tunnel.push(data.toString()));
  });
  const btpPort = await listen(btpProxy);
  t.after(() => close(btpProxy));

  const tokenRequests = [];
  let userTokenCalls = 0;
  const route = await createCfConnectivityProxy({
    destinationUrl: 'https://sap.example:8443',
    connectivityCredentials: connectivityCredentials(btpPort),
    locationId: 'scc-west',
    authMode: 'principal-propagation',
    userTokenProvider: async () => { userTokenCalls += 1; return 'current-cf-user-jwt'; },
    fetchImpl: async (url, options) => {
      tokenRequests.push({ url: String(url), headers: options.headers, body: new URLSearchParams(options.body) });
      return responseToken('user-exchange-token');
    }
  });
  t.after(() => route.close());
  assert.equal(userTokenCalls, 1);
  assert.equal(tokenRequests.length, 1);
  assert.equal(tokenRequests[0].headers.authorization, `Basic ${Buffer.from('connectivity-client:connectivity-secret').toString('base64')}`);
  assert.deepEqual(Object.fromEntries(tokenRequests[0].body), {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: 'current-cf-user-jwt',
    token_format: 'jwt',
    response_type: 'token'
  });

  const port = Number(new URL(route.url).port);
  const socket = net.connect(port, '127.0.0.1');
  t.after(() => socket.destroy());
  const handshake = await new Promise((resolve, reject) => {
    let data = '';
    socket.once('error', reject);
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\r\n\r\n')) resolve(data);
    });
    socket.once('connect', () => socket.write('CONNECT sap.example:8443 HTTP/1.1\r\nHost: sap.example:8443\r\n\r\n'));
  });
  assert.match(handshake, /^HTTP\/1\.1 200 Connection Established/);
  assert.deepEqual(observed.connect, [{
    target: 'sap.example:8443',
    authorization: 'Bearer user-exchange-token',
    location: 'scc-west'
  }]);

  await route.close();
  const failedRequests = [];
  await assert.rejects(() => createCfConnectivityProxy({
    destinationUrl: 'https://sap.example:8443',
    connectivityCredentials: connectivityCredentials(btpPort),
    authMode: 'principal-propagation',
    userTokenProvider: async () => 'current-cf-user-jwt',
    fetchImpl: async (_url, options) => {
      failedRequests.push(new URLSearchParams(options.body));
      return new Response(JSON.stringify({ error: 'jwt exchange rejected' }), { status: 401 });
    }
  }), /Connectivity token exchange was rejected/);
  assert.equal(failedRequests.length, 1);
  assert.equal(failedRequests[0].get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(failedRequests[0].has('assertion'), true);
});

function forwardHttpRequest(target, method, headers, response) {
  const upstream = httpRequest({
    hostname: target.hostname,
    port: Number(target.port || 80),
    method,
    path: `${target.pathname}${target.search}`,
    headers
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  upstream.end();
}
function proxyRequest(proxyUrl, targetUrl, headers = {}, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const request = httpRequest({
      hostname: proxy.hostname,
      port: Number(proxy.port),
      method: 'GET',
      path: targetUrl,
      headers: { host: new URL(targetUrl).host, ...headers }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 0, body }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('proxy request timed out')));
    request.on('error', reject);
    request.end();
  });
}
test('refreshes a PrincipalPropagation token 60 seconds before expiry with a fresh CF JWT', async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const proxyHeaders = [];
  const btpProxy = trackSockets(createServer((request, response) => {
    proxyHeaders.push(request.headers['proxy-authorization']);
    response.writeHead(204);
    response.end();
  }));
  let route;
  try {
    const port = await listen(btpProxy);
    let userTokenCalls = 0;
    const tokenRequests = [];
    route = await createCfConnectivityProxy({
      destinationUrl: 'http://sap.example:8080',
      connectivityCredentials: connectivityCredentials(port),
      authMode: 'principal-propagation',
      userTokenProvider: async () => `current-user-jwt-${++userTokenCalls}`,
      fetchImpl: async (_url, options) => {
        tokenRequests.push(new URLSearchParams(options.body));
        return responseToken(`user-token-${tokenRequests.length}`, 100);
      }
    });
    assert.equal(tokenRequests.length, 1);
    const first = await proxyRequest(route.url, 'http://sap.example:8080/first');
    assert.equal(first.status, 204);
    assert.equal(tokenRequests.length, 1);
    now = 41_000;
    const second = await proxyRequest(route.url, 'http://sap.example:8080/second');
    assert.equal(second.status, 204);
    assert.equal(tokenRequests.length, 2);
    assert.equal(userTokenCalls, 2);
    assert.deepEqual(proxyHeaders, ['Bearer user-token-1', 'Bearer user-token-2']);
    assert.deepEqual(tokenRequests.map(body => body.get('assertion')), ['current-user-jwt-1', 'current-user-jwt-2']);
  } finally {
    Date.now = originalNow;
    await route?.close();
    await close(btpProxy);
  }
});
