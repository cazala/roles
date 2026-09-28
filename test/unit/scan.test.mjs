import test from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../../src/scan.js';
const address = '0x' + '12'.repeat(20);
function setup(limit = 5000) {
  const memory = new Map(); globalThis.localStorage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const calls = []; let revision = 0;
  const request = async (method, params) => {
    if (method === 'eth_getCode') return Number(BigInt(params[1])) >= 10 ? '0x12' : '0x';
    if (method === 'eth_getBlockByNumber') return { hash: 'hash' + revision + params[0] };
    if (method === 'eth_getLogs') { const a = Number(BigInt(params[0].fromBlock)), b = Number(BigInt(params[0].toBlock)); calls.push([a,b]); if (b-a+1 > limit) throw Error('block range too large'); return []; }
    throw Error(method);
  };
  return { request, calls, reorg: () => revision++ };
}
test('adaptive windows, complete versus user-supplied partial history', async () => {
  const f = setup(2); const result = await scan(f.request, { address, chain: 1, block: 20 });
  assert.equal(result.complete, true); assert.equal(result.start, 10); assert.equal(result.last, 20);
  assert.ok(f.calls.length > 6);
  const partial = await scan(f.request, { address, chain: 1, block: 20, start: 15 });
  assert.equal(partial.complete, false); assert.equal(partial.caughtUp, true);
});
test('resume after bounded work and discard cache after reorg', async () => {
  const f = setup();
  const first = await scan(f.request, { address, chain: 1, block: 10010, budget: 1 });
  assert.equal(first.last, 5009); assert.equal(first.complete, false);
  const next = await scan(f.request, { address, chain: 1, block: 10010 });
  assert.equal(next.complete, true); assert.deepEqual(f.calls[1], [5010,10009]);
  f.reorg(); f.calls.length = 0;
  await scan(f.request, { address, chain: 1, block: 10010, budget: 1 });
  assert.equal(f.calls[0][0], 10);
});
test('pause does not advance state and single-block limit failure terminates', async () => {
  const f = setup(0), controller = new AbortController(); controller.abort();
  await assert.rejects(scan(f.request, { address, chain: 1, block: 20, signal: controller.signal }), /paused/);
  await assert.rejects(scan(f.request, { address, chain: 1, block: 20 }), /Stopped/);
  assert.ok(f.calls.length < 20);
});
