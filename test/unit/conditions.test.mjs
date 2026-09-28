import test from 'node:test';
import assert from 'node:assert/strict';
import { toTree, flatten, accrued, words, validate } from '../../src/conditions.js';
import { buildConditions, conditionFields } from '../../src/condition-builder.js';
import { parseAbi } from '../../src/abicoder.js';
const flat = [{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:1,operator:15,compValue:'0x'},{parent:0,paramType:0,operator:2,compValue:'0x'},{parent:2,paramType:1,operator:0,compValue:'0x'},{parent:2,paramType:1,operator:15,compValue:'0x'}];
test('condition BFS round trip and malformed-parent rejection', () => {
  assert.deepEqual(flatten(toTree(flat)),flat);
  assert.throws(() => toTree([{...flat[0],parent:1}]));
  assert.throws(() => toTree([flat[0],{...flat[1],parent:1}]));
  assert.match(words(flat[1], 'Recipient'), /equal to the avatar/);
});
test('integrity validation and ABI-derived nested, dynamic and fixed-array tree',()=>{
  const [fn]=parseAbi('complex((address who,uint256 amount) info,bytes memo,uint256[] amounts,address[2] recipients)');
  assert.deepEqual(conditionFields(fn).map(x=>x.path),['info.who','info.amount','memo','amounts[]','recipients[0]','recipients[1]']);
  const conditions=buildConditions(fn,{
    'info.who':{mode:'avatar'},'info.amount':{mode:'between',value:'1',second:'10'},memo:{mode:'equal',value:'0x1234'},'amounts[]':{mode:'greater',value:'0'},'recipients[1]':{mode:'equal',value:'0x4444444444444444444444444444444444444444'}
  },{call:'daily'});
  assert.doesNotThrow(()=>validate(conditions));
  assert.ok(conditions.some(x=>x.paramType===4&&x.operator===7));
  assert.ok(conditions.some(x=>x.paramType===3&&x.operator===5));
  assert.ok(conditions.some(x=>x.paramType===0&&x.operator===1));
  assert.ok(conditions.some(x=>x.paramType===0&&x.operator===30));
  assert.throws(()=>validate([{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:1,operator:16,compValue:'0x'}]),/whole ABI words/);
  assert.throws(()=>validate([{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:0,operator:1,compValue:'0x'}]),/child count/);
});
test('allowance boundaries, cap, no refill, excess balance and overflow', () => {
  const a={refill:10n,maxRefill:100n,period:60n,balance:25n,timestamp:1000n};
  assert.equal(accrued(a,1059n).balance,25n);
  assert.equal(accrued(a,1060n).balance,35n);
  assert.equal(accrued(a,2000n).balance,100n);
  assert.equal(accrued({...a,balance:120n},2000n).balance,120n);
  assert.equal(accrued({...a,period:0n},2000n).next,null);
  assert.equal(accrued(a,990n).timestamp,1000n);
  assert.throws(()=>accrued({...a,refill:(1n<<128n)-1n},2000n), /overflows/);
});
