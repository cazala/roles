import test from 'node:test';
import assert from 'node:assert/strict';
import { startFork } from './anvil.mjs';
import { deployRoles, configureDemo } from './fixture.mjs';
import { identify, metadata, safeModules, replay } from '../../src/roles.js';
import { scan } from '../../src/scan.js';

test('deployed Roles: identify, Safe pagination, complete event replay and metadata', { timeout: 120000 }, async () => {
  const f = await startFork();
  try {
    const fixture = await deployRoles(f), key = await configureDemo(f, fixture);
    const block = Number(BigInt(await f.rpc('eth_blockNumber')));
    assert.equal((await identify(f.rpc, fixture.address)).version, '2.1.1');
    assert.ok((await safeModules(f.rpc, fixture.safe)).modules.includes(fixture.address));
    assert.equal((await metadata(f.rpc, fixture.address)).owner, fixture.owner);
    const result = await scan(f.rpc, { address: fixture.address, chain: 1, block });
    assert.equal(result.complete, true); assert.equal(result.start, fixture.deploymentBlock);
    const state = replay(result.logs);
    assert.equal(state.roles[key].targets['0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'].clearance, 2);
    assert.equal(state.owner, fixture.owner);
  } finally { f.stop(); }
});
