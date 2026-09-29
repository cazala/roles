import test from 'node:test';
import assert from 'node:assert/strict';
import { addRpc, explorerLogs, noHistory, reader, removeRpc, rpcs, setExplorerKey, WC_RPC } from '../../src/reads.js';
import { scan } from '../../src/scan.js';
import { SETUP_TOPIC } from '../../src/roles.js';

const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const address = '0x' + '20'.repeat(20), KEY = 'K'.repeat(34);
// The network as fetch sees it: JSON-RPC endpoints (POST) and Etherscan (GET).
const served = [];
let explorer = [];
globalThis.fetch = async (url, init = {}) => {
  if (!init.body) {
    const q = new URL(url).searchParams;
    served.push(['etherscan', q.get('module')]);
    if (q.get('apikey') !== KEY) return { ok: true, json: async () => ({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }) };
    const from = Number(q.get('fromBlock')), to = Number(q.get('toBlock')), page = Number(q.get('page')), n = Number(q.get('offset'));
    const hit = explorer.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && (!q.get('topic0') || l.topics[0] === q.get('topic0'))).slice((page - 1) * n, page * n);
    return { ok: true, json: async () => (hit.length ? { status: '1', message: 'OK', result: hit } : { status: '0', message: 'No records found', result: [] }) };
  }
  const { id, method, params } = JSON.parse(init.body);
  served.push([url, method]);
  const result = method === 'eth_chainId' ? (url.includes('gnosis') ? '0x64' : '0x1') : method === 'eth_getBlockByNumber' ? { hash: '0xh' + Number(params[0]) } : method === 'eth_getLogs' ? ['from ' + url] : '0xrpc';
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id, result }) };
};
const wallet = (refuse = () => false) => ({ request: async ({ method, params }) => { if (refuse(method)) throw Error('pruned history unavailable'); if (method === 'eth_getBlockByNumber') return { hash: '0xh' + Number(params[0]) }; return 'wallet:' + method; } });
const reset = () => { memory.clear(); served.length = 0; };

test('without settings, everything goes to the wallet', async () => {
  reset();
  const r = reader(wallet(), { chain: () => 1, projectId: 'p' });
  assert.equal(await r.request({ method: 'eth_call', params: [{}] }), 'wallet:eth_call');
  assert.equal(served.length, 0);
});
test('an RPC added for the chain takes every read on it; signing and accounts stay with the wallet', async () => {
  reset();
  assert.equal(await addRpc('https://eth.example/v2/secret'), 1, 'the chain comes from the endpoint');
  assert.equal(await addRpc('https://gnosis.example/rpc'), 100);
  const r = reader(wallet(), { chain: () => 1, projectId: 'p' });
  for (const m of ['eth_call', 'eth_getBalance', 'eth_getLogs', 'eth_getStorageAt']) await r.request({ method: m, params: [] });
  assert.ok(served.filter(([u]) => u.startsWith('https://eth.example')).length >= 4);
  assert.equal(await r.request({ method: 'eth_sendTransaction', params: [{}] }), 'wallet:eth_sendTransaction');
  assert.equal(await r.request({ method: 'eth_accounts' }), 'wallet:eth_accounts');
  assert.equal(await reader(wallet(), { chain: () => 137, projectId: 'p' }).request({ method: 'eth_call', params: [] }), 'wallet:eth_call', 'no RPC for Polygon: the wallet');
  removeRpc(1);
  assert.deepEqual(Object.keys(rpcs()), ['100']);
  await assert.rejects(addRpc('http://insecure.example'), /https/);
});
test('a wallet RPC without old history: history continues through WalletConnect’s RPC, other reads stay', async () => {
  reset();
  const r = reader(wallet((m) => m === 'eth_getLogs'), { chain: () => 1, projectId: 'p' });
  assert.deepEqual(await r.request({ method: 'eth_getLogs', params: [{}] }), ['from ' + WC_RPC(1, 'p')]);
  assert.match(r.source, /WalletConnect/);
  await r.request({ method: 'eth_getCode', params: ['0x', '0x1'] });
  assert.equal(served.at(-1)[0], WC_RPC(1, 'p'), 'history stays there once the wallet refused');
  assert.equal(await r.request({ method: 'eth_call', params: [{}] }), 'wallet:eth_call');
  assert.ok(noHistory(Error('historical state c854… is not available')) && noHistory(Error('Archive requests require a personal token')));
  await assert.rejects(reader({ request: async () => { throw Error('execution reverted'); } }, { chain: () => 1, projectId: 'p' }).request({ method: 'eth_getLogs', params: [{}] }), /execution reverted/);
});

const elog = (block, i, topic = '0x' + 'ab'.repeat(32)) => ({ address, topics: [topic], data: '0x', blockNumber: '0x' + block.toString(16), blockHash: '0xh' + block, timeStamp: '0x1', gasPrice: '0x1', gasUsed: '0x1', logIndex: i ? '0x' + i.toString(16) : '0x', transactionHash: '0xt' + block, transactionIndex: '0x' });
test('Etherscan logs come back as RPC logs, in order, across pages', async () => {
  explorer = Array.from({ length: 1500 }, (_, i) => elog(100 + i, i % 3));
  const got = await explorerLogs(KEY, 1, { address, fromBlock: '0x0', toBlock: '0x1388' });
  assert.equal(got.length, 1500);
  assert.equal(got[0].logIndex, '0x0', 'zero is normalized');
  await assert.rejects(explorerLogs('bad'.repeat(10), 1, { address, fromBlock: '0x0', toBlock: '0x1' }), /Invalid API Key/);
});
test('with an Etherscan key, the scan takes the whole history in a few requests and checks each block', async () => {
  reset(); setExplorerKey(KEY);
  explorer = [elog(40, 0, SETUP_TOPIC), elog(70, 1)];
  explorer[0].topics = [SETUP_TOPIC, ...['34', '56', '78'].map((b) => '0x' + '00'.repeat(12) + b.repeat(20))];
  explorer[0].data = '0x' + '00'.repeat(12) + '9a'.repeat(20);
  const r = reader(wallet((m) => m === 'eth_getLogs' || m === 'eth_getCode'), { chain: () => 1, projectId: 'p' });
  const request = (method, params) => r.request({ method, params });
  Object.defineProperty(request, 'wide', { get: () => r.wide });
  const res = await scan(request, { address, chain: 1, block: 100000 });
  assert.equal(res.start, 40); assert.equal(res.complete, true); assert.equal(res.logs.length, 2);
  assert.match(r.source, /Etherscan/);
  assert.ok(served.filter(([u]) => u === 'etherscan').length <= 3, 'a few requests, not a block-by-block walk');
  explorer[1].blockHash = '0xforged';
  await assert.rejects(r.request({ method: 'eth_getLogs', params: [{ address, fromBlock: '0x0', toBlock: '0x186a0' }] }), /does not match the chain/);
  setExplorerKey('');
  assert.equal(r.wide, false);
});
