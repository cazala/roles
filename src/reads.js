// Where reads go. The wallet signs; reads can go elsewhere (Settings): an RPC the user added for the chain,
// else the wallet's RPC, else, for old history the wallet's RPC dropped, WalletConnect's. Logs come from a block
// explorer's index when one serves the chain (trusted to return every event; each one is checked against the chain).
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

// A block explorer's index: the history in a few requests instead of block by block, and contract names and
// verified ABIs. The providers, the chains each covers and the default order come from the config chunk
// (config/explorers.json, so they can change without touching the code); your choice in Settings overrides the
// default. Any Etherscan-compatible API works (module=logs&action=getLogs, module=contract&action=getsourcecode).
const config = () => {
  const c = globalThis.EXPLORERS;
  return c && typeof c === 'object' && c.providers ? c : { default: [], providers: {} };
};
export const explorerProviders = () => Object.entries(config().providers).map(([id, p]) => ({ id, ...p }));
export const explorerDefaults = () => (config().default || []).filter((id) => config().providers[id]);
/** Your choice: { id: 'default' | 'none' | 'custom' | a provider, url (custom), keys: { [id]: key } }. */
export function explorerChoice() {
  const c = load('explorer', null);
  if (c && typeof c === 'object' && typeof c.id === 'string') return { id: c.id, url: String(c.url || ''), keys: c.keys && typeof c.keys === 'object' ? c.keys : {} };
  // Before the choice existed there was only an Etherscan key: keep using it.
  const k = String(load('explorerkey', '') || '');
  return k ? { id: 'etherscan', url: '', keys: { etherscan: k } } : { id: 'default', url: '', keys: {} };
}
export function setExplorer({ id, url = '', key = '' }) {
  const c = explorerChoice(), p = config().providers[id];
  if (!['default', 'none', 'custom'].includes(id) && !p) throw Error('Unknown block explorer.');
  url = String(url || '').trim();
  key = String(key || '').trim();
  if (id === 'custom' && !/^https:\/\/[^\s{}]+(\{chain\}[^\s{}]*)?$/.test(url)) throw Error('Enter the explorer API’s https URL; {chain} stands for the chain ID.');
  if (key && !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw Error('That does not look like an API key.');
  if (p && p.key === 'required' && !key) throw Error(p.name + ' needs an API key.');
  const keys = { ...c.keys };
  if (id !== 'default' && id !== 'none') key ? (keys[id] = key) : delete keys[id];
  store('explorer', { id, url: id === 'custom' ? url : c.url, keys });
  store('explorerkey', '');
  refused.clear();
}
// Chains an explorer refused (not covered, or not on your plan: for the session; rate-limited: for a minute):
// their reads go to the RPC. key → { name, busy, until }.
const refused = new Map();
const isRefused = (k) => { const x = refused.get(k); return !!x && (!x.until || x.until > Date.now() || !refused.delete(k)); };
const covers = (p, chain) => (p.urls && p.urls[chain]) || (p.api && (p.chains || []).includes(Number(chain)) ? p.api.split('{chain}').join(chain) : '');
const hostOf = (u) => { try { return new URL(u.split('{chain}').join('1')).hostname; } catch { return 'your block explorer'; } };
function resolve(id, chain, c) {
  if (id === 'custom') return c.url && { id, name: hostOf(c.url), url: c.url.split('{chain}').join(chain), key: c.keys.custom || '' };
  const p = config().providers[id], url = p && covers(p, chain), key = c.keys[id] || '';
  return url && !(p.key === 'required' && !key) && { id, name: p.name, url, key };
}
/** The explorer that serves `chain` now ({ id, name, url, key }), or null: reads go through the RPC. */
export function explorerFor(chain) {
  const c = explorerChoice();
  if (c.id === 'none') return null;
  const ok = (e) => e && !isRefused(e.id + ':' + chain);
  return (c.id === 'default' ? explorerDefaults().map((id) => resolve(id, chain, c)).find(ok) : [resolve(c.id, chain, c)].find(ok)) || null;
}
/** The explorer an index could come from on `chain` when none serves it (for "Use X's index"): a name or ''. */
export function explorerSuggestion(chain) {
  const c = explorerChoice(), named = (id) => config().providers[id] && covers(config().providers[id], chain) && config().providers[id].name;
  if (c.id === 'custom') return hostOf(c.url);
  if (c.id !== 'default' && c.id !== 'none' && named(c.id)) return named(c.id);
  return explorerDefaults().map(named).find(Boolean) || '';
}
/** The explorer that refused `chain` (its reads went to the RPC instead): { name, busy } or null. */
export const explorerRefused = (chain) => [...refused].find(([k]) => k.endsWith(':' + chain) && isRefused(k))?.[1] || null;
// Free plans allow a few requests a second: one at a time, spaced, retried on a rate limit.
let lane = Promise.resolve();
export function explorer(e, chain, q) {
  if (e.key) q.set('apikey', e.key);
  const run = async () => {
    for (let i = 0; ; i++) {
      const r = await getJson(e.url + (e.url.includes('?') ? '&' : '?') + q);
      if (r.status === '0' && /rate limit|too many requests/i.test(String(r.result) + ' ' + r.message)) {
        if (i < 3) { await new Promise((ok) => setTimeout(ok, 1100 * 2 ** i)); continue; }
        // Still limited (Blockscout allows 10 requests a minute without a key): the RPC for a minute.
        refused.set(e.id + ':' + chain, { name: e.name, busy: true, until: Date.now() + 60000 });
        throw Object.assign(Error(e.name + ' is busy (too many requests).'), { refused: true });
      }
      // The chain is not covered (or not on this plan): remember it, and read through the RPC instead.
      if (r.status === '0' && /not supported|unsupported|upgrade your api plan|chain not/i.test(String(r.result) + ' ' + r.message)) {
        refused.set(e.id + ':' + chain, { name: e.name });
        throw Object.assign(Error(e.name + ' does not cover this chain' + (e.key ? ' on your plan' : '') + '.'), { refused: true });
      }
      return r;
    }
  };
  const next = lane.then(run);
  lane = next.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, 250)));
  return next;
}
const hx = (v) => (!v || v === '0x' ? '0x0' : v); // Etherscan writes zero as "0x"
const bytes = (v) => (!v ? '0x' : String(v).startsWith('0x') ? v : '0x' + v); // Routescan writes empty data as ""
/**
 * eth_getLogs from a block explorer's index (`e`, from explorerFor): the whole range in pages of 1,000, as RPC
 * logs. The explorer is trusted to return every log; the reader checks each one against the chain.
 */
