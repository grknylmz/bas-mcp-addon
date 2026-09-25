import { Writable } from 'node:stream';

const COLORS = {
  cyan: '\u001b[1;36m',
  green: '\u001b[1;32m',
  yellow: '\u001b[1;33m',
  red: '\u001b[1;31m',
  blue: '\u001b[1;34m',
  magenta: '\u001b[1;35m'
};

const STATUS = {
  progress: { icon: '…', color: 'cyan' },
  info: { icon: 'ℹ️', color: 'cyan' },
  success: { icon: '✅', color: 'green' },
  warning: { icon: '⚠️', color: 'yellow' },
  error: { icon: '❌', color: 'red' },
  step: { icon: '➡️', color: 'blue' },
  copilot: { icon: '🤖', color: 'magenta' }
};

function colorEnabled(output) {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
  const isTTY = typeof output === 'boolean' ? output : Boolean(output?.isTTY);
  return isTTY && process.env.TERM !== 'dumb';
}

export function colorText(text, color, output) {
  const value = String(text);
  const code = COLORS[color];
  if (!code || !colorEnabled(output)) return value;
  return `${code}${value}\u001b[0m`;
}

export function iconLabel(icon, label, color, output) {
  return colorText(`${icon} ${label}`, color, output);
}

export function formatStatus(message, tone, output, label = 'bas-mcp-addon') {
  const { icon, color } = STATUS[tone] || STATUS.info;
  return `${iconLabel(icon, label, color, output)} ${message}`;
}

export function promptOutput(output) {
  const proxy = new Writable({
    write(chunk, encoding, callback) {
      output.write(chunk, encoding, callback);
    }
  });
  for (const property of ['isTTY', 'columns', 'rows']) {
    Object.defineProperty(proxy, property, {
      enumerable: true,
      get: () => output?.[property]
    });
  }
  for (const method of ['getColorDepth', 'hasColors']) {
    if (typeof output?.[method] === 'function') {
      proxy[method] = (...args) => output[method](...args);
    }
  }
  return proxy;
}

export const quietSpinnerTheme = {
  spinner: { interval: 80, frames: [''] }
};
