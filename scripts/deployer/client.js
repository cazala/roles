// Sends the embedded CREATE2 plan, then verifies html() against contentHash.
import { bytes, cd, dbytes, keccakHex, keccakText, strip } from '../../src/abi.js';
import { h, put } from '../../src/ui.js';

const P = window.PLAN, eth = window.ethereum;
const $ = id => document.getElementById(id);
const rpc = (method, params = []) => eth.request({ method, params });
const CAP = 16_000_000n;
const log = (...message) => $('log').append(h('div', ...message));
let from = null, chain = null;
const status = () => Promise.all(P.steps.map(async step => (await rpc('eth_getCode', [step.address, 'latest'])) !== '0x'));

async function render() {
  const done = eth && chain ? await status() : P.steps.map(() => null);
  put($('steps'), P.steps.map((step, i) => h('tr', h('td', step.name), h('td', h('code', step.address)), h('td', (step.initcode.length - 2) / 2 + ' B'), h('td', done[i] == null ? '?' : done[i] ? h('b.ok', 'deployed') : 'pending'))));
  const todo = done.filter(value => value === false).length;
  $('deploy').disabled = !from || !todo;
  $('deploy').textContent = todo ? 'Deploy (' + todo + ' transaction' + (todo > 1 ? 's' : '') + ')' : 'Deploy';
  if (done.every(Boolean)) await verify();
}
async function connect() {
  if (!eth) return put($('wallet'), h('b.bad', 'No browser wallet found.'));
  [from] = await rpc('eth_requestAccounts');
  chain = Number(await rpc('eth_chainId'));
  const code = await rpc('eth_getCode', [P.deployer, 'latest']);
  put($('wallet'), h('code', from), ' on chain ', h('b', String(chain)), chain === 1 ? ' (Ethereum mainnet)' : h('b.bad', ' (rehearsal network)'), code === '0x' && h('p.bad', 'The CREATE2 deployer does not exist on this chain.'));
  const gasPrice = BigInt(await rpc('eth_gasPrice'));
  put($('cost'), '≈ ' + P.gas.toLocaleString() + ' gas × ' + (Number(gasPrice) / 1e9).toFixed(3) + ' gwei ≈ ' + (Number(BigInt(P.gas) * gasPrice) / 1e18).toFixed(5) + ' ETH (estimate)');
  await render();
}
async function wait(hash) {
  for (;;) { const receipt = await rpc('eth_getTransactionReceipt', [hash]); if (receipt) return receipt; await new Promise(resolve => setTimeout(resolve, 3000)); }
}
async function deploy() {
  $('deploy').disabled = true;
  try {
    for (const step of P.steps) {
      if ((await rpc('eth_getCode', [step.address, 'latest'])) !== '0x') continue;
      const transaction = { from, to: P.deployer, data: step.salt + strip(step.initcode) };
      const estimate = BigInt(await rpc('eth_estimateGas', [transaction]));
      const gas = (estimate * 12n) / 10n < CAP ? (estimate * 12n) / 10n : CAP;
      log('Sending ' + step.name + ' (' + estimate + ' gas estimated)…');
      const hash = await rpc('eth_sendTransaction', [{ ...transaction, gas: '0x' + gas.toString(16) }]);
      const receipt = await wait(hash);
      if (receipt.status !== '0x1') throw Error(step.name + ' reverted in ' + hash);
      if ((await rpc('eth_getCode', [step.address, 'latest'])) === '0x') throw Error(step.name + ' is not at ' + step.address);
      log('✓ ', step.name, ' at ', h('code', step.address), ' · ' + BigInt(receipt.gasUsed) + ' gas');
    }
  } catch (error) { log(h('b.bad', 'Stopped: ' + (error.message || error) + '. Press Deploy again to continue.')); }
  await render();
}
async function verify() {
  const page = dbytes(await rpc('eth_call', [{ to: P.app, data: keccakText('html()').slice(0, 10) }, 'latest']));
  const ok = keccakHex(page) === P.contentHash && bytes(page).length === P.size;
  const tokenId = '0xc36e20c40544867956c355bcd6884c9f6ff3fe571a13891f39612f95318603f4';
  const record = { chainId: chain, app: P.app, chunks: P.chunks, salt: P.salt, appSalt: P.appSalt, size: P.size, contentHash: P.contentHash, codeHash: keccakHex(await rpc('eth_getCode', [P.app, 'latest'])) };
  put($('result'), ok ? h('p.ok', '✓ html() matches the build: ' + P.size + ' bytes, contentHash ' + P.contentHash) : h('p.bad', '✗ html() does not match. Do not point roles.wei at it.'), ok && [h('h2', 'Next: point roles.wei'), h('p', 'From the roles.wei owner, send setAddr(uint256,address) to the WNS NameNFT:'), h('pre', 'to   0x0000000000696760E15f265e828DB644A0c242EB\ndata ' + cd(keccakText('setAddr(uint256,address)').slice(2, 10), tokenId, P.app)), h('p', 'Save this record as deploy/' + chain + '.json:'), h('pre', JSON.stringify(record, null, 2))]);
}
$('connect').onclick = () => connect().catch(error => log(h('b.bad', error.message || String(error))));
$('deploy').onclick = deploy;
if (eth?.on) eth.on('chainChanged', () => location.reload()), eth.on('accountsChanged', () => location.reload());
render();
