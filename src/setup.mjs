import checkbox from '@inquirer/checkbox';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { discoverDestinations, remediation } from './bas-discovery.mjs';
import { discoverCloudFoundryDestinations, getCloudFoundryTarget, deleteManagedCloudFoundryServiceKeys } from './cf-destination.mjs';
import { collectCloudFoundryKeyReferencesFromAllEntries, collectManagedCloudFoundryKeyReferences, installMcpConfig, readMcpConfig, resolveMcpConfigPath } from './mcp-config.mjs';

const SETUP_COMMAND = 'bas-vsp-mcp --setup';

function print(output, message) {
  output.write(`${message}\n`);
}


async function confirmCloudFoundryImport({ input = stdin, output = stdout } = {}) {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question("Include destinations from the current CF space's Destination service? [y/N] ");
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

function safeProbe(probe) {
  const result = {};
  if (typeof probe?.status === 'string') result.status = probe.status;
  if (typeof probe?.available === 'boolean') result.available = probe.available;
  if (Number.isFinite(probe?.httpStatus)) result.httpStatus = probe.httpStatus;
  return result;
}

function safeBasDestination(destination) {
  return {
    source: 'bas',
    name: destination.name,
    serverName: destination.name,
    url: destination.url,
    client: destination.client,
    authentication: destination.authentication,
    probe: safeProbe(destination.probe)
  };
}

function safeCloudFoundryDestination(destination) {
  const cf = destination.cf || {};
  return {
    source: 'cloud-foundry',
    name: destination.name,
    serverName: destination.serverName,
    client: destination.client,
    authentication: destination.authentication,
    proxyType: destination.proxyType,
    probe: safeProbe(destination.probe),
    cf: {
      spaceGuid: cf.spaceGuid,
      destinationInstanceGuid: cf.destinationInstanceGuid,
      destinationInstanceName: cf.destinationInstanceName,
      destinationKeyName: cf.destinationKeyName,
      ...(cf.connectivityInstanceGuid ? {
        connectivityInstanceGuid: cf.connectivityInstanceGuid,
        connectivityInstanceName: cf.connectivityInstanceName,
        connectivityKeyName: cf.connectivityKeyName
      } : {})
    },
    ...(destination.disabledReason ? { disabledReason: destination.disabledReason } : {})
  };
}

function printConnectionInstructions(output, result) {
  const servers = Object.entries(result?.servers || {});
  if (!servers.length) {
    print(output, 'No package-owned MCP servers are configured.');
    return;
  }
  print(output, 'MCP servers now available:');
  for (const [name, entry] of servers) {
    print(output, `- ${name} (destination=${entry.env?.BAS_VSP_DESTINATION || 'unknown'})`);
  }
  print(output, 'To connect in BAS/VS Code: open the Command Palette, run “MCP: List Servers”,');
  print(output, 'select the generated server name listed above, and choose Start Server.');
  print(output, 'Use “MCP: Open User Configuration” to inspect or edit the generated entries.');
}


export async function runSetup({
  env = process.env,
  input = stdin,
  output = stdout,
  discover = discoverDestinations,
  discoverCf = discoverCloudFoundryDestinations,
  confirmCfImport = confirmCloudFoundryImport,
  install = installMcpConfig
} = {}) {
  if (!env.H2O_URL) {
    print(output, `BAS setup skipped: H2O_URL is not set. Run ${SETUP_COMMAND} in a BAS dev space.`);
    return { skipped: true, reason: 'non-bas' };
  }
  if (!input.isTTY || !output.isTTY) {
    print(output, `BAS setup requires an interactive terminal. Rerun with ${SETUP_COMMAND}.`);
    return { skipped: true, reason: 'non-tty' };
  }

  let basDestinations;
  try {
    basDestinations = await discover({ env: { ...env, BAS_VSP_DESTINATION: '' } });
  } catch (error) {
    throw new Error(`BAS discovery failed: ${error.message}`);
  }
  const destinations = basDestinations.map(safeBasDestination);
  const warnings = [];
  let createdKeys = [];
  let configPath;
  let managedKeys = [];
  try {
    configPath = await resolveMcpConfigPath(env);
    managedKeys = collectManagedCloudFoundryKeyReferences(await readMcpConfig(configPath));
  } catch {
    warnings.push('Existing MCP config could not be read before setup; existing CF service keys will not be reused.');
  }

  const target = await getCloudFoundryTarget({ env });
  if (!target.available) {
    warnings.push(target.reason);
  } else {
    let shouldImport = false;
    try {
      shouldImport = await confirmCfImport({ input, output });
    } catch {
      warnings.push('Cloud Foundry import prompt failed; CF destinations were skipped.');
    }
    if (shouldImport) {
      try {
        const result = await discoverCf({ env, input, output, spaceGuid: target.spaceGuid, managedKeys });
        createdKeys = Array.isArray(result?.createdKeys) ? result.createdKeys : [];
        const cfDestinations = Array.isArray(result?.destinations) ? result.destinations : [];
        destinations.push(...cfDestinations.map(safeCloudFoundryDestination));
        warnings.push(...(Array.isArray(result?.warnings) ? result.warnings.filter(value => typeof value === 'string') : []));
      } catch {
        warnings.push('Cloud Foundry import failed; BAS setup can continue.');
      }
    } else if (!warnings.some(message => message.includes('Cloud Foundry import prompt failed'))) {
      warnings.push('Cloud Foundry destinations were skipped because import was not confirmed.');
    }
  }

  const reportWarnings = async messages => {
    for (const message of messages) print(output, `Warning: ${message}`);
  };
  const cleanupKeys = async (keys, config) => {
    const referenced = collectCloudFoundryKeyReferencesFromAllEntries(config);
    const referenceIds = new Set(referenced.map(reference => `${reference.kind}\0${reference.spaceGuid}\0${reference.instanceGuid}\0${reference.keyName}`));
    const candidates = keys.filter(key => !referenceIds.has(`${key.kind}\0${key.spaceGuid}\0${key.instanceGuid}\0${key.keyName}`));
    if (!candidates.length) return [];
    const result = await deleteManagedCloudFoundryServiceKeys({ env, keys: candidates });
    return result.warnings || [];
  };
  const cleanupNewKeysWithoutConfigChange = async () => {
    if (!createdKeys.length) return [];
    const result = await deleteManagedCloudFoundryServiceKeys({ env, keys: createdKeys });
    return result.warnings || [];
  };
  const selectable = destinations.filter(destination => !destination.disabledReason);
  if (!selectable.length) {
    print(output, remediation);
    await reportWarnings(warnings);
    const cleanupWarnings = await cleanupNewKeysWithoutConfigChange();
    await reportWarnings(cleanupWarnings);
    return { skipped: true, reason: 'no-destinations', warnings: [...warnings, ...cleanupWarnings] };
  }

  const choices = destinations.map(destination => {
    const probe = destination.probe?.status || 'unknown';
    const availability = destination.probe?.available === false ? ' unavailable' : '';
    const source = destination.source === 'cloud-foundry'
      ? `CF ${destination.cf.destinationInstanceName}`
      : 'BAS';
    const disabled = destination.disabledReason;
    return {
      value: destination,
      name: `${destination.name} (${source}; client=${destination.client} authentication=${destination.authentication} probe=${probe}${availability}${disabled ? `; disabled: ${disabled}` : ''})`,
      ...(disabled ? { disabled } : {}),
      checked: false
    };
  });
  print(output, 'No destinations are selected by default. Use Space to choose destinations, a to toggle all, and Enter to confirm.');
  const promptOutput = new Writable({
    write(chunk, encoding, callback) {
      output.write(chunk, encoding, callback);
    }
  });
  const selected = await checkbox({
    message: 'Select destinations',
    choices,
    required: false,
    shortcuts: { all: 'a', invert: null }
  }, { input, output: promptOutput });
  try {
    const result = await install(selected, { env });
    const location = result?.path ? ` in ${result.path}` : '';
    print(output, `Configured ${selected.length} MCP server${selected.length === 1 ? '' : 's'}${location}.`);
    printConnectionInstructions(output, result);
    let cleanupWarnings = [];
    const finalPath = result?.path || configPath;
    if (!finalPath) {
      cleanupWarnings.push('CF service-key cleanup skipped because the final MCP config path is unavailable.');
    } else {
      try {
        const finalConfig = await readMcpConfig(finalPath);
        cleanupWarnings = await cleanupKeys([...managedKeys, ...createdKeys], finalConfig);
      } catch {
        cleanupWarnings.push('CF service-key cleanup skipped because the final MCP config could not be read.');
      }
    }
    await reportWarnings(warnings);
    await reportWarnings(cleanupWarnings);
    return { selected, ...(result || {}), warnings: [...warnings, ...cleanupWarnings] };
  } catch (error) {
    const cleanupWarnings = [];
    if (createdKeys.length) {
      const finalPath = configPath;
      if (!finalPath) {
        cleanupWarnings.push('CF service-key cleanup skipped because the MCP config path is unavailable.');
      } else {
        try {
          const actualConfig = await readMcpConfig(finalPath);
          cleanupWarnings.push(...await cleanupKeys(createdKeys, actualConfig));
        } catch {
          cleanupWarnings.push('CF service-key cleanup skipped because the MCP config could not be read.');
        }
      }
    }
    await reportWarnings([...warnings, ...cleanupWarnings]);
    throw new Error(`MCP config writing failed: ${error.message}`);
  }
}

