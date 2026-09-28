import { isHex } from './abi.js';
import { keyName } from './roles.js';
export const TYPES = ['None', 'Static', 'Dynamic', 'Tuple', 'Array', 'Calldata', 'AbiEncoded'];
export const OPERATORS = { 0: 'Pass', 1: 'And', 2: 'Or', 3: 'Nor', 5: 'Matches', 6: 'ArraySome', 7: 'ArrayEvery', 8: 'ArraySubset', 15: 'EqualToAvatar', 16: 'EqualTo', 17: 'GreaterThan', 18: 'LessThan', 19: 'SignedIntGreaterThan', 20: 'SignedIntLessThan', 21: 'Bitmask', 22: 'Custom', 28: 'WithinAllowance', 29: 'EtherWithinAllowance', 30: 'CallWithinAllowance' };
export function toTree(flat) {
  if (!Array.isArray(flat) || !flat.length) throw Error('Condition tree is empty.');
  const nodes = flat.map((n, i) => {
    if (!Number.isInteger(n.parent) || n.parent < 0 || n.parent > 255 || (i === 0 ? n.parent !== 0 : n.parent >= i || n.parent < flat[i - 1].parent)) throw Error('Conditions must use breadth-first parent indices.');
    if (!Number.isInteger(n.paramType) || !Number.isInteger(n.operator) || !isHex(n.compValue)) throw Error('Malformed condition node');
    return { ...n, index: i, parentNode: null, children: [] };
  });
  for (let i = 1; i < nodes.length; i++) {nodes[i].parentNode=nodes[nodes[i].parent];nodes[i].parentNode.children.push(nodes[i]);}
  return nodes[0];
}
export function flatten(root) {
  const queue = [{ node: root, parent: 0 }], flat = [], seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const { node, parent } = queue[i];
    if (seen.has(node) || parent > 255) throw Error('Cyclic condition tree or parent index exceeds uint8'); seen.add(node);
    flat.push({ parent, paramType: node.paramType, operator: node.operator, compValue: node.compValue || '0x' });
    for (const child of node.children || []) queue.push({ node: child, parent: i });
  }
  toTree(flat); return flat;
}
const size = value => isHex(value) ? (value.length-2)/2 : -1;
const sameType=(a,b)=>a.paramType===b.paramType&&a.children.length===b.children.length&&a.children.every((x,i)=>sameType(x,b.children[i]));
const typeTree=node=>[1,2,3].includes(node.operator)?typeTree(node.children[0]):{paramType:node.paramType,children:(node.paramType===4?node.children.slice(0,1):node.children).map(typeTree)};
const compatible=(left,right)=>sameType(typeTree(left),typeTree(right))||([5,6].includes(typeTree(left).paramType)&&typeTree(right).paramType===2);
export function validate(flat) {
  const root=toTree(flat),nodes=[];const walk=n=>{nodes.push(n);n.children.forEach(walk);};walk(root);
  for(const n of nodes) {const i=n.index;
    const bytes=size(n.compValue),op=n.operator,t=n.paramType,c=n.children.length;
    if(t<0||t>6)throw Error('Condition '+i+' has an unsupported parameter type.');
    if(op===0) {if(bytes!==0)throw Error('Pass condition '+i+' cannot have a comparison value.');}
    else if(op>=1&&op<=3) {if(t!==0||bytes!==0)throw Error('Logical condition '+i+' must use None and no comparison value.');}
    else if(op===5) {if(![3,4,5,6].includes(t)||bytes!==0)throw Error('Matches condition '+i+' has the wrong type or comparison value.');}
    else if([6,7,8].includes(op)) {if(t!==4||bytes!==0)throw Error('Array condition '+i+' must use Array and no comparison value.');}
    else if(op===15) {if(t!==1||bytes!==0)throw Error('EqualToAvatar condition '+i+' must use Static.');}
    else if(op===16) {if(![1,2,3,4].includes(t)||bytes<=0||bytes%32)throw Error('EqualTo condition '+i+' needs whole ABI words.');}
    else if([17,18,19,20].includes(op)) {if(t!==1||bytes!==32)throw Error('Numeric comparison '+i+' must use one static word.');}
    else if(op===21) {if(![1,2].includes(t)||bytes!==32)throw Error('Bitmask condition '+i+' must use one static or dynamic word.');}
    else if(op===22) {if(bytes!==32)throw Error('Custom condition '+i+' needs one word.');}
    else if(op===28) {if(t!==1||bytes!==32)throw Error('WithinAllowance condition '+i+' must use one static word.');}
    else if([29,30].includes(op)) {if(t!==0||bytes!==32)throw Error('Transaction allowance condition '+i+' must use None and one word.');}
    else throw Error('Condition '+i+' uses an unsupported operator.');
    if([29,30].includes(op)&&n.parentNode?.paramType!==5)throw Error('Transaction allowance condition '+i+' must be a child of Calldata.');
    if(t===0) {if([29,30].includes(op)?c!==0:[1,2,3].includes(op)&&c===0)throw Error('Condition '+i+' has the wrong child count.');}
    else if([1,2].includes(t)&&c)throw Error('Scalar condition '+i+' cannot have children.');
    else if([3,5,6].includes(t)&&!c)throw Error('Structured condition '+i+' needs children.');
    else if(t===4&&(!c||([6,7].includes(op)&&c!==1)||op===8&&c>256))throw Error('Array condition '+i+' has the wrong child count.');
    if((([1,2,3].includes(op))||t===4)&&c>1&&!n.children.slice(1).every(x=>compatible(n.children[0],x)))throw Error('Condition '+i+' has incompatible child type trees.');
  }
  if(typeTree(root).paramType!==5)throw Error('The resolved root type must be Calldata.');
  return root;
}
const integer = value => /^0x[0-9a-f]{64}$/i.test(value) ? BigInt(value).toString() : value;
export function words(node, name = 'Call data') {
  const key = () => keyName(node.compValue);
  const op = node.operator;
  if (op === 0) return name + ': any value';
  if (op === 1) return name + ': all of';
  if (op === 2) return name + ': one of';
  if (op === 5) return name + ': matches';
  if (op === 15) return name + ': equal to the avatar';
  if (op === 16) return name + ': equal to ' + node.compValue;
  if (op === 17 || op === 18) return name + (op === 17 ? ': greater than ' : ': less than ') + integer(node.compValue);
  if (op === 28) return name + ': within allowance ' + key();
  if (op === 29) return 'ETH value: within allowance ' + key();
  if (op === 30) return 'One call: within allowance ' + key();
  return name + ': ' + (OPERATORS[op] || 'operator ' + op) + ' (raw comparison ' + node.compValue + ')';
}
export function allowanceKeys(flat) { return [...new Set((flat || []).filter(n => [28,29,30].includes(n.operator)).map(n => n.compValue))]; }
const bound = (n, bits) => { n = BigInt(n); if (n < 0n || n >= 1n << BigInt(bits)) throw Error('Allowance arithmetic overflows uint' + bits); return n; };
export function accrued(a, now) {
  const balance = bound(a.balance,128), maxRefill = bound(a.maxRefill,128), refill = bound(a.refill,128), period = bound(a.period,64), timestamp = bound(a.timestamp,64);
  now = bound(now,64);
  if (period === 0n) return { balance, timestamp, next: null };
  const next = bound(timestamp + period,64);
  if (now < next) return { balance, timestamp, next };
  const intervals = (now - timestamp) / period;
  let updated = balance;
  if (balance < maxRefill) { updated = bound(balance + bound(refill * intervals,128),128); if (updated > maxRefill) updated = maxRefill; }
  const at = bound(timestamp + intervals * period,64);
  return { balance: updated, timestamp: at, next: bound(at + period,64) };
}
