// Where reads go. The wallet signs; reads can go elsewhere (Settings): an RPC the user added for the chain,
// else the wallet's RPC, else, for old history the wallet's RPC dropped, WalletConnect's. With an Etherscan
// key, logs come from Etherscan's index (trusted to return every event; each block is checked against the chain).
import { getJson, jsonRpc } from './net.js';
import { load, store } from './store.js';

const HISTORY = ['eth_getLogs', 'eth_getCode', 'eth_getBlockByNumber'];
// Read-only methods an RPC can answer instead of the wallet; everything else (accounts, signing, chain switching) stays with it.
const READS = new Set([...HISTORY, 'eth_call', 'eth_blockNumber', 'eth_getBalance', 'eth_getStorageAt', 'eth_getBlockByHash', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_maxPriorityFeePerGas']);
export const noHistory = (e) => /historical state|missing trie|archive|state is not available|state not available|pruned|history unavailable/i.test((e && e.message) || '');
export const tooWide = (e) => /range|limit|size|result|response|too many|too large/i.test((e && e.message) || '');
export const WC_RPC = (chain, projectId) => 'https://rpc.walletconnect.org/v1/?chainId=eip155:' + chain + '&projectId=' + projectId;

/** RPC endpoints the user added, per chain: { chainId: url } (kept in this browser). */
export const rpcs = () => { const m = load('rpcs', {}); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; };
export const rpcFor = (chain) => rpcs()[chain] || '';
/** Add an RPC endpoint: its chain is asked from the endpoint itself. Returns the chain id. */
export async function addRpc(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw Error('Enter an https:// RPC URL.');
  const chain = Number(await jsonRpc(url, 'eth_chainId'));
  if (!Number.isSafeInteger(chain) || chain < 1) throw Error('That endpoint did not answer eth_chainId.');
  store('rpcs', { ...rpcs(), [chain]: url });
  return chain;
}
export const removeRpc = (chain) => { const m = rpcs(); delete m[chain]; store('rpcs', m); };

/** An Etherscan API key (optional; kept in this browser): history in a few requests from Etherscan's index. */
export const explorerKey = () => String(load('explorerkey', '') || '');
export function setExplorerKey(k) {
  k = String(k || '').trim();
  if (k && !/^[A-Za-z0-9]{20,64}$/.test(k)) throw Error('That does not look like an Etherscan API key.');
  store('explorerkey', k);
  return k;
}
// Etherscan's free plan allows a few requests per second: one at a time, spaced, and one retry on its rate limit.
let lane = Promise.resolve();
export function etherscan(query) {
  const run = async () => {
    for (let i = 0; ; i++) {
      const r = await getJson('https://api.etherscan.io/v2/api?' + query);
      if (i < 2 && r.status === '0' && /rate limit/i.test(String(r.result) + ' ' + r.message)) { await new Promise((ok) => setTimeout(ok, 1100)); continue; }
      return r;
    }
  };
  const next = lane.then(run);
  lane = next.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, 250)));
  return next;
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
    const r = await etherscan(q);
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
 * The provider the app uses: `wallet` (EIP-1193) for everything, with reads routed as above. `chain()` is the
 * connected chain. `source` names what served the last logs ('your RPC', WalletConnect's RPC, Etherscan, or
 * null for the wallet); `wide` says whole log ranges come from an indexer at once.
 */
export function reader(wallet, { chain, projectId }) {
  const fallback = new Set(); // chains whose wallet RPC refused old history: history goes to WalletConnect's RPC
  const r = {
    wallet,
    source: null,
    get wide() { return !!explorerKey(); },
    on: (...a) => wallet.on?.(...a),
    removeListener: (...a) => wallet.removeListener?.(...a),
    async request({ method, params = [] }) {
      const c = chain();
      if (method === 'eth_getLogs' && explorerKey()) return explorer(c, params);
      if (!READS.has(method)) return wallet.request({ method, params });
      const own = rpcFor(c);
      if (own) {
        try {
          const v = await jsonRpc(own, method, params);
          return note(method, 'your RPC'), v;
        } catch (e) {
          // Many plans cap log ranges (Alchemy's free tier: 10 blocks); a scan through them would take forever.
          if (method !== 'eth_getLogs' || !tooWide(e) || !projectId) throw e;
          return note(method, 'WalletConnect’s RPC (your RPC limits log ranges)'), jsonRpc(WC_RPC(c, projectId), method, params);
        }
      }
      if (fallback.has(c) && HISTORY.includes(method)) return note(method, 'WalletConnect’s RPC'), jsonRpc(WC_RPC(c, projectId), method, params);
      try {
        const v = await wallet.request({ method, params });
        // A wallet answering logs with no list (some do, for ranges too heavy for them) is treated as a refusal.
        if (method === 'eth_getLogs' && !Array.isArray(v)) throw Error('history unavailable: the wallet answered eth_getLogs without a list');
        return note(method, null), v;
      } catch (e) {
        if (!HISTORY.includes(method) || !noHistory(e) || !projectId) throw e;
        fallback.add(c);
        return note(method, 'WalletConnect’s RPC (your wallet’s RPC does not keep this history)'), jsonRpc(WC_RPC(c, projectId), method, params);
      }
    },
  };
  const note = (method, s) => method === 'eth_getLogs' && (r.source = s);
  // Logs from Etherscan; each block with events must match the chain's own header.
  async function explorer(c, params) {
    r.source = 'Etherscan';
    const logs = await explorerLogs(explorerKey(), c, params[0]);
    for (const b of [...new Set(logs.map((l) => l.blockNumber))]) {
      const header = await r.request({ method: 'eth_getBlockByNumber', params: [b, false] });
      if (!header || header.hash !== logs.find((l) => l.blockNumber === b).blockHash) throw Error('Etherscan returned a log in block ' + Number(b) + ' that does not match the chain. Remove the Etherscan key in Settings and try again.');
    }
    r.source = 'Etherscan';
    return logs;
  }
  return r;
}
