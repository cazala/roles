// Development-only, read-only RPC checks. No RPC endpoint is shipped in the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const pins = JSON.parse(await readFile(new URL('../config/research.json', import.meta.url), 'utf8'));
const abi = await readFile(new URL('../config/roles-2.1.1.abi.json', import.meta.url));
assert.equal(createHash('sha256').update(abi).digest('hex'), pins.abiSha256, 'Pinned ABI differs');
const chainId = process.env.CHAIN_ID || '1';
const chain = pins.chains[chainId];
if (!chain) throw Error('No research block pinned for CHAIN_ID=' + chainId);
const endpoint = process.env.RPC_URL;
if (!endpoint) throw Error('Set RPC_URL to an archive RPC for chain ' + chainId + '.');
const parsed = new URL(endpoint);
if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('RPC_URL must use HTTP or HTTPS.');
let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(method + ': HTTP ' + response.status);
  const data = await response.json();
  if (data.error) throw Error(method + ': ' + data.error.message);
  if (!Object.hasOwn(data, 'result')) throw Error(method + ': missing result');
  return data.result;
}

assert.equal(BigInt(await rpc('eth_chainId')), BigInt(chainId), 'Wrong RPC chain');
const block = '0x' + chain.block.toString(16);
const header = await rpc('eth_getBlockByNumber', [block, false]);
assert.equal(header?.hash, chain.blockHash, 'Pinned block hash differs');
for (const [name, contract] of Object.entries(pins.contracts)) {
  const code = await rpc('eth_getCode', [contract.address, block]);
  assert.match(code, /^0x(?:[0-9a-fA-F]{2})+$/, name + ': missing or malformed code');
  const bytes = Buffer.from(code.slice(2), 'hex');
  assert.equal(bytes.length, contract.runtimeBytes, name + ': runtime size differs');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), contract.runtimeSha256, name + ': runtime differs');
  console.log(name + ' ' + contract.version + ': verified ' + bytes.length + ' bytes');
}
if (Number(chainId) === pins.fixture.chainId) {
  const fixture = pins.fixture;
  assert.equal(await rpc('eth_getCode', [fixture.address, block]), fixture.code, 'Fixture implementation differs');
  // Selectors generated from keccakText(name + '()') using the pinned safe.wei ABI helpers.
  for (const [name, selector] of Object.entries(pins.fixtureGetters)) {
    const value = await rpc('eth_call', [{ to: fixture.address, data: selector }, block]);
    assert.match(value, /^0x0{24}[0-9a-fA-F]{40}$/, 'Invalid address result: ' + name);
    assert.equal('0x' + value.slice(-40).toLowerCase(), fixture[name], 'Fixture ' + name + ' differs');
  }
  console.log('Real Roles ' + fixture.version + ' fixture: proxy and owner/avatar/target verified');
}
console.log(chain.name + ' at block ' + chain.block + ': all research checks passed');
