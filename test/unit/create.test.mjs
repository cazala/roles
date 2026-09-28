import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, getCreate2Address, keccak256 } from 'viem';
import { creation, creationCalls } from '../../src/create-plan.js';
import { FACTORY, MASTER } from '../../src/roles.js';

const SAFE='0x1111111111111111111111111111111111111111';

test('creation plan matches the factory CREATE2 formula and exact deploy calldata',()=>{
  const plan=creation(SAFE,SAFE,SAFE,7n);
  const proxyCode='0x602d8060093d393df3363d3d373d3d3d363d73'+MASTER.slice(2)+'5af43d82803e903d91602b57fd5bf3';
  const salt=keccak256(keccak256(plan.initializer)+7n.toString(16).padStart(64,'0'));
  assert.equal(plan.proxy,getCreate2Address({from:FACTORY,bytecodeHash:keccak256(proxyCode),salt}).toLowerCase());
  const decoded=decodeFunctionData({abi:[{type:'function',name:'deployModule',inputs:[{name:'masterCopy',type:'address'},{name:'initializer',type:'bytes'},{name:'saltNonce',type:'uint256'}]}],data:plan.data});
  assert.deepEqual([decoded.args[0].toLowerCase(),decoded.args[1],decoded.args[2]],[MASTER,plan.initializer,7n]);
  const calls=creationCalls(SAFE,plan);
  assert.equal(calls.length,2);assert.equal(calls[0].to,FACTORY);assert.equal(calls[1].to,SAFE);
});
