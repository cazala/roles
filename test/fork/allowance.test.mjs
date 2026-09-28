import test from 'node:test';
import assert from 'node:assert/strict';
import { startFork, tx, ACCOUNTS } from './anvil.mjs';
import { deployRoles } from './fixture.mjs';
import { calldata, roleKey, read, signature } from '../../src/roles.js';
import { accrued } from '../../src/conditions.js';

test('allowance accounting matches member execution and discrete refill', { timeout: 120000 }, async () => {
  const f = await startFork();
  try {
    const fixture = await deployRoles(f), key = roleKey('treasurer'), allowance = roleKey('weekly');
    const send = (signature, args) => tx(f.rpc, ACCOUNTS[0], fixture.address, calldata(signature,args));
    await send('assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',[ACCOUNTS[1],[key],[true]]);
    await send('scopeTarget(bytes32 roleKey,address targetAddress)',[key,ACCOUNTS[2]]);
    await send('setAllowance(bytes32 key,uint128 balance,uint128 maxRefill,uint128 refill,uint64 period,uint64 timestamp)',[allowance,20n,100n,10n,60n,0n]);
    const selector='0x'+signature('spend(uint256 amount)').selector;
    await send('scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',[key,ACCOUNTS[2],selector,[[0n,5n,5n,'0x'],[0n,1n,28n,allowance]],0n]);
    const get = async () => { const [refill,maxRefill,period,balance,timestamp]=await read(f.rpc,fixture.address,'allowances(bytes32 key)',['uint128','uint128','uint64','uint128','uint64'],'latest',[allowance]); return {refill,maxRefill,period,balance,timestamp}; };
    const initial=await get();
    const execute=()=>tx(f.rpc,ACCOUNTS[1],fixture.address,calldata('execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert)',[ACCOUNTS[2],0n,calldata('spend(uint256 amount)',[7n]),0n,key,true]));
    await execute(); assert.equal((await get()).balance,13n);
    await f.rpc('evm_setNextBlockTimestamp',[Number(initial.timestamp+60n)]);
    const receipt=await execute(); const block=await f.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
    const expected=accrued({...initial,balance:13n},BigInt(block.timestamp));
    const actual=await get(); assert.equal(actual.balance,expected.balance-7n); assert.equal(actual.timestamp,expected.timestamp);
  } finally { f.stop(); }
});
