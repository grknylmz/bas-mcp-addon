import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

const TOKEN_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024;

function safeError(message) {
  return new Error(message);
}

function configuredProxy(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw safeError('Connectivity service credentials are unavailable');
  }
  const host = credentials.onpremise_proxy_host;
  const port = Number(credentials.onpremise_proxy_http_port);
  const tokenServiceUrl = credentials.token_service_url;
  const clientId = credentials.clientid;
  const clientSecret = credentials.clientsecret;
  if (typeof host !== 'string' || !host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof tokenServiceUrl !== 'string' || !clientId || !clientSecret) {
    throw safeError('Connectivity service credentials are incomplete');
  }
  let tokenUrl;
  try {
    tokenUrl = new URL(tokenServiceUrl);
  } catch {
    throw safeError('Connectivity token service URL is invalid');
  }
  if ((tokenUrl.protocol !== 'https:' && tokenUrl.protocol !== 'http:') || tokenUrl.username || tokenUrl.password) {
    throw safeError('Connectivity token service URL is invalid');
  }
  const pathname = tokenUrl.pathname.replace(/\/+$/, '');
  if (!pathname.toLowerCase().endsWith('/oauth/token')) tokenUrl.pathname = `${pathname}/oauth/token`;
  tokenUrl.hash = '';
  return { host, port, tokenUrl, clientId, clientSecret };
}

function targetFromUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw safeError('Destination URL is invalid');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw safeError('Destination URL must use HTTP or HTTPS');
  }
  if (target.username || target.password || !target.hostname) {
    throw safeError('Destination URL must not contain user information');
  }
  return {
    url: target,
    host: target.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
    port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
  };
}

function hostPort(authority, defaultPort) {
  if (typeof authority !== 'string' || !authority || /[@/?#\\]/.test(authority)) return null;
  let parsed;
  try {
    parsed = new URL(`http://${authority}`);
  } catch {
    return null;
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  const explicit = authority.startsWith('[') ? authority.match(/^\[[^\]]+\](?::(\d+))?$/) : authority.match(/^[^:]+(?::(\d+))?$/);
  if (!explicit) return null;
  const port = explicit[1] ? Number(explicit[1]) : (defaultPort === 80 || defaultPort === 443 ? defaultPort : null);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port };
}

function targetMatches(hostPortValue, target) {
  return hostPortValue?.host === target.host && hostPortValue.port === target.port;
}

function respond(res, status, text) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close' });
  res.end(`${text}\n`);
}

function boundedSocketError(socket) {
  socket.on('error', () => socket.destroy());
}

