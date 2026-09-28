import test from 'node:test';
import assert from 'node:assert/strict';
import { startFork, ACCOUNTS } from './anvil.mjs';
import { deployRoles } from './fixture.mjs';
import { proposal } from '../../src/handoff.js';
import { calldata, roleKey } from '../../src/roles.js';
import { fromFragment } from '../../src/share.js';

test('Safe-owned change produces a hash-verified safe.wei link', { timeout: 120000 }, async () => {
  const f = await startFork();
  try {
    const first = await deployRoles(f, { salt: 940n });
    const fixture = await deployRoles(f, { owner: first.safe, safe: first.safe, salt: 941n });
    const call = {
      to: fixture.address, value: 0n,
      signature: 'assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',
      data: calldata('assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)', [ACCOUNTS[1], [roleKey('reader')], [true]]),
    };
    const result = await proposal(f.rpc, 1, first.safe, [call], 'https://safe.wei.limo/');
    assert.match(result.url, /^https:\/\/safe\.wei\.limo\/#tx=/);
    const decoded = fromFragment(result.url.split('#tx=')[1]);
    assert.equal(decoded.tx.safe, first.safe);
    assert.equal(decoded.tx.to, fixture.address);
    assert.deepEqual(decoded.abi, [call.signature]);
  } finally { f.stop(); }
});
