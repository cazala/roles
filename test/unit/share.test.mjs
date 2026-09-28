import test from 'node:test';
import assert from 'node:assert/strict';
import { fragment, fromFragment } from '../../src/share.js';
import { ZERO } from '../../src/abi.js';

test('safe.wei transaction fragment preserves fields and readable signatures', () => {
  const tx = {
    chainId: 1, safe: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20),
    value: 0n, data: '0x12345678', operation: 0, nonce: 3n,
    safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO,
  };
  const abi = ['assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)'];
  const encoded = fragment(tx, [], abi);
  const decoded = fromFragment(encoded.slice(3));
  assert.equal(decoded.tx.safe, tx.safe);
  assert.equal(decoded.tx.to, tx.to);
  assert.equal(decoded.tx.nonce, tx.nonce);
  assert.deepEqual(decoded.abi, abi);
});
