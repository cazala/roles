import test from 'node:test';
import assert from 'node:assert/strict';
import { readAbi } from '../../src/abifile.js';
import { parseAbi } from '../../src/abicoder.js';

const abi = [{ type: 'function', name: 'withdraw', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'onBehalf', type: 'address' }], outputs: [], stateMutability: 'nonpayable' }];
test('ABIs as people have them: a plain ABI, Hardhat / Truffle and Foundry artifacts, signatures', () => {
  assert.deepEqual(readAbi(JSON.stringify(abi)), { abi: JSON.stringify(abi), name: null });
  assert.equal(readAbi(JSON.stringify({ contractName: 'VaultV2', abi })).name, 'VaultV2', 'Hardhat / Truffle');
  assert.equal(readAbi(JSON.stringify({ abi, metadata: { settings: { compilationTarget: { 'src/VaultV2.sol': 'VaultV2' } } } })).name, 'VaultV2', 'Foundry');
  assert.equal(readAbi(JSON.stringify({ abi, metadata: JSON.stringify({ settings: { compilationTarget: { 'src/X.sol': 'X' } } }) })).name, 'X', 'metadata as a string');
  assert.equal(parseAbi(readAbi(JSON.stringify({ contractName: 'VaultV2', abi })).abi)[0].selector, 'b460af94');
  assert.deepEqual(readAbi('approve(address _spender, uint256 _value)'), { abi: 'approve(address _spender, uint256 _value)', name: null });
  assert.throws(() => readAbi('{"bytecode":"0x"}'), /no "abi"/);
});
