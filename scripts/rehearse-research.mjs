// Phase-0 experiment. Requires the pinned sibling safe checkout and Foundry Anvil.
// All writes use the local fork and its disposable test accounts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startFork, deploySafe, ACCOUNTS, tx } from '../../safe/test/fork/anvil.mjs';
import { B, cd, encode, a, keccakText, keccakHex } from '../../safe/src/abi.js';

const pins = JSON.parse(await readFile(new URL('../config/research.json', import.meta.url), 'utf8'));
const selector = signature => keccakText(signature).slice(2, 10);
const block = pins.chains['1'].block;
const fork = await startFork(19587, {
  url: process.env.FORK_URL || 'https://eth.drpc.org',
  block,
});

try {
  const header = await fork.rpc('eth_getBlockByNumber', ['0x' + block.toString(16), false]);
  assert.equal(header.hash, pins.chains['1'].blockHash, 'Unexpected fork block');

  const safe = await deploySafe(fork.rpc, '1.4.1', [ACCOUNTS[0]], 1, 987650n);
  const factory = pins.contracts.factory.address;
  const mastercopy = pins.contracts.roles.address;
  const saltNonce = 123456n;
  const initializer = cd(selector('setUp(bytes)'), B('0x' + encode([safe, safe, safe])));
  const data = cd(selector('deployModule(address,bytes,uint256)'), mastercopy, B(initializer), saltNonce);
  const predicted = a(await fork.rpc('eth_call', [{ from: ACCOUNTS[0], to: factory, data }, 'latest']));

  const initCode = '0x602d8060093d393df3363d3d373d3d3d363d73' + mastercopy.slice(2)
    + '5af43d82803e903d91602b57fd5bf3';
  const salt = keccakHex('0x' + encode([keccakHex(initializer), saltNonce]));
  const localPrediction = '0x' + keccakHex('0xff' + factory.slice(2) + salt.slice(2)
    + keccakHex(initCode).slice(2)).slice(-40);
  assert.equal(localPrediction, predicted, 'CREATE2 prediction differs from factory simulation');

  const receipt = await tx(fork.rpc, ACCOUNTS[0], factory, data);
  const code = await fork.rpc('eth_getCode', [predicted, 'latest']);
  assert.equal(code, '0x363d3d373d3d3d363d73' + mastercopy.slice(2)
    + '5af43d82803e903d91602b57fd5bf3', 'Unexpected proxy runtime');
  for (const field of ['owner', 'avatar', 'target']) {
    const value = await fork.rpc('eth_call', [{ to: predicted, data: '0x' + selector(field + '()') }, 'latest']);
    assert.equal(a(value), safe, 'Unexpected ' + field);
  }
  console.log(JSON.stringify({
    forkBlock: block, safe, predicted, localPrediction,
    proxyBytes: (code.length - 2) / 2, receiptStatus: receipt.status,
    setupLogs: receipt.logs.length,
  }, null, 2));
} finally {
  fork.stop();
}
