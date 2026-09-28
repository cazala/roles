import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData } from 'viem';
import { parseAbi } from '../../src/abicoder.js';
import { executionPlan } from '../../src/execution.js';
import { roleKey } from '../../src/roles.js';

const MOD='0x1111111111111111111111111111111111111111',TARGET='0x2222222222222222222222222222222222222222';
test('role execution wraps typed ABI calldata without attaching the Safe value',()=>{
  const [fn]=parseAbi('transfer(address recipient,uint256 amount)');
  const plan=executionPlan(MOD,roleKey('spender'),TARGET,'5','0',fn,['0x3333333333333333333333333333333333333333','7']);
  assert.equal(plan.value,0n);assert.equal(plan.safeValue,5n);assert.equal(plan.to,MOD);
  const decoded=decodeFunctionData({abi:[{type:'function',name:'execTransactionWithRole',inputs:[{type:'address',name:'to'},{type:'uint256',name:'value'},{type:'bytes',name:'data'},{type:'uint8',name:'operation'},{type:'bytes32',name:'roleKey'},{type:'bool',name:'shouldRevert'}]}],data:plan.data});
  assert.equal(decoded.args[0].toLowerCase(),TARGET);assert.equal(decoded.args[1],5n);assert.equal(decoded.args[5],true);
});
