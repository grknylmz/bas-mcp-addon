const objects = new Map([
  ['CLAS:ZCL_DEMO_ORDER', `CLASS zcl_demo_order DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS get_status IMPORTING order_id TYPE string RETURNING VALUE(status) TYPE string.\nENDCLASS.\n\nCLASS zcl_demo_order IMPLEMENTATION.\n  METHOD get_status.\n    status = |Order { order_id } is ready|.\n  ENDMETHOD.\nENDCLASS.`],
  ['DDLS:ZI_DEMO_ORDER', `@EndUserText.label: 'Demo Orders'\ndefine view entity ZI_DEMO_ORDER\n  as select from zdemo_order\n{\n  key order_id as OrderId,\n      description as Description\n}`]
]);

const transports = new Map([
  ['DEMO000001', { status: 'modifiable', description: 'Offline demo transport', objects: ['ZCL_DEMO_ORDER', 'ZI_DEMO_ORDER'] }]
]);
const tools = [
  ['GetSource', { object_type: 'string', name: 'string' }, ['object_type', 'name']],
  ['WriteSource', { object_type: 'string', name: 'string', source: 'string' }, ['object_type', 'name', 'source']],
  ['SearchObject', { query: 'string' }, ['query']],
  ['GetSystemInfo', {}, []],
  ['GetFeatures', {}, []],
  ['GetConnectionInfo', {}, []],
  ['GetAPIReleaseState', { object_uri: 'string' }, ['object_uri']],
  ['GetTransport', { transport: 'string' }, ['transport']],
  ['ListTransports', {}, []],
  ['GetTransportInfo', { object_url: 'string', dev_class: 'string' }, ['object_url', 'dev_class']],
  ['ListDependencies', { object_uri: 'string' }, ['object_uri']],
  ['GetInactiveObjects', {}, []],
  ['RunUnitTests', { object_name: 'string' }, ['object_name']],
  ['RunATCCheck', { object_name: 'string' }, ['object_name']],
  ['SyntaxCheck', { object_type: 'string', name: 'string', source: 'string' }, ['object_type', 'name', 'source']],
  ['CreateTransport', { description: 'string' }, ['description']]
].map(([name, properties, required]) => ({
  name,
  description: `Offline demo fixture for ${name}. No live SAP system is contacted.`,
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(Object.entries(properties).map(([key, type]) => [key, { type }])),
    required,
    additionalProperties: false
  }
}));

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function toolResult(value) {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function key(args) {
  return `${String(args.object_type || '').toUpperCase()}:${String(args.name || '').toUpperCase()}`;
}

function getSource(args) {
  const source = objects.get(key(args));
  if (source === undefined) return errorResult(`Object ${args.object_type} ${args.name} is not in the demo fixture.`);
  return { isError: false, content: [{ type: 'text', text: source }], structuredContent: { source } };
}

function callTool(name, args = {}) {
  if (name === 'GetSource') return getSource(args);
  if (name === 'WriteSource') {
    objects.set(key(args), args.source);
    return toolResult({ status: 'saved-in-memory', object_type: args.object_type, name: args.name });
  }
  if (name === 'SearchObject') {
    const query = String(args.query || '').toUpperCase();
    return toolResult({ objects: [...objects.keys()].filter(value => value.includes(query)).map(value => ({ name: value.split(':')[1], uri: `/sap/bc/adt/oo/classes/${value.split(':')[1].toLowerCase()}` })) });
  }
  if (name === 'GetSystemInfo') return toolResult({ system_id: 'DEMO', release: 'ABAP Platform 2023', database: 'Offline fixture' });
  if (name === 'GetFeatures') return toolResult({ abap_cloud: true, rap_odata: true, cts_transports: true, offline_demo: true });
  if (name === 'GetConnectionInfo') return toolResult({ destination: 'demo', connection: 'offline fixture', live_sap: false });
  if (name === 'GetAPIReleaseState') {
    return toolResult({ object_uri: args.object_uri, release_state: 'not_released', evidence: 'Synthetic API release-state example only.' });
  }
  if (name === 'GetTransport') return transports.has(args.transport) ? toolResult(transports.get(args.transport)) : errorResult(`Transport ${args.transport} is not in the demo fixture.`);
  if (name === 'ListTransports') return toolResult({ transports: [...transports.entries()].map(([transport, details]) => ({ transport, ...details })) });
  if (name === 'GetTransportInfo') return toolResult({ object_url: args.object_url, dev_class: args.dev_class, eligible_requests: ['DEMO000001'], lock_status: 'unlocked' });
  if (name === 'ListDependencies') return toolResult({ dependencies: [], object_uri: args.object_uri, note: 'No additional dependencies in this fixture.' });
  if (name === 'GetInactiveObjects') return toolResult({ objects: [] });
  if (name === 'RunUnitTests') return toolResult({ object_name: args.object_name, status: 'passed', passed: 3, failed: 0, duration_ms: 18 });
  if (name === 'RunATCCheck') return toolResult({ object_name: args.object_name, status: 'passed', findings: [] });
  if (name === 'SyntaxCheck') return toolResult({ status: 'clean', errors: 0, warnings: 0 });
  if (name === 'CreateTransport') {
    const transport = `DEMO${String(transports.size + 1).padStart(6, '0')}`;
    const result = { status: 'created-in-memory', transport, description: args.description };
    transports.set(transport, result);
    return toolResult(result);
  }
  return errorResult(`Tool ${name} is not implemented by the offline demo.`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === 'initialize') {
      send(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sap-ai-dev-toolkit-offline-demo', version: '1.0.0' } });
    } else if (message.method === 'tools/list') {
      send(message.id, { tools });
    } else if (message.method === 'tools/call') {
      send(message.id, callTool(message.params?.name, message.params?.arguments));
    } else if (message.method && message.id !== undefined) {
      send(message.id, {});
    }
  }
});
