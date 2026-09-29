import test from 'node:test';
import assert from 'node:assert/strict';
import { explorerLogs, historyRequest, setExplorerKey, setOwnRpc } from '../../src/history.js';
import { scan } from '../../src/scan.js';
import { SETUP_TOPIC } from '../../src/roles.js';

const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const address = '0x' + '20'.repeat(20);
const log = (block, i, topic = '0x' + 'ab'.repeat(32)) => ({ address, topics: [topic], data: '0x', blockNumber: '0x' + block.toString(16), blockHash: '0xh' + block, timeStamp: '0x1', gasPrice: '0x1', gasUsed: '0x1', logIndex: i ? '0x' + i.toString(16) : '0x', transactionHash: '0xt' + block, transactionIndex: '0x' });
// Etherscan, as its API answers: pages of `offset`, zero written "0x", "No records found" when empty.
let logs = [], asked = [];
globalThis.fetch = async (url) => {
  const q = new URL(url).searchParams;
  asked.push(Object.fromEntries(q));
  if (q.get('apikey') !== 'K'.repeat(34)) return { ok: true, json: async () => ({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }) };
  const from = Number(q.get('fromBlock')), to = Number(q.get('toBlock')), page = Number(q.get('page')), n = Number(q.get('offset'));
  const hit = logs.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && (!q.get('topic0') || l.topics[0] === q.get('topic0'))).slice((page - 1) * n, page * n);
  return { ok: true, json: async () => (hit.length ? { status: '1', message: 'OK', result: hit } : { status: '0', message: 'No records found', result: [] }) };
};

test('explorer logs come back as RPC logs, in order, across pages', async () => {
  logs = Array.from({ length: 1500 }, (_, i) => log(100 + i, i % 3));
  const got = await explorerLogs('K'.repeat(34), 1, { address, fromBlock: '0x0', toBlock: '0x' + (5000).toString(16) });
  assert.equal(got.length, 1500);
  assert.equal(got[0].logIndex, '0x0', 'zero is normalized');
  assert.equal(got[0].transactionIndex, '0x0');
  assert.ok(got.every((l, i) => !i || Number(l.blockNumber) >= Number(got[i - 1].blockNumber)));
  await assert.rejects(explorerLogs('bad'.repeat(10), 1, { address, fromBlock: '0x0', toBlock: '0x1' }), /Invalid API Key/);
});

test('with a key, the scan takes the whole history in one pass and checks each block against the chain', async () => {
  setOwnRpc(''); setExplorerKey('K'.repeat(34)); asked = [];
  logs = [log(40, 0, SETUP_TOPIC), log(70, 1)];
  logs[0].topics = [SETUP_TOPIC, ...['34', '56', '78'].map((b) => '0x' + '00'.repeat(12) + b.repeat(20))];
  logs[0].data = '0x' + '00'.repeat(12) + '9a'.repeat(20);
  const wallet = async (method, params) => {
    if (method === 'eth_getBlockByNumber') return { hash: '0xh' + Number(params[0]) };
    throw Error('pruned history unavailable');
  };
  let label; const r = historyRequest(wallet, { chain: 1, projectId: 'p', used: (l) => (label = l) });
  const res = await scan(r, { address, chain: 1, block: 100000 });
  assert.equal(res.start, 40); assert.equal(res.complete, true); assert.equal(res.logs.length, 2);
  assert.match(label, /Etherscan/);
  assert.ok(asked.length <= 3, 'a couple of requests, not a block-by-block walk (' + asked.length + ')');
  // A log whose block hash is not the chain's is refused.
  setExplorerKey('K'.repeat(34)); logs[1].blockHash = '0xforged';
  await assert.rejects(historyRequest(wallet, { chain: 1, projectId: 'p' })('eth_getLogs', [{ address, fromBlock: '0x0', toBlock: '0x186a0' }]), /does not match the chain/);
  setExplorerKey('');
});