export async function createCfConnectivityProxy({
  destinationUrl,
  connectivityCredentials,
  locationId,
  authMode,
  userTokenProvider,
  fetchImpl = globalThis.fetch,
}) {
  const target = targetFromUrl(destinationUrl);
  const proxy = configuredProxy(connectivityCredentials);
  if (authMode !== 'application' && authMode !== 'principal-propagation') {
    throw safeError('Connectivity authentication mode is unsupported');
  }
  if (locationId != null && /[\r\n]/.test(String(locationId))) {
    throw safeError('Connectivity location identifier is invalid');
  }
  if (typeof fetchImpl !== 'function') throw safeError('Token request implementation is unavailable');
  if (authMode === 'principal-propagation' && typeof userTokenProvider !== 'function') {
    throw safeError('Cloud Foundry user token provider is unavailable');
  }

  let cachedToken;
  let tokenExpiry = 0;
  let refreshing;
  let closed = false;
  const sockets = new Set();

  async function acquireToken() {
    if (cachedToken && Date.now() < tokenExpiry - TOKEN_REFRESH_SKEW_MS) return cachedToken;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      let body;
      if (authMode === 'principal-propagation') {
        let assertion;
        try {
          assertion = await userTokenProvider();
        } catch {
          throw safeError('Unable to obtain the current Cloud Foundry user token');
        }
        if (typeof assertion !== 'string' || !assertion) {
          throw safeError('Unable to obtain the current Cloud Foundry user token');
        }
        body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
          token_format: 'jwt',
          response_type: 'token',
        });
      } else {
        body = new URLSearchParams({ grant_type: 'client_credentials' });
      }
      let response;
      try {
        response = await fetchImpl(proxy.tokenUrl, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${proxy.clientId}:${proxy.clientSecret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        });
      } catch {
        throw safeError('Connectivity token request failed');
      }
      let data;
      try {
        const raw = await response.text();
        if (Buffer.byteLength(raw) > MAX_TOKEN_RESPONSE_BYTES) throw new Error('large');
        data = JSON.parse(raw);
      } catch {
        throw safeError('Connectivity token response was invalid');
      }
      if (!response.ok || typeof data?.access_token !== 'string' || !data.access_token ||
          !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
        throw safeError('Connectivity token exchange was rejected');
      }
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + Number(data.expires_in) * 1000;
      return cachedToken;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = undefined;
    }
  }

  async function connectivityHeaders() {
    const token = await acquireToken();
    const headers = { 'Proxy-Authorization': `Bearer ${token}` };
    if (locationId) headers['SAP-Connectivity-SCC-Location_ID'] = String(locationId);
    return headers;
  }

  // Fail during route preparation when the CF identity or service credentials
  // cannot obtain the required Connectivity token.
  await connectivityHeaders();

  const server = http.createServer((req, res) => {
    void (async () => {
      let requested;
      try {
        const requestUrl = new URL(req.url, `${target.url.protocol}//${req.headers.host || ''}`);
        if (requestUrl.username || requestUrl.password) return respond(res, 400, 'Invalid proxy target');
        const defaultPort = requestUrl.protocol === 'https:' ? 443 : 80;
        requested = { host: requestUrl.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port: Number(requestUrl.port || defaultPort) };
        if ((requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') || !targetMatches(requested, target)) {
          return respond(res, 403, 'Proxy target is not permitted');
        }
        // The BTP Connectivity endpoint accepts HTTP forward requests; HTTPS destinations use CONNECT.
        if (requestUrl.protocol !== 'http:') return respond(res, 400, 'HTTPS destinations must use CONNECT');
        const headers = await connectivityHeaders();
        if (closed) return respond(res, 503, 'Proxy is closed');
        const forwardedHeaders = { ...req.headers };
        for (const name of ['host', 'proxy-authorization', 'proxy-connection', 'connection', 'sap-connectivity-scc-location_id']) {
          delete forwardedHeaders[name];
        }
        const upstream = http.request({
          host: proxy.host,
          port: proxy.port,
          method: req.method,
          path: requestUrl.href,
          headers: { ...forwardedHeaders, host: requestUrl.host, ...headers, connection: 'close' },
          agent: false,
        }, (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
          upstreamRes.pipe(res);
        });
        sockets.add(upstream);
        upstream.once('close', () => sockets.delete(upstream));
        req.once('aborted', () => upstream.destroy());
        res.once('close', () => {
          if (!res.writableEnded) upstream.destroy();
        });
        upstream.on('error', () => respond(res, 502, 'Connectivity proxy request failed'));
        req.pipe(upstream);
      } catch {
        respond(res, 502, 'Connectivity proxy request failed');
      }
    })();
  });

  server.on('connect', (req, clientSocket, head) => {
    sockets.add(clientSocket);
    clientSocket.once('close', () => sockets.delete(clientSocket));
    boundedSocketError(clientSocket);
    void (async () => {
      const requested = hostPort(req.url, target.port);
      if (!targetMatches(requested, target)) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      let upstream;
      try {
        const headers = await connectivityHeaders();
        if (closed) throw safeError('Proxy is closed');
        upstream = net.connect({ host: proxy.host, port: proxy.port });
        sockets.add(upstream);
        upstream.once('close', () => sockets.delete(upstream));
        boundedSocketError(upstream);
        await once(upstream, 'connect');
        const authority = req.url;
        const headerText = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
        upstream.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${headerText}\r\n\r\n`);
        let response = Buffer.alloc(0);
        const onData = (chunk) => {
          response = Buffer.concat([response, chunk]);
          if (response.length > 64 * 1024) {
            upstream.destroy();
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
            return;
          }
          const boundary = response.indexOf('\r\n\r\n');
          if (boundary < 0) return;
          upstream.removeListener('data', onData);
          const statusLine = response.subarray(0, boundary).toString('latin1').split('\r\n', 1)[0];
          const match = /^HTTP\/1\.[01] (\d{3})(?:\s|$)/.exec(statusLine);
          if (!match || Number(match[1]) !== 200) {
            upstream.destroy();
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
            return;
          }
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const remaining = response.subarray(boundary + 4);
          if (remaining.length) clientSocket.write(remaining);
          if (head.length) upstream.write(head);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        };
        upstream.on('data', onData);
      } catch {
        upstream?.destroy();
        if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
    })();
  });

  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', () => reject(safeError('Unable to start Connectivity proxy')));
    server.listen(0, '127.0.0.1', resolve);
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    cachedToken = undefined;
    if (server.listening) {
      const done = once(server, 'close');
      server.close();
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await done;
    }
  };
  return {
    get url() {
      const address = server.address();
      return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : 'http://127.0.0.1';
    },
    close,
  };
}
