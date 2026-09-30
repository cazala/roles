import test from 'node:test';
import assert from 'node:assert/strict';
import { clearScan, REORG_DEPTH, scan } from '../../src/scan.js';
import { SETUP_TOPIC } from '../../src/roles.js';
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
test('resume after bounded work; after a reorg, rescan only the recent blocks', async () => {
  const f = setup();
  const first = await scan(f.request, { address, chain: 1, block: 10010, budget: 1 });
  assert.equal(first.last, 5009); assert.equal(first.complete, false);
  const next = await scan(f.request, { address, chain: 1, block: 10010 });
  assert.equal(next.complete, true); assert.deepEqual(f.calls[1], [5010,10009]);
  f.reorg(); f.calls.length = 0;
  await scan(f.request, { address, chain: 1, block: 10010, budget: 1 });
  assert.equal(f.calls[0][0], 10010 - REORG_DEPTH + 1);
});
test('pause does not advance state and single-block limit failure terminates', async () => {
  const f = setup(0), controller = new AbortController(); controller.abort();
  await assert.rejects(scan(f.request, { address, chain: 1, block: 20, signal: controller.signal }), /paused/);
  await assert.rejects(scan(f.request, { address, chain: 1, block: 20 }), /Stopped/);
  assert.ok(f.calls.length < 20);
});

// A full node without archive state: past eth_getCode fails; logs work. The setup event marks the deployment.
function pruned(setupAt, limit = 1e9) {
  const memory = new Map(); globalThis.localStorage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const calls = [];
  const setupLog = { address, blockNumber: '0x' + setupAt.toString(16), topics: [SETUP_TOPIC, ...['34', '56', '78'].map(b => '0x' + '00'.repeat(12) + b.repeat(20))], data: '0x' + '00'.repeat(12) + '9a'.repeat(20) }; // initiator, owner, avatar indexed; target
  const request = async (method, params) => {
    if (method === 'eth_getCode') throw Error('historical state c854c980f01e4f7a861a8213f6dc568e5ce50899cd5a1017f0df049226126332 is not available');
    if (method === 'eth_getBlockByNumber') return { hash: 'h' + params[0] };
    if (method === 'eth_getLogs') {
      const a = Number(BigInt(params[0].fromBlock)), b = Number(BigInt(params[0].toBlock)); calls.push([a, b, !!params[0].topics]);
      if (b - a + 1 > limit) throw Error('block range too large');
      return setupAt >= a && setupAt <= b ? [setupLog] : [];
    }
    throw Error(method);
  };
  return { request, calls };
}
test('without archive state, the deployment is found from the setup event and the history is complete', async () => {
  const f = pruned(40, 25);
  const r = await scan(f.request, { address, chain: 1, block: 100 });
  assert.equal(r.start, 40); assert.equal(r.complete, true);
  assert.ok(f.calls.some(([, , topics]) => topics), 'looked for the setup event by topic');
});
test('a start block typed by hand is complete when the scan contains the setup event', async () => {
  const f = pruned(40);
  assert.equal((await scan(f.request, { address, chain: 1, block: 100, start: 30 })).complete, true);
  const g = pruned(40);
  assert.equal((await scan(g.request, { address, chain: 1, block: 100, start: 50 })).complete, false, 'starting after the setup stays partial');
});

test('the deployment block is kept on its own: a reset scan does not search for it again', async () => {
  const f = setup(); await scan(f.request, { address, chain: 1, block: 20 });
  let asked = 0; const counting = async (m, p) => { if (m === 'eth_getCode') asked++; return f.request(m, p); };
  clearScan(1, address);
  const again = await scan(counting, { address, chain: 1, block: 20 });
  assert.equal(again.start, 10); assert.equal(again.complete, true); assert.equal(asked, 0);
});
test('a reorged tip keeps the older events and rescans only the recent blocks', async () => {
  const f = setup(); const first = await scan(f.request, { address, chain: 1, block: 3000 });
  assert.equal(first.last, 3000);
  f.reorg(); f.calls.length = 0;
  const again = await scan(f.request, { address, chain: 1, block: 3000 });
  assert.equal(again.complete, true);
  assert.equal(f.calls[0][0], 3000 - REORG_DEPTH + 1, 'resumes right after the kept blocks, not from the deployment');
});
