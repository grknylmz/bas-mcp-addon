import checkbox from '@inquirer/checkbox';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { discoverDestinations, remediation } from './bas-discovery.mjs';
import { installMcpConfig } from './mcp-config.mjs';

const SETUP_COMMAND = 'bas-vsp-mcp --setup';

function print(output, message) {
  output.write(`${message}\n`);
}


function printConnectionInstructions(output, result) {
  const servers = Object.entries(result?.servers || {});
  if (!servers.length) {
    print(output, 'No package-owned BAS MCP servers are configured.');
    return;
  }
  print(output, 'MCP servers now available:');
  for (const [name, entry] of servers) {
    print(output, `- ${name} (destination=${entry.env?.BAS_VSP_DESTINATION || 'unknown'})`);
  }
  print(output, 'To connect in BAS/VS Code: open the Command Palette, run “MCP: List Servers”,');
  print(output, 'select the server named for the BAS destination, and choose Start Server.');
  print(output, 'Use “MCP: Open User Configuration” to inspect or edit the generated entries.');
}


export async function runSetup({
  env = process.env,
  input = stdin,
  output = stdout,
  discover = discoverDestinations,
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

  let destinations;
  try {
    destinations = await discover({ env: { ...env, BAS_VSP_DESTINATION: '' } });
  } catch (error) {
    throw new Error(`BAS discovery failed: ${error.message}`);
  }
  if (!destinations.length) {
    print(output, remediation);
    return { skipped: true, reason: 'no-destinations' };
  }

  const choices = destinations.map(destination => {
    const probe = destination.probe?.status || 'unknown';
    const availability = destination.probe?.available === false ? ' unavailable' : '';
    return {
      value: destination,
      name: `${destination.name} (client=${destination.client} authentication=${destination.authentication} probe=${probe}${availability})`,
      checked: false
    };
  });
  print(output, 'No BAS destinations are selected by default. Use Space to choose destinations, a to toggle all, and Enter to confirm.');
  // Inquirer ends its output stream when the prompt completes.
  const promptOutput = new Writable({
    write(chunk, encoding, callback) {
      output.write(chunk, encoding, callback);
    }
  });
  const selected = await checkbox({
    message: 'Select BAS destinations',
    choices,
    required: false,
    shortcuts: { all: 'a', invert: null }
  }, { input, output: promptOutput });
  try {
    const result = await install(selected, { env });
    const location = result?.path ? ` in ${result.path}` : '';
    print(output, `Configured ${selected.length} BAS MCP server${selected.length === 1 ? '' : 's'}${location}.`);
    printConnectionInstructions(output, result);
    return { selected, ...(result || {}) };
  } catch (error) {
    throw new Error(`MCP config writing failed: ${error.message}`);
  }
}

