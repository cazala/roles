import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseAbi } from '../../src/abicoder.js';
import { buildConditions } from '../../src/condition-builder.js';
import { validate } from '../../src/conditions.js';
import { executionPlan, simulateExecution } from '../../src/execution.js';
import { calldata, roleKey } from '../../src/roles.js';
import { ACCOUNTS, startFork, tx } from './anvil.mjs';
import { deployRoles } from './fixture.mjs';

let f,fixture,key;
before(async()=>{f=await startFork();fixture=await deployRoles(f);key=roleKey('complex');});
after(()=>f.stop());

test('ABI-derived tuple, dynamic bytes, dynamic array and fixed array pass deployed integrity and execution',async()=>{
  const [fn]=parseAbi('complex((address who,uint256 amount) info,bytes memo,uint256[] amounts,address[2] recipients)');
  const conditions=buildConditions(fn,{'info.who':{mode:'avatar'},'info.amount':{mode:'between',value:'1',second:'10'},memo:{mode:'equal',value:'0x1234'},'amounts[]':{mode:'greater',value:'0'},'recipients[1]':{mode:'equal',value:ACCOUNTS[4]}});
  validate(conditions);
  await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',[ACCOUNTS[1],[key],[true]]));
  await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('scopeTarget(bytes32 roleKey,address targetAddress)',[key,ACCOUNTS[2]]));
  await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',[key,ACCOUNTS[2],'0x'+fn.selector,conditions.map(c=>[BigInt(c.parent),BigInt(c.paramType),BigInt(c.operator),c.compValue]),0n]));
  const good=executionPlan(fixture.address,key,ACCOUNTS[2],'0','0',fn,[[fixture.safe,'5'],'0x1234',['2','3'],[ACCOUNTS[3],ACCOUNTS[4]]]);
  assert.equal(await simulateExecution(f.rpc,ACCOUNTS[1],good),true);
  const bad=executionPlan(fixture.address,key,ACCOUNTS[2],'0','0',fn,[[fixture.safe,'11'],'0x1234',['2'],[ACCOUNTS[3],ACCOUNTS[4]]]);
  await assert.rejects(()=>simulateExecution(f.rpc,ACCOUNTS[1],bad));
});

test('local validator and deployed Integrity reject the same malformed scalar comparison',async()=>{
  const [fn]=parseAbi('bad(uint256 amount)'),conditions=[{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:1,operator:16,compValue:'0x'}];
  assert.throws(()=>validate(conditions));
  const data=calldata('scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',[key,ACCOUNTS[2],'0x'+fn.selector,conditions.map(c=>[BigInt(c.parent),BigInt(c.paramType),BigInt(c.operator),c.compValue]),0n]);
  await assert.rejects(()=>f.rpc('eth_call',[{from:ACCOUNTS[0],to:fixture.address,data},'latest']));
});
