import test from 'node:test';
import assert from 'node:assert/strict';
import { toTree, flatten, accrued, words } from '../../src/conditions.js';
const flat = [{parent:0,paramType:5,operator:5,compValue:'0x'},{parent:0,paramType:1,operator:15,compValue:'0x'},{parent:0,paramType:0,operator:2,compValue:'0x'},{parent:2,paramType:1,operator:0,compValue:'0x'},{parent:2,paramType:1,operator:15,compValue:'0x'}];
test('condition BFS round trip and malformed-parent rejection', () => {
  assert.deepEqual(flatten(toTree(flat)),flat);
  assert.throws(() => toTree([{...flat[0],parent:1}]));
  assert.throws(() => toTree([flat[0],{...flat[1],parent:1}]));
  assert.match(words(flat[1], 'Recipient'), /equal to the avatar/);
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