export async function explorerLogs(e, chain, { address, topics, fromBlock, toBlock }) {
  const out = [], seen = new Set();
  let from = Number(fromBlock), page = 1;
  const to = Number(toBlock);
  for (;;) {
    const q = new URLSearchParams({ module: 'logs', action: 'getLogs', address, fromBlock: from, toBlock: to, page, offset: 1000 });
    if (topics && topics[0]) q.set('topic0', topics[0]);
    const r = await explorer(e, chain, q);
    if (r.status !== '1' && !/no (records|logs)/i.test(r.message || '')) throw Error(e.name + ': ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed') + '. Check the block explorer in Settings.');
    const list = Array.isArray(r.result) ? r.result : [];
    for (const l of list) {
      const log = { address: l.address.toLowerCase(), topics: l.topics.filter(Boolean), data: bytes(l.data), blockNumber: hx(l.blockNumber), blockHash: l.blockHash, transactionHash: l.transactionHash, transactionIndex: hx(l.transactionIndex), logIndex: hx(l.logIndex), removed: false };
      const k = log.transactionHash + ':' + Number(log.logIndex);
      if (!seen.has(k)) seen.add(k), out.push(log);
    }
    if (list.length < 1000) break;
    // Pages stop at 10,000 results: continue from the last block seen (duplicates are dropped).
    if (page < 10) page++;
    else (from = Number(list[list.length - 1].blockNumber)), (page = 1);
  }
  return out.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
}

/**
 * The provider the app uses: `wallet` (EIP-1193) for everything, with reads routed as above. `chain()` is the
 * connected chain. `source` names what served the last logs ('your RPC', WalletConnect's RPC, a block explorer, or
 * null for the wallet); `wide` says whole log ranges come from an indexer at once.
 */
