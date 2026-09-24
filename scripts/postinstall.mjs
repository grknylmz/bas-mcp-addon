import { open, readFile } from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGo } from './ensure-go.mjs';
import { installBinary } from '../src/binary.mjs';
import { runSetup } from '../src/setup.mjs';
import { installUserCopilotAssets } from './install-user-copilot-assets.mjs';
import { createInterface } from 'node:readline/promises';
import { ReadStream as TTYReadStream, WriteStream as TTYWriteStream } from 'node:tty';
import { homedir } from 'node:os';
import { colorText, formatStatus } from '../src/terminal-ui.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function announce(message, tone = 'info') {
  const content = message.replace(/^bas-mcp-addon:\s*/, '');
  let terminal;
  try {
    terminal = await open(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty', 'w');
    await terminal.write(`${formatStatus(content, tone, true)}\n`);
  } catch {
    console.error(formatStatus(content, tone, process.stderr));
  } finally {
    await terminal?.close().catch(() => {});
  }
}

function openControllingTerminal() {
  const inputPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';
  const outputPath = process.platform === 'win32' ? 'CONOUT$' : '/dev/tty';
  const inputFd = openSync(inputPath, 'r');
  let outputFd;
  try {
    outputFd = openSync(outputPath, 'w');
    return { input: new TTYReadStream(inputFd), output: new TTYWriteStream(outputFd) };
  } catch (error) {
    closeSync(inputFd);
    if (outputFd !== undefined) closeSync(outputFd);
    throw error;
  }
}

async function withInstallTerminal(action) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return action({ input: process.stdin, output: process.stdout });
  }
  let terminal;
  try {
    terminal = openControllingTerminal();
  } catch {
    return action(null);
  }
  try {
    return await action(terminal);
  } finally {
    terminal.input.destroy();
    terminal.output.destroy();
  }
}

async function runInstallSetup() {
  return withInstallTerminal(terminal => runSetup(terminal || undefined));
}

async function runCopilotAssetInstall() {
  await withInstallTerminal(async terminal => {
    if (!terminal) {
      await announce('Optional Copilot installation skipped because no interactive terminal is available.', 'warning');
      return;
    }
    const copilotRoot = join(process.env.HOME || homedir(), '.copilot');
    await announce(`Optional Copilot setup is waiting for your choice.\nPress Enter to install the ABAP Developer agent and six skills in the path shown below; type n then press Enter to skip.`, 'copilot');
    const prompt = createInterface({ input: terminal.input, output: terminal.output });
    let answer;
    try {
      answer = await prompt.question(`🤖 Install the ABAP Developer agent and six skills in "${copilotRoot}"? [Y/n] `);
    } finally {
      prompt.close();
    }
    if (/^n(?:o)?$/i.test(answer.trim())) {
      await announce('Copilot agent and skills were skipped. Your files were not changed.', 'info');
      return;
    }
    const assets = await installUserCopilotAssets({ root });
    const installed = assets.installed + assets.updated;
    await announce(`Installed ${installed} Copilot files in ${assets.root}; ${assets.unchanged} already current.`, 'success');
    if (assets.conflicts.length > 0) {
      const paths = assets.conflicts.map(path => join(assets.root, path)).join(', ');
      await announce(`Existing Copilot customizations were preserved; review these paths: ${paths}`, 'warning');
    }
  });
}


