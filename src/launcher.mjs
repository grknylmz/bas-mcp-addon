#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverDestinations, remediation, statusRows } from './bas-discovery.mjs';
import { findBinary } from './binary.mjs';
import { MCPProxy } from './mcp-proxy.mjs';
import { installMcpConfig } from './mcp-config.mjs';
import { runSetup } from './setup.mjs';
import { resolveConfiguredCloudFoundryDestination } from './cf-destination.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

function hasFlag(name) { return process.argv.slice(2).includes(name); }
function json(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

function usage() {
  return [
    'Usage: bas-vsp-mcp [options]',
    '',
    'With H2O_URL set and no command, starts the BAS MCP stdio server.',
    'Options:',
    '  --setup                  Configure generated BAS MCP servers',
    '  --npx                    Launch configured MCP servers through the pinned npm package (use with --setup)',
    '  --list-destinations      List discovered BAS destinations',
    '  --list-destinations --json  Print redacted JSON status',
    '  --check                  Probe destination availability',
    '  --help, -h               Show this help and exit',
    '',
    'Use an MCP client to call server tools; the BAS runtime uses stdio for MCP.',
    ''
  ].join('\n');
}

function probeDiagnostic(destination) {
  const probe = destination.probe || {};
  const details = [];
  if (probe.httpStatus) details.push(`HTTP ${probe.httpStatus}`);
  if (probe.error) {
    const error = String(probe.error)
      .replace(/(authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    details.push(error);
  }
  return `[bas-vsp-mcp] ${destination.name}: probe=${probe.status || 'unknown'}${details.length ? ` (${details.join('; ')})` : ''}`;
}

async function binaryOrError() {
  const path = await findBinary(pkg);
  if (path) return path;
  throw new Error('VSP binary is not installed. Reinstall with scripts enabled, set BAS_VSP_BINARY to a trusted patched binary, or run npm run build:vsp.');
}

async function discoverForCommand() {
  const env = { ...process.env };
  if (env.BAS_VSP_DESTINATION_SOURCE === 'cloud-foundry') env.BAS_VSP_DESTINATION = '';
  return discoverDestinations({ env });
}

async function main() {
  const setup = hasFlag('--setup');
  const check = hasFlag('--check');
  const list = hasFlag('--list-destinations');
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(usage());
    return;
  }
  if (setup) {
    await runSetup(hasFlag('--npx') ? {
      install: (selected, options) => installMcpConfig(selected, {
        ...options,
        command: 'npx',
        args: ['--yes', '--ignore-scripts', `--package=bas-mcp-addon@${pkg.version}`, 'bas-vsp-mcp']
      })
    } : undefined);
    return;
  }
  if (check || list) {
    const destinations = await discoverForCommand();
    const statuses = statusRows(destinations);
    if (list && hasFlag('--json')) json(statuses);
    else for (const row of statuses) console.error(`${row.name}: client=${row.client} authentication=${row.authentication} probe=${row.probe}`);
    if (check && !destinations.some(destination => destination.probe?.available)) {
      throw new Error('No BAS destination answered the ADT discovery probe successfully. Review the probe results above.');
    }
    return;
  }

  if (process.env.BAS_VSP_DESTINATION_SOURCE === 'cloud-foundry') {
    const destination = await resolveConfiguredCloudFoundryDestination({ env: process.env });
    let proxy;
    try {
      const binary = await binaryOrError();
      proxy = new MCPProxy({ binary, destinations: [destination], env: process.env, log: message => console.error(message) });
      const shutdown = signal => { void proxy.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); };
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      await proxy.serve(process.stdin);
    } catch (error) {
      await proxy?.close();
      await destination.close?.();
      throw error;
    }
    return;
  }

  if (!process.env.H2O_URL) {
    const binary = await binaryOrError();
    const child = spawn(binary, process.argv.slice(2), { env: process.env, stdio: 'inherit' });
    process.once('SIGINT', () => child.kill('SIGINT'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
    const [code, signal] = await new Promise(resolve => child.once('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal])));
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
    return;
  }

  const discovered = await discoverDestinations({ env: process.env });
  for (const destination of discovered) console.error(probeDiagnostic(destination));
  const destinations = discovered;
  if (!destinations.length) {
    console.error('[bas-vsp-mcp] destination discovery returned no named BAS destinations');
    throw new Error(remediation);
  }
  const binary = await binaryOrError();
  console.error(`[bas-vsp-mcp] starting MCP proxy for ${destinations.map(destination => `${destination.name} (client=${destination.client})`).join(', ')}`);
  const proxy = new MCPProxy({ binary, destinations, env: process.env, log: message => console.error(message) });
  const shutdown = signal => { void proxy.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  await proxy.serve(process.stdin);
}

main().catch(error => {
  console.error(`bas-vsp-mcp: ${error.message}`);
  process.exitCode = 1;
});
