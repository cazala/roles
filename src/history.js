// History (logs, code and headers at past blocks) for the permission scan. The wallet's RPC is used when it
// can serve it. Many wallet RPCs are full nodes that drop old state or old logs; then the scan continues
// through another RPC: the one the user set in History options, else WalletConnect's. Every log is still
// checked by the scan (range, address, block hashes), whichever RPC served it.
import { getJson, jsonRpc } from './net.js';
import { load, store } from './store.js';

const METHODS = ['eth_getLogs', 'eth_getCode', 'eth_getBlockByNumber'];
export const noHistory = (e) => /historical state|missing trie|archive|state is not available|state not available|pruned|history unavailable/i.test((e && e.message) || '');
export const WC_RPC = (chain, projectId) => 'https://rpc.walletconnect.org/v1/?chainId=eip155:' + chain + '&projectId=' + projectId;

/** The user's own RPC for history, if any (a URL; kept in this browser). */
export const ownRpc = () => String(load('historyrpc', '') || '');
export function setOwnRpc(url) {
  url = String(url || '').trim();
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw Error('Enter an https:// RPC URL, or leave it empty.');
  store('historyrpc', url);
  return url;
}

/** An Etherscan API key (optional; kept in this browser): history in a few requests from Etherscan's index. */
export const explorerKey = () => String(load('explorerkey', '') || '');
export function setExplorerKey(k) {
  k = String(k || '').trim();
  if (k && !/^[A-Za-z0-9]{20,64}$/.test(k)) throw Error('That does not look like an Etherscan API key.');
  store('explorerkey', k);
  return k;
}
const hx = (v) => (!v || v === '0x' ? '0x0' : v); // Etherscan writes zero as "0x"
/**
 * eth_getLogs through Etherscan's API (one key, every chain it indexes): the whole range in pages of 1,000,
 * as RPC logs. Etherscan is trusted to return every log; the scan still checks and replays each one.
 */
export async function explorerLogs(key, chain, { address, topics, fromBlock, toBlock }) {
  const out = [], seen = new Set();
  let from = Number(fromBlock), page = 1;
  const to = Number(toBlock);
  for (;;) {
    const q = new URLSearchParams({ chainid: chain, module: 'logs', action: 'getLogs', address, fromBlock: from, toBlock: to, page, offset: 1000, apikey: key });
    if (topics && topics[0]) q.set('topic0', topics[0]);
    const r = await getJson('https://api.etherscan.io/v2/api?' + q);
    if (r.status !== '1' && !/no records/i.test(r.message || '')) throw Error('Etherscan: ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed') + '. Check the API key in History options.');
    const list = Array.isArray(r.result) ? r.result : [];
    for (const l of list) {
      const log = { address: l.address.toLowerCase(), topics: l.topics.filter(Boolean), data: l.data, blockNumber: hx(l.blockNumber), blockHash: l.blockHash, transactionHash: l.transactionHash, transactionIndex: hx(l.transactionIndex), logIndex: hx(l.logIndex), removed: false };
      const k = log.transactionHash + ':' + Number(log.logIndex);
      if (!seen.has(k)) seen.add(k), out.push(log);
    }
    if (list.length < 1000) break;
    // Etherscan pages stop at 10,000 results: continue from the last block seen (duplicates are dropped).
    if (page < 10) page++;
    else (from = Number(list[list.length - 1].blockNumber)), (page = 1);
  }
  return out.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
}

/**
 * A request function for history reads: through `request` (the wallet), or through the user's RPC when set,
 * or WalletConnect's after the wallet refuses old data. `used(label)` is told which one serves the scan.
 */
export function historyRequest(request, { chain, projectId, used = () => {} }) {
  let alt = null, checked = null;
  const own = ownRpc(), key = explorerKey();
  const via = (url, label) => {
    alt = async (method, params) => {
      // A history RPC must be for the same chain: check once.
      checked = checked || jsonRpc(url, 'eth_chainId').then((c) => { if (Number(c) !== chain) throw Error('The history RPC is for chain ' + Number(c) + ', not ' + chain + '. Change it in History options.'); });
      await checked;
      return jsonRpc(url, method, params);
    };
    used(label);
  };
  if (own) via(own, 'your history RPC');
  const read = async (method, params = []) => {
    if (alt && METHODS.includes(method)) return alt(method, params);
    try {
      return await request(method, params);
    } catch (e) {
      if (!METHODS.includes(method) || !noHistory(e) || !projectId) throw e;
      via(WC_RPC(chain, projectId), 'WalletConnect’s RPC (your wallet’s RPC does not keep this history)');
      return alt(method, params);
    }
  };
  if (!key) return read;
  // With an explorer key, logs come from Etherscan, whole ranges at once (`wide` tells the scan). Each block
  // with events must match the chain's own header, so a made-up or reorged block is refused.
  used('Etherscan (trusted to return every event)');
  const fast = async (method, params = []) => {
    if (method !== 'eth_getLogs') return read(method, params);
    const logs = await explorerLogs(key, chain, params[0]);
    const blocks = [...new Set(logs.map((l) => l.blockNumber))];
    for (const b of blocks) {
      const header = await read('eth_getBlockByNumber', [b, false]);
      if (!header || header.hash !== logs.find((l) => l.blockNumber === b).blockHash) throw Error('Etherscan returned a log in block ' + Number(b) + ' that does not match the chain. Remove the API key in History options and scan again.');
    }
    return logs;
  };
  fast.wide = true;
  return fast;
}
