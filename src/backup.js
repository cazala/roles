// Backup & sync: what this browser keeps for roles.wei (saved addresses, labels, contract ABIs and names), as JSON
// or a link to open on another device. Reads safe.wei backups too (their Safes, labels and ABIs). Your RPC
// endpoints and Etherscan key are never included: they are credentials.
import { utf8 } from './abi.js';
import { load as read, store as write } from './store.js';

const P = 'roles.wei:', addr = (a) => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a);
/** The ABIs and contract names you gave, by storage key (abi:<chain>:<address>, abiname:<chain>:<address>). */
function abiKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i).slice(P.length);
      if (localStorage.key(i).startsWith(P) && /^abi(name)?:\d+:0x[0-9a-f]{40}$/.test(k)) out.push(k);
    }
  } catch {}
  return out;
}

export function collect() {
  const abis = {};
  for (const k of abiKeys()) { const v = read(k, ''); if (v) abis[k] = v; }
  return { app: 'roles.wei', v: 1, at: new Date().toISOString(), saved: read('saved', []), labels: read('labels', {}), labelsAt: read('labelsAt', {}), abis };
}

export const counts = (d) => ({ saved: d.saved.length, labels: Object.keys(d.labels).length, abis: Object.keys(d.abis).filter((k) => k.startsWith('abi:')).length });

// ---- links: #import=<z|j><base64url>, deflated when the browser can (the same encoding as safe.wei) ----
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (data, T) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new T('deflate-raw'))).arrayBuffer());

export async function link(d) {
  const raw = utf8(JSON.stringify(d));
  const z = typeof CompressionStream === 'function' ? await pipe(raw, CompressionStream).catch(() => null) : null;
  return location.href.split('#')[0] + '#import=' + (z ? 'z' + b64(z) : 'j' + b64(raw));
}

/** Pasted text (an import link, the fragment alone, or backup JSON) of roles.wei or safe.wei, kept only where well formed. */
export async function parse(text) {
  text = text.trim();
  let d;
  const m = /(?:^|[#&])import=([zj])([A-Za-z0-9_-]+)/.exec(text);
  if (m) {
    const b = unb64(m[2]);
    d = JSON.parse(new TextDecoder().decode(m[1] === 'z' ? await pipe(b, DecompressionStream) : b));
  } else d = JSON.parse(text);
  if (!d || (d.app !== 'roles.wei' && d.app !== 'safe.wei')) throw Error('This is not a roles.wei or safe.wei backup.');
  const from = d.app;
  // safe.wei keeps Safes as { chainId, address } and ABIs as <chain>:<address>.
  const saved = (from === 'safe.wei' ? (d.safes || []).map((e) => e && { address: e.address, chain: e.chainId }) : d.saved || []).filter((e) => e && addr(e.address) && Number.isSafeInteger(e.chain)).map((e) => ({ address: e.address, chain: e.chain }));
  const labels = Object.fromEntries(Object.entries(d.labels || {}).filter(([a, l]) => addr(a) && typeof l === 'string' && l.trim()).map(([a, l]) => [a, l.trim().slice(0, 40)]));
  const labelsAt = Object.fromEntries(Object.entries(d.labelsAt || {}).filter(([a, t]) => labels[a] && Number.isFinite(t)));
  const abis = Object.fromEntries(Object.entries(d.abis || {}).map(([k, v]) => [from === 'safe.wei' ? 'abi:' + k : k, v]).filter(([k, v]) => /^abi(name)?:\d+:0x[0-9a-f]{40}$/.test(k) && typeof v === 'string' && v.length < 500000));
  return { app: 'roles.wei', from, at: d.at, saved, labels, labelsAt, abis };
}

/**
 * Apply a backup. 'merge' adds what is missing and never overwrites anything already here (so an imported label
 * cannot rename an address you already labeled); 'replace' swaps it all.
 */
export function apply(d, mode) {
  if (mode === 'replace') {
    for (const k of abiKeys()) write(k, '');
    write('saved', d.saved); write('labels', d.labels); write('labelsAt', d.labelsAt);
    for (const [k, v] of Object.entries(d.abis)) write(k, v);
    return;
  }
  const saved = read('saved', []), key = (e) => e.chain + ':' + e.address, have = new Set(saved.map(key));
  write('saved', [...saved, ...d.saved.filter((e) => !have.has(key(e)))]);
  const mine = read('labels', {});
  write('labels', { ...d.labels, ...mine });
  write('labelsAt', { ...Object.fromEntries(Object.entries(d.labelsAt).filter(([a]) => !mine[a])), ...read('labelsAt', {}) });
  for (const [k, v] of Object.entries(d.abis)) if (!read(k, '')) write(k, v);
}
