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
test('stored conditions read back into editor fields, and rebuild unchanged', async () => {
  const { readConditions } = await import('../../src/condition-builder.js');
  const [fn]=parseAbi('approve(address spender,uint256 amount)');
  const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',C='0x3333333333333333333333333333333333333333';
  for (const configs of [
    {spender:{mode:'oneof',values:[A,B,C]},amount:{mode:'pass'}},
    {spender:{mode:'equal',value:A},amount:{mode:'between',value:'5',second:'1000'}},
    {spender:{mode:'avatar'},amount:{mode:'less',value:'1500000000000000000'}},
    {spender:{mode:'pass'},amount:{mode:'allowance',value:'daily'}},
  ]) {
    const flat=buildConditions(fn,configs,{ether:'eth-limit'});
    const read=readConditions(fn,flat);
    assert.deepEqual(read.configs,configs);
    assert.equal(read.extras.ether,'eth-limit');
    assert.deepEqual(buildConditions(fn,read.configs,read.extras),flat);
  }
});
test('conditions the editor cannot express are kept exactly as stored', async () => {
  const { readConditions } = await import('../../src/condition-builder.js');
  const [fn]=parseAbi('approve(address spender,uint256 amount)');
  // amount matches a bitmask (21): not editable here, so it is kept verbatim while spender is edited.
  const mask={parent:1,paramType:1,operator:21,compValue:'0x'+'00'.repeat(31)+'ff'};
  const flat=[{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:1,operator:15,compValue:'0x'},{...mask,parent:0}];
  const read=readConditions(fn,flat);
  assert.deepEqual(read.kept,['amount']);
  assert.deepEqual(buildConditions(fn,read.configs),flat);
  const edited=buildConditions(fn,{...read.configs,spender:{mode:'pass'}});
  assert.deepEqual(edited[2],flat[2]);
  assert.equal(edited[1].operator,0);
  // A root the editor does not build (an OR of two Matches) is unreadable as a whole.
  assert.equal(readConditions(fn,[{parent:0,paramType:0,operator:2,compValue:'0x'}]).unreadable,true);
});
