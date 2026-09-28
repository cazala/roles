import { isHex } from './abi.js';
import { keyName } from './roles.js';
export const TYPES = ['None', 'Static', 'Dynamic', 'Tuple', 'Array', 'Calldata', 'AbiEncoded'];
export const OPERATORS = { 0: 'Pass', 1: 'And', 2: 'Or', 3: 'Nor', 5: 'Matches', 6: 'ArraySome', 7: 'ArrayEvery', 8: 'ArraySubset', 15: 'EqualToAvatar', 16: 'EqualTo', 17: 'GreaterThan', 18: 'LessThan', 19: 'SignedIntGreaterThan', 20: 'SignedIntLessThan', 21: 'Bitmask', 22: 'Custom', 28: 'WithinAllowance', 29: 'EtherWithinAllowance', 30: 'CallWithinAllowance' };
export function toTree(flat) {
  if (!Array.isArray(flat) || !flat.length || flat.length > 4096) throw Error('Condition tree is empty or too large to display.');
  const nodes = flat.map((n, i) => {
    if (!Number.isInteger(n.parent) || n.parent < 0 || n.parent > 255 || (i === 0 ? n.parent !== 0 : n.parent >= i || n.parent < flat[i - 1].parent)) throw Error('Conditions must use breadth-first parent indices.');
    if (!Number.isInteger(n.paramType) || !Number.isInteger(n.operator) || !isHex(n.compValue)) throw Error('Malformed condition node');
    return { ...n, children: [] };
  });
  for (let i = 1; i < nodes.length; i++) nodes[nodes[i].parent].children.push(nodes[i]);
  return nodes[0];
}
export function flatten(root) {
  const queue = [{ node: root, parent: 0 }], flat = [], seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const { node, parent } = queue[i];
    if (seen.has(node) || parent > 255 || queue.length > 4096) throw Error('Cyclic or oversized condition tree'); seen.add(node);
    flat.push({ parent, paramType: node.paramType, operator: node.operator, compValue: node.compValue || '0x' });
    for (const child of node.children || []) queue.push({ node: child, parent: i });
  }
  toTree(flat); return flat;
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
