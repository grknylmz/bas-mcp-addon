import { open, readFile } from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGo } from './ensure-go.mjs';
import { installBinary } from '../src/binary.mjs';
import { runSetup } from '../src/setup.mjs';
import { installUserCopilotAssets } from './install-user-copilot-assets.mjs';
import { createInterface } from 'node:readline/promises';
import { ReadStream as TTYReadStream, WriteStream as TTYWriteStream } from 'node:tty';
import { homedir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function announce(message) {
  let terminal;
  try {
    terminal = await open(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty', 'w');
    await terminal.write(`${message}\n`);
  } catch {
    console.error(message);
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
      await announce('bas-mcp-addon: optional Copilot agent and skill installation skipped because no interactive terminal is available.');
      return;
    }
    const copilotRoot = join(process.env.HOME || homedir(), '.copilot');
    const prompt = createInterface({ input: terminal.input, output: terminal.output });
    let answer;
    try {
      answer = await prompt.question(`Install the ABAP Developer agent and six skills in "${copilotRoot}"? [Y/n] `);
    } finally {
      prompt.close();
    }
    if (/^n(?:o)?$/i.test(answer.trim())) {
      await announce('bas-mcp-addon: Copilot agent and skill installation declined; user files were not changed.');
      return;
    }
    const assets = await installUserCopilotAssets({ root });
    const installed = assets.installed + assets.updated;
    await announce(`bas-mcp-addon: installed ${installed} Copilot agent/skill file(s) in ${assets.root}; ${assets.unchanged} already current.`);
    if (assets.conflicts.length > 0) {
      const paths = assets.conflicts.map(path => join(assets.root, path)).join(', ');
      await announce(`bas-mcp-addon: preserved existing Copilot customizations; review conflicts: ${paths}`);
    }
  });
}

const RESET = '\x1b[0m';
const STATUS_COLORS = {
  green: '\x1b[1;32m',
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m'
};

function probeCell(destination) {
  const probe = destination.probe || {};
  if (probe.status === 'skipped') return { text: 'SKIPPED (probe disabled)', color: STATUS_COLORS.yellow };
  const details = [
    probe.httpStatus ? `HTTP ${probe.httpStatus}` : '',
    probe.error ? String(probe.error)
      .replace(/(authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 100) : ''
  ].filter(Boolean).join('; ');
  if (probe.available) {
    return { text: `PASS ${probe.status || 'reachable'}${details ? ` (${details})` : ''}`, color: STATUS_COLORS.green };
  }
  return { text: `FAIL ${probe.status || 'unknown'}${details ? ` (${details})` : ''}`, color: STATUS_COLORS.red };
}

function destinationTable(destinations, registeredNames) {
  const headings = ['BAS destination', 'Client', 'Authentication', 'ADT probe', 'MCP server'];
  const rows = destinations.map(destination => {
    const probe = probeCell(destination);
    const registered = registeredNames.has(destination.name);
    return [
      { text: destination.name, output: destination.name },
      { text: String(destination.client || '001'), output: String(destination.client || '001') },
      { text: String(destination.authentication || 'Unknown'), output: String(destination.authentication || 'Unknown') },
      { text: probe.text, output: `${probe.color}${probe.text}${RESET}` },
      { text: registered ? 'REGISTERED' : 'NOT REGISTERED', output: `${registered ? STATUS_COLORS.green : STATUS_COLORS.red}${registered ? 'REGISTERED' : 'NOT REGISTERED'}${RESET}` }
    ];
  });
  const widths = headings.map((heading, index) => Math.max(heading.length, ...rows.map(row => row[index].text.length)));
  const border = `+${widths.map(width => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = cells => `|${cells.map((cell, index) => ` ${cell.output}${' '.repeat(widths[index] - cell.text.length)} `).join('|')}|`;
  return [border, formatRow(headings.map(text => ({ text, output: text }))), border, ...rows.map(formatRow), border].join('\n');
}

async function announceSetup(result) {
  if (result?.reason === 'non-bas') {
    await announce('bas-mcp-addon: no BAS MCP servers configured; H2O_URL is not set. Run bas-vsp-mcp --setup in a BAS dev space.');
    return;
  }
  if (result?.reason === 'non-tty') {
    await announce('bas-mcp-addon: interactive destination selection was skipped; run bas-vsp-mcp --setup in an interactive BAS terminal to choose systems, or npx --yes --ignore-scripts --package=bas-mcp-addon bas-vsp-mcp --setup --npx to configure without a global install.');
    return;
  }
  if (result?.reason === 'no-destinations') {
    await announce('bas-mcp-addon: no named BAS destinations were returned by discovery. Run bas-vsp-mcp --setup to retry.');
    return;
  }
  const servers = Object.entries(result?.servers || {});
  if (!servers.length) {
    await announce('bas-mcp-addon: no BAS MCP servers are configured.');
    return;
  }
  const selected = result.selected || [];
  const registeredNames = new Set(servers.map(([name]) => name));
  const message = [
    `bas-mcp-addon: configured ${servers.length} MCP servers; ADT probe results are informational.`,
    destinationTable(selected, registeredNames),
    'Legend: green = ADT responded (2xx/401/403); red = probe failed; yellow = probe skipped. Only selected destinations are registered.',
    'In BAS/VS Code run “MCP: List Servers”, select a destination, and choose Start Server.'
  ].join('\n');
  await announce(message);
}

async function main() {
  if (process.env.npm_config_ignore_scripts === 'true') return;

  try {
    if (process.env.BAS_VSP_BINARY) {
      await announce('bas-mcp-addon: using BAS_VSP_BINARY override');
    } else {
      try {
        await ensureGo();
      } catch (error) {
        throw new Error(`Go provisioning failed: ${error.message}`);
      }
      try {
        await installBinary(pkg);
        await announce('bas-mcp-addon: installed the pinned VSP binary');
      } catch (error) {
        throw new Error(`VSP binary provisioning failed: ${error.message}`);
      }
    }
  } catch (error) {
    await announce(`bas-mcp-addon: ${error.message}`);
    await announce('Go is provisioned automatically. Set BAS_VSP_BINARY only when supplying a trusted prebuilt VSP executable.');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runInstallSetup();
    await announceSetup(result);
  } catch (error) {
    await announce(`bas-mcp-addon: BAS MCP setup failed: ${error.message}`);
    await announce('Rerun with bas-vsp-mcp --setup.');
  }

  try {
    await runCopilotAssetInstall();
  } catch (error) {
    await announce(`bas-mcp-addon: Copilot agent and skill installation failed: ${error.message}`);
  }
}
main().catch(error => {
  console.error(`bas-mcp-addon: postinstall failed: ${error.message}`);
  process.exitCode = 1;
});
