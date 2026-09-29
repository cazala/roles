// Every network request roles.wei makes outside the wallet goes through here, and the build allows only
// these two: WalletConnect's relay (a wallet connected by QR code), and JSON-RPC for reads the connected
// wallet cannot serve (a phone wallet; a wallet RPC without old logs). Nothing else leaves the page.
export const socket = (url) => new WebSocket(url);

let id = 1;
/** One JSON-RPC call over HTTPS. Errors keep the RPC's code and message. */
export async function jsonRpc(url, method, params = []) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
  if (!res.ok) throw Error('The RPC answered ' + res.status + (res.status === 429 ? ' (too many requests): try again in a moment.' : '.'));
  const j = await res.json();
  if (j.error) throw Object.assign(Error(j.error.message || 'RPC error'), { code: j.error.code, data: j.error.data });
  return j.result;
}
