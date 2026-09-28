import { load, store } from './store.js';
import { quantity, decodeEvent } from './roles.js';
const cancelled = signal => { if (signal?.aborted) throw Error('Scan paused. Resume to continue.'); };
export async function deploymentBlock(request, address, latest, signal) {
  // Bracket backwards first: a fresh deployment must not require ancient archive state.
  let high = latest, distance = 1000, low = Math.max(0, latest - distance);
  while (low > 0 && await request('eth_getCode', [address, quantity(low)]) !== '0x') {
    cancelled(signal); high = low; distance *= 2; low = Math.max(0, latest - distance);
  }
  while (low < high) { cancelled(signal); const mid = Math.floor((low + high) / 2); if (await request('eth_getCode', [address, quantity(mid)]) === '0x') low = mid + 1; else high = mid; }
  return low;
}
export async function scan(request, { address, chain, block, signal, progress = () => {}, start, budget = 24 }) {
  const key = 'scan:2:' + chain + ':' + address;
  let cache = load(key, null);
  if (cache && (!Array.isArray(cache.logs) || !Number.isSafeInteger(cache.last) || !Number.isSafeInteger(cache.start))) cache = null;
  if (cache) { const header = await request('eth_getBlockByNumber', [quantity(cache.last), false]); if (header?.hash !== cache.hash || cache.last > block || start != null && Number(start) !== cache.start) cache = null; }
  if (!cache) {
    const first = start == null ? await deploymentBlock(request, address, block, signal) : Number(start);
    if (!Number.isSafeInteger(first) || first < 0 || first > block) throw Error('Start block must be between zero and the current block.');
    cache = { start: first, partial: start != null && first !== 0, last: first - 1, hash: null, logs: [] };
  }
  let window = 5000, windows = 0;
  while (cache.last < block && windows < budget) {
    cancelled(signal); const from = cache.last + 1, to = Math.min(block, from + window - 1);
    const before = await request('eth_getBlockByNumber', [quantity(to), false]);
    let logs;
    try { logs = await request('eth_getLogs', [{ address, fromBlock: quantity(from), toBlock: quantity(to) }]); }
    catch (e) { if (window > 1 && /range|limit|size|result|response|too many|too large/i.test(e.message)) { window = Math.max(1, Math.floor(window / 2)); continue; } throw Error('Stopped at block ' + cache.last + ': ' + e.message); }
    cancelled(signal);
    for (const log of logs) { if (log.address.toLowerCase() !== address || Number(BigInt(log.blockNumber)) < from || Number(BigInt(log.blockNumber)) > to) throw Error('RPC returned a log outside the requested range'); decodeEvent(log); }
    const header = await request('eth_getBlockByNumber', [quantity(to), false]);
    if (!header || header.hash !== before?.hash) throw Error('Chain changed during scan. Reset and retry.');
    cache.logs.push(...logs); cache.last = to; cache.hash = header.hash;
    store(key, cache); progress({ last: to, block, events: cache.logs.length }); windows++;
  }
  return { ...cache, complete: cache.last === block && !cache.partial, caughtUp: cache.last === block };
}
export const clearScan = (chain, address) => store('scan:2:' + chain + ':' + address, null);