function probeCell(destination) {
  const probe = destination.probe || {};
  if (probe.status === 'skipped') return { text: 'SKIPPED (probe disabled)', color: 'yellow' };
  const error = destination.source === 'cloud-foundry' ? '' : String(probe.error || '')
    .replace(/(authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  const details = [
    probe.httpStatus ? `HTTP ${probe.httpStatus}` : '',
    error
  ].filter(Boolean).join('; ');
  if (probe.available) {
    return { text: `PASS ${probe.status || 'reachable'}${details ? ` (${details})` : ''}`, color: 'green' };
  }
  return { text: `FAIL ${probe.status || 'unknown'}${details ? ` (${details})` : ''}`, color: 'red' };
}

export function destinationTable(destinations, registeredNames) {
  const headings = ['Destination', 'Source', 'Client', 'Authentication', 'ADT probe', 'MCP server'];
  const rows = destinations.map(destination => {
    const probe = probeCell(destination);
    const registered = registeredNames.has(destination.serverName || destination.name);
    const source = destination.source === 'cloud-foundry'
      ? `CF ${destination.cf?.destinationInstanceName || 'unknown instance'}`
      : 'BAS';
    return [
      { text: destination.name, output: destination.name },
      { text: source, output: source },
      { text: String(destination.client || '001'), output: String(destination.client || '001') },
      { text: String(destination.authentication || 'Unknown'), output: String(destination.authentication || 'Unknown') },
      { text: probe.text, output: colorText(probe.text, probe.color, true) },
      { text: registered ? 'REGISTERED' : 'NOT REGISTERED', output: colorText(registered ? 'REGISTERED' : 'NOT REGISTERED', registered ? 'green' : 'red', true) }
    ];
  });
  const widths = headings.map((heading, index) => Math.max(heading.length, ...rows.map(row => row[index].text.length)));
  const border = `+${widths.map(width => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = cells => `|${cells.map((cell, index) => ` ${cell.output}${' '.repeat(widths[index] - cell.text.length)} `).join('|')}|`;
  const coloredBorder = colorText(border, 'cyan', true);
  const coloredHeadings = formatRow(headings.map(text => ({ text, output: colorText(text, 'cyan', true) })));
  return [coloredBorder, coloredHeadings, coloredBorder, ...rows.map(formatRow), coloredBorder].join('\n');
}
async function announceSetup(result) {
  if (result?.reason === 'non-bas') {
    await announce('BAS destination setup was skipped because H2O_URL is not set.\nRun bas-vsp-mcp --setup from a BAS dev space when you are ready.', 'info');
    return;
  }
  if (result?.reason === 'non-tty') {
    await announce('Destination selection was skipped because npm did not provide an interactive terminal.\nRun bas-vsp-mcp --setup from an interactive BAS terminal, or use the documented npx setup command.', 'warning');
    return;
  }
  if (result?.reason === 'no-destinations') {
    const details = (result.warnings || []).map(warning => `• ${warning}`).join('\n');
    await announce(`No selectable BAS or Cloud Foundry destinations were found.\nRun bas-vsp-mcp --setup to retry.${details ? `\n${details}` : ''}`, 'warning');
    return;
  }
  const servers = Object.entries(result?.servers || {});
  if (!servers.length) {
    await announce('No MCP servers were added because no destinations were selected.\nRun bas-vsp-mcp --setup to choose destinations later.', 'info');
    return;
  }
  const selected = result.selected || [];
  const registeredNames = new Set(servers.map(([name]) => name));
  const message = [
    `Destination status report for ${servers.length} configured MCP server${servers.length === 1 ? '' : 's'}`,
    destinationTable(selected, registeredNames),
    `Probe guide: ${colorText('PASS', 'green', true)} = ADT responded (2xx/401/403) · ${colorText('FAIL', 'red', true)} = probe failed · ${colorText('SKIPPED', 'yellow', true)} = probe disabled.`,
    'ADT probes are informational; only the destinations you selected are registered.'
  ].join('\n');
  await announce(message, 'success');
}
async function main() {
  if (process.env.npm_config_ignore_scripts === 'true') return;

  try {
    if (process.env.BAS_VSP_BINARY) {
      await announce('Using the BAS_VSP_BINARY override.', 'info');
    } else {
      await announce('Checking for Go. The supported version installs automatically if needed; this may take a few minutes.', 'progress');
      try {
        await ensureGo();
        await announce('Go is ready.', 'success');
      } catch (error) {
        throw new Error(`Go provisioning failed: ${error.message}`);
      }
      await announce('Preparing the pinned VSP runtime for this platform.', 'progress');
      try {
        await installBinary(pkg);
        await announce('Pinned VSP binary installed and ready.', 'success');
      } catch (error) {
        throw new Error(`VSP binary provisioning failed: ${error.message}`);
      }
    }
  } catch (error) {
    await announce(error.message, 'error');
    await announce('Go is provisioned automatically. Set BAS_VSP_BINARY only when supplying a trusted prebuilt VSP executable.', 'info');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runInstallSetup();
    await announceSetup(result);
  } catch (error) {
    await announce(`BAS MCP setup failed: ${error.message}`, 'error');
    await announce('Rerun bas-vsp-mcp --setup.', 'info');
  }

  try {
    await runCopilotAssetInstall();
  } catch (error) {
    await announce(`Copilot agent and skill installation failed: ${error.message}`, 'error');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(formatStatus(`Postinstall failed: ${error.message}`, 'error', process.stderr));
    process.exitCode = 1;
  });
}


