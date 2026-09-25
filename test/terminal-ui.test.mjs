import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { formatStatus, promptOutput, quietSpinnerTheme } from '../src/terminal-ui.mjs';

test('progress status uses a stable single-column glyph instead of a wide emoji', () => {
  const rendered = formatStatus('Loading destinations', 'progress', false, 'Setup');
  assert.equal(rendered, '… Setup Loading destinations');
  assert.doesNotMatch(rendered, /⏳/u);
});

test('prompt output proxy preserves TTY sizing and color capabilities for Inquirer rendering', async () => {
  const chunks = [];
  const target = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  target.isTTY = true;
  target.columns = 42;
  target.rows = 9;
  target.getColorDepth = () => 8;
  target.hasColors = count => count <= 256;

  const proxy = promptOutput(target);
  assert.equal(proxy.isTTY, true);
  assert.equal(proxy.columns, 42);
  assert.equal(proxy.rows, 9);
  assert.equal(proxy.getColorDepth(), 8);
  assert.equal(proxy.hasColors(256), true);

  for (let index = 0; index < 20; index += 1) {
    target.columns = 20 + index;
    target.rows = 5 + (index % 4);
    assert.equal(proxy.columns, target.columns);
    assert.equal(proxy.rows, target.rows);
  }

  await new Promise(resolve => proxy.write('visible line', resolve));
  assert.equal(chunks.join(''), 'visible line');
});

test('quiet spinner theme disables animated Braille loading frames', () => {
  assert.deepEqual(quietSpinnerTheme.spinner.frames, ['']);
  assert.equal(quietSpinnerTheme.spinner.interval, 80);
});
