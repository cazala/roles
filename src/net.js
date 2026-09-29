// Every network request roles.wei makes outside the wallet goes through here, and the build allows only
// these two: WalletConnect's relay (a wallet connected by QR code), and JSON-RPC for reads the connected
// wallet cannot serve (a phone wallet; a wallet RPC without old logs), plus the block explorer API when the user
// gave a key for it. Nothing else leaves the page.
export const socket = (url) => new WebSocket(url);

/** GET or POST JSON over HTTPS (the one fetch in the page). */
async function json(url, body, what = 'The RPC') {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) throw Error(what + ' answered ' + res.status + (res.status === 429 ? ' (too many requests): try again in a moment.' : '.'));
  return res.json();
}
/** A GET returning JSON (the block explorer API). */
export const getJson = (url) => json(url, null, 'The block explorer');

let id = 1;
/** One JSON-RPC call over HTTPS. Errors keep the RPC's code and message. */
export async function jsonRpc(url, method, params = []) {
  const j = await json(url, { jsonrpc: '2.0', id: id++, method, params });
  if (j.error) throw Object.assign(Error(j.error.message || 'RPC error'), { code: j.error.code, data: j.error.data });
  return j.result;
}
