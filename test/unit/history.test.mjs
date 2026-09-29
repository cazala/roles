import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRequest, noHistory, setOwnRpc, WC_RPC } from '../../src/history.js';

const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
// Other RPCs, as fetch sees them: the URL, the method, and what they answer.
const served = [];
globalThis.fetch = async (url, { body }) => {
  const { id, method } = JSON.parse(body);
  served.push([url, method]);
  const result = method === 'eth_chainId' ? (url.includes('gnosis') ? '0x64' : '0x1') : method === 'eth_getLogs' ? ['from ' + url] : '0x';
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id, result }) };
};
const wallet = (refuse) => async (method) => { if (refuse(method)) throw Error('pruned history unavailable'); return 'wallet:' + method; };

test('the wallet serves history when it can', async () => {
  setOwnRpc(''); served.length = 0;
  const r = historyRequest(wallet(() => false), { chain: 1, projectId: 'p' });
  assert.equal(await r('eth_getLogs', [{}]), 'wallet:eth_getLogs');
  assert.equal(served.length, 0);
});
test('a wallet RPC without old logs: history continues through WalletConnect’s RPC, and stays there', async () => {
  setOwnRpc(''); served.length = 0;
  let label; const r = historyRequest(wallet((m) => m === 'eth_getLogs'), { chain: 1, projectId: 'p', used: (l) => (label = l) });
  assert.deepEqual(await r('eth_getLogs', [{}]), ['from ' + WC_RPC(1, 'p')]);
  assert.match(label, /WalletConnect/);
  await r('eth_getBlockByNumber', ['0x1', false]);
  assert.deepEqual(served.map((x) => x[1]), ['eth_chainId', 'eth_getLogs', 'eth_getBlockByNumber'], 'checked the chain once, then history goes there');
  assert.equal(await r('eth_call', [{}]), 'wallet:eth_call', 'everything else stays with the wallet');
});
test('your own history RPC is used from the start, and must be on the same chain', async () => {
  setOwnRpc('https://eth.example/rpc'); served.length = 0;
  let label; const r = historyRequest(wallet(() => false), { chain: 1, projectId: 'p', used: (l) => (label = l) });
  assert.deepEqual(await r('eth_getLogs', [{}]), ['from https://eth.example/rpc']);
  assert.equal(label, 'your history RPC');
  setOwnRpc('https://gnosis.example/rpc');
  await assert.rejects(historyRequest(wallet(() => false), { chain: 1, projectId: 'p' })('eth_getLogs', [{}]), /for chain 100, not 1/);
  assert.throws(() => setOwnRpc('http://insecure.example'), /https/);
  setOwnRpc('');
});
test('only history errors fall back', async () => {
  assert.ok(noHistory(Error('historical state c854… is not available')) && noHistory(Error('pruned history unavailable')) && noHistory(Error('Archive requests require a personal token')));
  const r = historyRequest(async () => { throw Error('execution reverted'); }, { chain: 1, projectId: 'p' });
  await assert.rejects(r('eth_getLogs', [{}]), /execution reverted/);
});
