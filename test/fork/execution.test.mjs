import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseAbi } from '../../src/abicoder.js';
import { executionPlan, simulateExecution } from '../../src/execution.js';
import { calldata, roleKey } from '../../src/roles.js';
import { ACCOUNTS, startFork, tx } from './anvil.mjs';
import { deployRoles } from './fixture.mjs';

let f,fixture,key;
before(async()=>{f=await startFork();fixture=await deployRoles(f);key=roleKey('caller');await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',[ACCOUNTS[1],[key],[true]]));await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('allowTarget(bytes32 roleKey,address targetAddress,uint8 options)',[key,ACCOUNTS[2],0n]));});
after(()=>f.stop());

test('member simulation succeeds and the exact wrapper executes',async()=>{
  const [fn]=parseAbi('ping()'),plan=executionPlan(fixture.address,key,ACCOUNTS[2],'0','0',fn,[]);
  assert.equal(await simulateExecution(f.rpc,ACCOUNTS[1],plan),true);await tx(f.rpc,ACCOUNTS[1],plan.to,plan.data);
});

test('nonmember simulation is denied',async()=>{
  const [fn]=parseAbi('ping()'),plan=executionPlan(fixture.address,key,ACCOUNTS[2],'0','0',fn,[]);
  await assert.rejects(()=>simulateExecution(f.rpc,ACCOUNTS[3],plan));
});

test('downstream revert is surfaced by simulation',async()=>{
  await f.rpc('anvil_setCode',[ACCOUNTS[4],'0x60006000fd']);await tx(f.rpc,ACCOUNTS[0],fixture.address,calldata('allowTarget(bytes32 roleKey,address targetAddress,uint8 options)',[key,ACCOUNTS[4],0n]));
  const [fn]=parseAbi('fail()'),plan=executionPlan(fixture.address,key,ACCOUNTS[4],'0','0',fn,[]);
  await assert.rejects(()=>simulateExecution(f.rpc,ACCOUNTS[1],plan));
});
