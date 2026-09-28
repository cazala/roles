// roles.wei name helper. Read-only: it never sends a transaction.
//   node scripts/name.mjs --rpc <url> [--name roles] [--app 0x…]
import { readFileSync } from 'node:fs';
import { a, cd, keccakHex, keccakText, str, strip } from '../src/abi.js';
import { MAINNET } from '../src/chains.js';

const arg = (key, fallback) => {
  const i = process.argv.indexOf('--' + key);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const url = arg('rpc'), name = arg('name', 'roles'), app = arg('app');
if (!url) throw Error('--rpc <url> is required');
const WEI_NODE = '0xa82820059d5df798546bcc2985157a77c3eef25eba9ba01899927333efacbd6f';
let requestId = 0;
const call = async (to, data) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'eth_call', params: [{ to, data }, 'latest'] }) }).then(r => r.json());
  if (response.error) throw Error(response.error.message);
  return response.result;
};
const selector = signature => keccakText(signature).slice(2, 10);
const tokenId = keccakHex(WEI_NODE + strip(keccakText(name)));
const owner = a(await call(MAINNET.wns, cd(selector('ownerOf(uint256)'), tokenId)));
const resolved = a(await call(MAINNET.wns, cd(selector('resolve(uint256)'), tokenId)));
console.log(name + '.wei  tokenId ' + tokenId + '\nowner    ' + owner + '\nresolves ' + resolved);

if (app) {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const live = str(await call(app, '0x' + selector('html()')));
  console.log('app html() ' + (live === html ? 'matches' : 'DOES NOT MATCH') + ' dist/index.html');
  if (resolved.toLowerCase() === app.toLowerCase()) console.log('\n' + name + '.wei already points at the app.');
  else console.log('\nTo point ' + name + '.wei at the app, send from ' + owner + ':\n  to   ' + MAINNET.wns + '\n  data ' + cd(selector('setAddr(uint256,address)'), tokenId, app) + '   # setAddr(uint256,address)\n  or: cast send ' + MAINNET.wns + ' "setAddr(uint256,address)" ' + BigInt(tokenId) + ' ' + app);
}
