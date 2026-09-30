import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, formatUnits } from '../../src/units.js';

test('parseUnits: units to exact base units', () => {
  assert.equal(parseUnits('1.5', 18), 1500000000000000000n);
  assert.equal(parseUnits('1,000', 6), 1000000000n);
  assert.equal(parseUnits('.25', 8), 25000000n);
  assert.equal(parseUnits('42', 0), 42n);
  assert.equal(parseUnits('-3', 0), -3n);
  assert.equal(parseUnits('0.000000000000000001', 18), 1n);
  assert.throws(() => parseUnits('1.0000001', 6), /At most 6 decimals/);
  assert.throws(() => parseUnits('1.5', 0), /Whole numbers/);
  assert.throws(() => parseUnits('1e18', 0), /Enter a number/);
  assert.throws(() => parseUnits('', 18), /Enter a number/);
  assert.throws(() => parseUnits('.', 18), /Enter a number/);
});

test('formatUnits: base units to readable units', () => {
  assert.equal(formatUnits(1500000000000000000n, 18), '1.5');
  assert.equal(formatUnits(1000000000n, 6), '1,000');
  assert.equal(formatUnits(1n, 18), '0.000000000000000001');
  assert.equal(formatUnits(1234567n, 0), '1,234,567');
  assert.equal(formatUnits(-2500000n, 6), '-2.5');
});