export function reader(wallet, { chain, projectId }) {
  const fallback = new Set(); // chains whose wallet RPC refused old history: history goes to WalletConnect's RPC
  const r = {
    wallet,
    source: null,
    get wide() { return !!explorerFor(chain()); },
    on: (...a) => wallet.on?.(...a),
    removeListener: (...a) => wallet.removeListener?.(...a),
    async request({ method, params = [] }) {
      const c = chain(), e = method === 'eth_getLogs' && explorerFor(c);
      if (e) {
        try { return await fromExplorer(e, c, params); }
        // It does not cover this chain (or is busy): this read, and the next ones, go through the RPC.
        catch (x) { if (!x.refused) throw x; }
      }
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
  // Logs from the block explorer, each checked against the chain: the block's header must have the hash the explorer
  // gave; an explorer that gives none (Blockscout) has each log found in its transaction's receipt instead, which
  // also gives the hash. A log whose receipt no RPC serves cannot be checked: the scan stops rather than skip it.
  async function fromExplorer(e, c, params) {
    const logs = await explorerLogs(e, c, params[0]), mismatch = (n) => Error(e.name + ' returned a log in block ' + Number(n) + ' that does not match the chain. Pick another block explorer (or None) in Settings and try again.');
    const same = (x, l) => Number(x.logIndex) === Number(l.logIndex) && x.address.toLowerCase() === l.address && String(x.data).toLowerCase() === String(l.data).toLowerCase() && x.topics.join().toLowerCase() === l.topics.join().toLowerCase();
    const four = async (list, f) => { for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(f)); };
    await four([...new Set(logs.filter((l) => !l.blockHash).map((l) => l.transactionHash))], async (t) => {
      const rc = (await r.request({ method: 'eth_getTransactionReceipt', params: [t] })) || (projectId && (await jsonRpc(WC_RPC(c, projectId), 'eth_getTransactionReceipt', [t]).catch(() => null)));
      if (!rc) throw Error('No RPC serves the receipt of ' + t + ', so its events from ' + e.name + ' cannot be checked. Add your own RPC (an archive node) in Settings, or pick another block explorer.');
      for (const l of logs.filter((x) => x.transactionHash === t)) {
        if (Number(rc.blockNumber) !== Number(l.blockNumber) || !(rc.logs || []).some((x) => same(x, l))) throw mismatch(l.blockNumber);
        l.blockHash = rc.blockHash;
      }
    });
    const want = new Map(logs.map((l) => [l.blockNumber, l.blockHash]));
    await four([...want.keys()], async (b) => {
      const header = await r.request({ method: 'eth_getBlockByNumber', params: [b, false] });
      if (!header || header.hash !== want.get(b)) throw mismatch(b);
    });
    r.source = e.name;
    return logs;
  }
  return r;
}

/**
 * A contract's name and verified ABI from the block explorer (`e`, from explorerFor; merged with its
 * implementation's, for a proxy), for display only: function names are matched to the selectors that execute.
 * Cached per chain and address.
 */
export async function explorerSource(e, chain, address) {
  const cache = 'src:' + chain + ':' + address, hit = load(cache, null);
  if (hit && typeof hit === 'object') return hit;
  const get = async (a) => {
    const r = await explorer(e, chain, new URLSearchParams({ module: 'contract', action: 'getsourcecode', address: a }));
    if (r.status !== '1' || !Array.isArray(r.result) || !r.result[0]) throw Error(e.name + ': ' + (typeof r.result === 'string' ? r.result : r.message || 'request failed'));
    return r.result[0];
  };
  const s = await get(address), abis = [];
  if (String(s.ABI).startsWith('[')) abis.push(...JSON.parse(s.ABI));
  let name = s.ContractName || null;
  // A proxy: Etherscan says Proxy "1" and Implementation, Blockscout IsProxy "true" and ImplementationAddress.
  const impl = (s.Proxy === '1' && s.Implementation) || (s.IsProxy === 'true' && s.ImplementationAddress) || '';
  if (/^0x[0-9a-fA-F]{40}$/.test(impl) && impl.toLowerCase() !== address.toLowerCase()) {
    const i = await get(impl.toLowerCase());
    if (String(i.ABI).startsWith('[')) abis.push(...JSON.parse(i.ABI));
    name = name || i.ContractName || null;
  }
  const out = { name, abi: abis.length ? JSON.stringify(abis) : null };
  store(cache, out);
  return out;
}
