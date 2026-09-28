import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { verifyCreation, creationCalls } from '../../src/create-plan.js';
import { batch } from '../../src/multisend.js';
import { identify, metadata, safeModules, MULTISEND, FACTORY } from '../../src/roles.js';
import { ACCOUNTS, deploySafe, startFork, tx } from './anvil.mjs';
import { safeCall } from './fixture.mjs';

let f;
before(async()=>{f=await startFork();});
after(()=>f.stop());

test('predicted Roles proxy deploys and enables atomically from a Safe batch',async()=>{
  const safe=await deploySafe(f.rpc,'1.4.1',[ACCOUNTS[0]],1,1501n);
  const plan=await verifyCreation(f.rpc,ACCOUNTS[0],{owner:safe,avatar:safe,target:safe,salt:1502n});
  const call=batch(MULTISEND,creationCalls(safe,plan));
  await safeCall(f,safe,call.to,call.data,call.operation);
  assert.equal((await identify(f.rpc,plan.proxy)).supported,true);
  assert.deepEqual((await safeModules(f.rpc,safe)).modules,[plan.proxy]);
});

test('wallet deploy keeps module inert until the Safe enables it',async()=>{
  const safe=await deploySafe(f.rpc,'1.4.1',[ACCOUNTS[0]],1,1511n);
  const plan=await verifyCreation(f.rpc,ACCOUNTS[0],{owner:safe,avatar:safe,target:safe,salt:1512n});
  await tx(f.rpc,ACCOUNTS[0],FACTORY,plan.data);
  assert.deepEqual(await metadata(f.rpc,plan.proxy),{owner:safe,avatar:safe,target:safe});
  assert.deepEqual((await safeModules(f.rpc,safe)).modules,[]);
  const enable=creationCalls(safe,plan)[1];await safeCall(f,safe,enable.to,enable.data);
  assert.deepEqual((await safeModules(f.rpc,safe)).modules,[plan.proxy]);
});
