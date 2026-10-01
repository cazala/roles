// Dev server for dist/index.html (run `npm run build` first).
//   node scripts/dev.mjs                 serve on :5173
//   node scripts/dev.mjs --anvil URL     also inject a test wallet backed by an Anvil node,
//                                        using its unlocked accounts (?acct=N picks one).
//   node scripts/dev.mjs --live [--chain 1] [--as 0xADDRESS]
//                                        a read-only test wallet on the real chain, "as" that address
//                                        (default: no account of yours), reading through Alchemy, and the
//                                        history from Etherscan: the keys (ALCHEMY_API_KEY, ETHERSCAN_API_KEY
//                                        in .env) stay in this server; the page sees a placeholder key.
//   ... --port N                         listen on N
//   ... --onchain 0xAPP                  serve html() read from that deployed app via the node,
//                                        instead of dist/index.html
// The injected wallet exists ONLY in this dev server, never in the build.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { str } from '../src/abi.js';
import { shim } from './shim.mjs';

const root = new URL('..', import.meta.url).pathname;
const i = process.argv.indexOf('--anvil');
const anvil = i > 0 ? process.argv[i + 1] : null;
const k = process.argv.indexOf('--port');
const port = Number(k > 0 ? process.argv[k + 1] : process.env.PORT || (process.argv.includes('--onchain') ? 5174 : 5173));
const j = process.argv.indexOf('--onchain');
const app = j > 0 ? process.argv[j + 1] : null;
// --live: the RPC and Etherscan keys from .env, used only here (never sent to the page).
const live = process.argv.includes('--live');
const arg = (name, d) => { const x = process.argv.indexOf('--' + name); return x > 0 ? process.argv[x + 1] : d; };
let liveRpc = null, etherscanKey = '', liveOpts = null;
if (live) {
  const env = Object.fromEntries(readFileSync(root + '.env', 'utf8').split('\n').map((l) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  const chain = Number(arg('chain', 1)), net = { 1: 'eth-mainnet', 10: 'opt-mainnet', 100: 'gnosis-mainnet', 137: 'polygon-mainnet', 8453: 'base-mainnet', 42161: 'arb-mainnet', 11155111: 'eth-sepolia' }[chain];
  if (!env.ALCHEMY_API_KEY || !net) throw Error('--live needs ALCHEMY_API_KEY in .env and a chain Alchemy serves (' + chain + ')');
  liveRpc = 'https://' + net + '.g.alchemy.com/v2/' + env.ALCHEMY_API_KEY;
  etherscanKey = env.ETHERSCAN_API_KEY || '';
  const account = String(arg('as', '0x000000000000000000000000000000000000dEaD')).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(account)) throw Error('--as must be a 0x address');
  liveOpts = { account, placeholder: etherscanKey ? 'DevServerAddsTheRealKey00' : '' };
}
const upstream = anvil || liveRpc;
const page = async () => {
  if (!app) return readFileSync(root + 'dist/index.html', 'utf8');
  const r = await fetch(anvil, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: app, data: '0x33c34ac3' }, 'latest'] }) }).then((r) => r.json());
  return str(r.result); // html()
};

createServer(async (req, res) => {
  if (req.url === '/favicon.ico') return res.writeHead(404).end();
  // The test wallet talks to Anvil through this server, so it also works from other devices on the LAN.
  if (upstream && req.method === 'POST' && req.url === '/rpc') {
    const body = await new Response(req).text();
    const r = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then((r) => r.text(), (e) => JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(e.message) } }));
    return res.writeHead(200, { 'content-type': 'application/json' }).end(r);
  }
  // --live: Etherscan through this server, with the real key in place of the page's placeholder.
  if (live && req.url.startsWith('/etherscan?')) {
    const q = new URLSearchParams(req.url.slice('/etherscan?'.length));
    if (etherscanKey) q.set('apikey', etherscanKey);
    const r = await fetch('https://api.etherscan.io/v2/api?' + q).then((x) => x.text(), (e) => JSON.stringify({ status: '0', message: 'NOTOK', result: String(e.message) }));
    return res.writeHead(200, { 'content-type': 'application/json' }).end(r);
  }
  let html = await page();
  if (upstream) html = html.replace('<head>', '<head>' + shim('/rpc', liveOpts));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}).listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat().filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address);
  for (const ip of ['localhost', ...lan]) console.log('http://' + ip + ':' + port + (anvil ? '  (test wallet → ' + anvil + ')' : live ? '  (live read-only wallet as ' + liveOpts.account + ', chain ' + arg('chain', 1) + (etherscanKey ? ', Etherscan through this server' : '') + ')' : '') + (app ? '  serving html() of ' + app : ''));
});
