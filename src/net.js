// Every network request roles.wei makes outside the wallet goes through here, and the build allows only
// these two: WalletConnect's relay (a wallet connected by QR code), and JSON-RPC for reads the connected
// wallet cannot serve (a phone wallet; a wallet RPC without old logs), plus the block explorer API when the user
// gave a key for it. Nothing else leaves the page.
export const socket = (url) => new WebSocket(url);

/** GET or POST JSON over HTTPS (the one fetch in the page). */
async function json(url, body, what = 'The RPC') {
  // A request that never got through (network hiccup, a busy RPC closing the connection) is tried again twice.
  let res;
  for (let i = 0; ; i++) {
    try {
      res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      break;
    } catch (e) {
      if (i >= 2) throw Error(what + ' could not be reached (' + e.message + ')');
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
  if (res.ok) return res.json();
  // Many RPCs answer an HTTP error with a JSON-RPC error inside (e.g. a log range too wide): keep its message.
  const j = await res.json().catch(() => null);
  if (j && j.error) return j;
  throw Error(what + ' answered ' + res.status + (res.status === 429 ? ' (too many requests): try again in a moment.' : '.'));
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
