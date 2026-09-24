#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] || 'focused';
const url = args[args.indexOf('--url') + 1] || 'unknown';
const destination = url.replace(/^https?:\/\//, '').replace(/\.dest$/, '');
const logPath = process.env.FAKE_LOG;
function log(entry) { if (logPath) appendFileSync(logPath, `${JSON.stringify({ destination, ...entry })}\n`); }
function reply(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
const toolNames = [
  'GetSource',
  'WriteSource',
  'EditSource',
  'SearchObject',
  'GrepObjects',
  'GrepPackages',
  'FindDefinition',
  'FindReferences',
  'GetContext',
  'SyntaxCheck',
  'Activate',
  'ActivatePackage',
  'CompareSource',
  'GetClassInfo',
  'CreatePackage',
  'CreateTable',
  'GetTable',
  'GetTableContents',
  'GetTransport',
  'ListTransports',
  'GetTransportInfo',
  'GetUserTransports',
  'RunQuery',
  'GetPackage',
  'GetFunctionGroup',
  'GetCDSDependencies',
  'GetCDSImpactAnalysis',
  'GetAPIReleaseState',
  'GetCDSElementInfo',
  'GetMessages',
  'GetFeatures',
  'PrettyPrint',
  'GetSystemInfo',
  'GetInstalledComponents',
  'RunUnitTests',
  'RunATCCheck',
  'GetInactiveObjects',
  'DeleteObject',
  'DebuggerAttach',
  'ListSQLTraces',
  'CreateTransport',
  'ReleaseTransport',
  'DeleteTransport',
  'AnalyzeABAPCode',
  'AnalyzeCallGraph',
  'CodeCompletion',
  'GetAbapHelp',
  'GetCallGraph',
  'GetCalleesOf',
  'GetCallersOf',
  'GetCodeCoverage',
  'GetConnectionInfo',
  'GetObjectStructure',
  'GetTypeHierarchy',
  'GetTypeInfo',
  'GrepObject',
  'GrepPackage',
  'CallRFC',
  'DebuggerDetach',
  'DebuggerGetStack',
  'DebuggerGetVariables',
  'DebuggerListen',
  'DebuggerStep',
  'DeleteBreakpoint',
  'GetBreakpoints',
  'GetDump',
  'GetSQLTraceState',
  'GetTrace',
  'ListDumps',
  'SetBreakpoint',
  'CloneObject',
  'CreateAndActivateProgram',
  'CreateClassWithTests',
  'CreateObject',
  'CreateTestInclude',
  'ExecuteABAP',
  'GetClass',
  'GetClassComponents',
  'GetClassInclude',
  'GetFunction',
  'GetInclude',
  'GetInterface',
  'GetProgram',
  'GetStructure',
  'GetTransaction',
  'LockObject',
  'MoveObject',
  'RecoverFailedCreate',
  'RenameObject',
  'SaveToFile',
  'UnlockObject',
  'UpdateClassInclude',
  'UpdateSource',
  'WriteClass',
  'WriteProgram',
  'ListDependencies',
  'PublishServiceBinding',
  'UnpublishServiceBinding'
];
if (mode === 'expert') toolNames.push('ActivateMultiple', 'SAP');

function toolDefinition(name) {
  const schemas = {
    RunQuery: {
      type: 'object',
      properties: {
        sql_query: { type: 'string' },
        max_rows: { type: 'number' },
        all_rows: { type: 'boolean' }
      },
      required: ['sql_query']
    },
    GetAPIReleaseState: { type: 'object', properties: { object_uri: { type: 'string' } }, required: ['object_uri'] },
    PrettyPrint: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] },
    GetTransport: { type: 'object', properties: { transport: { type: 'string' } }, required: ['transport'] },
    GetTransportInfo: {
      type: 'object',
      properties: { object_url: { type: 'string' }, dev_class: { type: 'string' } },
      required: ['object_url', 'dev_class']
    },
    GetUserTransports: {
      type: 'object',
      properties: { user_name: { type: 'string' } },
      required: []
    },
    ActivateMultiple: {
      type: 'object',
      properties: {
        objects: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: { url: { type: 'string' }, name: { type: 'string' } },
                required: ['url', 'name']
              },
              { type: 'string' }
            ]
          }
        }
      },
      required: ['objects']
    }
  };
  return { name, description: name, inputSchema: schemas[name] || { type: 'object', properties: {}, required: [] } };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      log({ event: 'initialize', env: { guard: process.env.SAP_PROXY_CONTEXTID_GUARD, authorization: process.env.Authorization, cookie: process.env.Cookie, user: process.env.SAP_USER, password: process.env.SAP_PASSWORD, allowTransportableEdits: process.env.SAP_ALLOW_TRANSPORTABLE_EDITS } });
      if (destination === 'broken') process.exit(2);
      reply(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: destination, version: 'fixture' } });
    } else if (message.method === 'tools/list') {
      reply(message.id, message.params?.cursor
        ? { tools: toolNames.slice(15).map(toolDefinition) }
        : { tools: toolNames.slice(0, 15).map(toolDefinition), nextCursor: 'page-2' });
    } else if (message.method === 'tools/call') {
      const name = message.params?.name;
      log({ event: 'call', name, arguments: message.params?.arguments });
      if (message.params?.arguments?.emitNotification) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/message',
          params: { level: 'info', logger: 'fake-vsp', data: 'fixture log notification' }
        })}\n`);
      }
      const transportTools = [
        'ListTransports', 'GetTransport', 'GetUserTransports', 'GetTransportInfo',
        'CreateTransport', 'ReleaseTransport', 'DeleteTransport'
      ];
      const disabledTransportOperation = transportTools.includes(name)
        && (!args.includes('--enable-transports')
          || (['CreateTransport', 'ReleaseTransport', 'DeleteTransport'].includes(name) && args.includes('--transport-read-only')));
      if (disabledTransportOperation) {
        reply(message.id, { content: [{ type: 'text', text: 'transport operation is not enabled' }], isError: true });
      } else if (message.params?.arguments?.object === 'RPC_ERROR') {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32042, message: 'backend connection refused; password=must-not-log' } })}\n`);
      } else if (message.params?.arguments?.object === 'TOOL_ERROR') {
        reply(message.id, { content: [{ type: 'text', text: 'backend timeout; token=must-not-log' }], isError: true });
      } else {
        reply(message.id, { content: [{ type: 'text', text: `${destination}:${name}` }], isError: false });
      }
    } else if (message.id !== undefined) reply(message.id, {});
  }
});
process.stdin.on('end', () => { log({ event: 'end' }); });
process.on('SIGTERM', () => { log({ event: 'term' }); process.exit(0); });
