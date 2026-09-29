// History (logs, code and headers at past blocks) for the permission scan. The wallet's RPC is used when it
// can serve it. Many wallet RPCs are full nodes that drop old state or old logs; then the scan continues
// through another RPC: the one the user set in History options, else WalletConnect's. Every log is still
// checked by the scan (range, address, block hashes), whichever RPC served it.
import { jsonRpc } from './net.js';
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

/**
 * A request function for history reads: through `request` (the wallet), or through the user's RPC when set,
 * or WalletConnect's after the wallet refuses old data. `used(label)` is told which one serves the scan.
 */
export function historyRequest(request, { chain, projectId, used = () => {} }) {
  let alt = null, checked = null;
  const own = ownRpc();
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
  return async (method, params = []) => {
    if (alt && METHODS.includes(method)) return alt(method, params);
    try {
      return await request(method, params);
    } catch (e) {
      if (!METHODS.includes(method) || !noHistory(e) || !projectId) throw e;
      via(WC_RPC(chain, projectId), 'WalletConnect’s RPC (your wallet’s RPC does not keep this history)');
      return alt(method, params);
    }
  };
}
