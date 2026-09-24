import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const LEGACY_MCP_SERVER_PREFIX = 'basVspMcp_';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function resolveMcpConfigPath(env = process.env) {
  if (env.BAS_VSP_MCP_CONFIG) return env.BAS_VSP_MCP_CONFIG;
  const home = env.HOME || homedir();
  const candidates = [
    join(home, '.vscode', 'data', 'User', 'mcp.json'),
    join(home, '.vscode-server', 'data', 'User', 'mcp.json'),
    join(home, '.code-server', 'data', 'User', 'mcp.json')
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return candidates[0];
}

export function generatedServerName(destinationName) {
  return String(destinationName);
}

export function buildMcpEntries(destinations, env = process.env) {
  const h2oUrl = env.H2O_URL;
  if (!h2oUrl) throw new Error('H2O_URL is required to write BAS MCP configuration');
  const entries = Object.create(null);
  const selected = [...destinations].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const destination of selected) {
    const name = generatedServerName(destination.name);
    if (Object.hasOwn(entries, name)) throw new Error(`Duplicate BAS destination name: ${name}`);
    entries[name] = {
      type: 'stdio',
      command: 'bas-vsp-mcp',
      env: {
        H2O_URL: String(h2oUrl),
        BAS_VSP_DESTINATION: String(destination.name),
        SAP_ALLOW_TRANSPORTABLE_EDITS: 'true'
      },
      BAS_EXT: 'true'
    };
  }
  return entries;
}

async function readConfig(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { servers: {}, inputs: [] };
    throw new Error(`MCP config ${path} could not be read: ${error.message}`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MCP config ${path} contains invalid JSON: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`MCP config ${path} must contain a top-level JSON object`);
  }
  if (config.servers !== undefined && (!config.servers || typeof config.servers !== 'object' || Array.isArray(config.servers))) {
    throw new Error(`MCP config ${path} has a non-object servers value`);
  }
  return { ...config, servers: config.servers || {} };
}

async function writeConfig(path, config) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new Error(`MCP config ${path} could not be written: ${error.message}`);
  }
}

export async function installMcpConfig(destinationsOrOptions, options = {}) {
  let destinations = destinationsOrOptions;
  if (!Array.isArray(destinationsOrOptions)) {
    destinations = destinationsOrOptions?.destinations || [];
    options = destinationsOrOptions || {};
  }
  const env = options.env || process.env;
  const path = options.path || await resolveMcpConfigPath(env);
  const config = await readConfig(path);
  const generated = buildMcpEntries(destinations, env);
  if (options.command) {
    for (const entry of Object.values(generated)) {
      entry.command = options.command;
      if (options.args?.length) entry.args = [...options.args];
    }
  }
  const servers = Object.create(null);
  for (const [name, entry] of Object.entries(config.servers)) {
    const npxLauncher = entry?.command === 'npx'
      && Array.isArray(entry.args)
      && entry.args.includes('bas-vsp-mcp')
      && entry.args.some(argument => typeof argument === 'string' && (argument === '--package=bas-mcp-addon' || /^--package=bas-mcp-addon@[^/]+$/.test(argument)));
    const managed = (entry?.command === 'bas-vsp-mcp' || npxLauncher)
      && entry?.BAS_EXT === 'true'
      && typeof entry?.env?.BAS_VSP_DESTINATION === 'string';
    if (!name.startsWith(LEGACY_MCP_SERVER_PREFIX) && !managed) servers[name] = entry;
  }
  for (const name of Object.keys(generated)) {
    if (Object.hasOwn(servers, name)) {
      throw new Error(`MCP server "${name}" already exists and is not managed by bas-mcp-addon`);
    }
  }
  config.servers = { ...servers, ...generated };
  await writeConfig(path, config);
  return { path, servers: generated };
}

export async function readMcpConfig(path) {
  return readConfig(path);
}
