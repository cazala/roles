import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi as referenceAbi } from 'viem';
import { parseAbi, encodeCall, matchCall, humanSig } from '../../src/abicoder.js';

test('Roles tuple-array calldata matches viem and decodes canonically', () => {
  const signature = 'scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)';
  const f = parseAbi(signature)[0];
  const values = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(20), '0xa9059cbb', [[0n, 5n, 5n, '0x'], [0n, 1n, 0n, '0x']], 0n];
  const data = encodeCall(f, values);
  assert.equal(data, encodeFunctionData({ abi: referenceAbi(['function ' + signature]), functionName: 'scopeFunction', args: values }));
  assert.ok(matchCall([humanSig(f)], data));
  assert.equal(matchCall([humanSig(f)], data + '00'), null);
});
