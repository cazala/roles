import { load, store } from './store.js';
import { quantity, decodeEvent, SETUP_TOPIC } from './roles.js';
import { noHistory } from './history.js';
const cancelled = signal => { if (signal?.aborted) throw Error('Scan paused. Resume to continue.'); };
// Most wallet RPCs are full nodes, not archives: past state (eth_getCode at an old block) is gone, logs are not.
const tooWide = e => /range|limit|size|result|response|too many|too large/i.test(e?.message || '');

/** The deployment block: by code at past blocks where the RPC keeps them, else by the setup event in the logs. */
export async function deploymentBlock(request, address, latest, signal) {
  if (request.wide) return setupBlock(request, address, latest, signal); // an indexer finds the setup event at once
  try { return await codeBlock(request, address, latest, signal); }
  catch (e) { if (!noHistory(e)) throw e; return setupBlock(request, address, latest, signal); }
}
/**
 * Without archive state: walk the logs back from `latest` to the modifier's RolesModSetup, which setUp emits
 * once, when the proxy is deployed. Nothing can precede it, so a scan from that block is complete.
 */
export async function setupBlock(request, address, latest, signal) {
  let to = latest, window = latest + 1;
  while (to >= 0) {
    cancelled(signal); const from = Math.max(0, to - window + 1);
    let logs;
    try { logs = await request('eth_getLogs', [{ address, topics: [SETUP_TOPIC], fromBlock: quantity(from), toBlock: quantity(to) }]); }
    // Some RPCs also refuse a range reaching far back as an "archive" request: narrow it the same way.
    catch (e) { if (window > 1 && (tooWide(e) || noHistory(e))) { window = Math.max(1, Math.floor(window / 2)); continue; } throw e; }
    if (logs.length) return Math.min(...logs.map(l => Number(BigInt(l.blockNumber))));
    to = from - 1;
  }
  throw Error('This modifier’s setup event was not found. Enter a start block in History options.');
}
async function codeBlock(request, address, latest, signal) {
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
  let window = request.wide ? block + 1 : 5000, windows = 0; // an indexer serves the whole range in one request
  while (cache.last < block && windows < budget) {
    cancelled(signal); const from = cache.last + 1, to = Math.min(block, from + window - 1);
    const before = await request('eth_getBlockByNumber', [quantity(to), false]);
    let logs;
    try { logs = await request('eth_getLogs', [{ address, fromBlock: quantity(from), toBlock: quantity(to) }]); }
    catch (e) { if (window > 1 && tooWide(e)) { window = Math.max(1, Math.floor(window / 2)); continue; } throw Error('Stopped at block ' + cache.last + ': ' + e.message); }
    cancelled(signal);
    for (const log of logs) { if (log.address.toLowerCase() !== address || Number(BigInt(log.blockNumber)) < from || Number(BigInt(log.blockNumber)) > to) throw Error('RPC returned a log outside the requested range'); decodeEvent(log); }
    const header = await request('eth_getBlockByNumber', [quantity(to), false]);
    if (!header || header.hash !== before?.hash) throw Error('Chain changed during scan. Reset and retry.');
    cache.logs.push(...logs); cache.last = to; cache.hash = header.hash;
    store(key, cache); progress({ last: to, block, events: cache.logs.length }); windows++;
  }
  // A start typed by hand is still complete history when the scan contains the modifier's setup event.
  const setup = cache.logs.some(l => l.topics?.[0]?.toLowerCase() === SETUP_TOPIC);
  return { ...cache, complete: cache.last === block && (!cache.partial || setup), caughtUp: cache.last === block };
}
export const clearScan = (chain, address) => store('scan:2:' + chain + ':' + address, null);
