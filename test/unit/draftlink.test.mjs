import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, check, apply } from '../../src/draftlink.js';
import { emptyState, roleKey } from '../../src/roles.js';
import { diff } from '../../src/diff.js';

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222', M = '0x3333333333333333333333333333333333333333';
const MOD = '0x2020f39b046e0e6ebd770fa75a1ad2b7a6b83ffd';
const plan = { v: 1, note: 'Weekly USDC approvals for the treasury bot', ops: [
  { op: 'allowance', key: 'weekly-usdc', balance: '1000000000', refill: '1000000000', period: 604800, maxRefill: '1000000000' },
  { op: 'member', role: 'treasury-ops', member: M, default: true },
  { op: 'target', role: 'treasury-ops', target: USDC, access: 'scoped' },
  { op: 'function', role: 'treasury-ops', target: USDC, signature: 'approve(address spender, uint256 amount)', conditions: { spender: { mode: 'oneof', values: [A, B] }, amount: { mode: 'allowance', value: 'weekly-usdc' } } },
] };

test('draft links: the plain encoding is pinned (frozen format)', async () => {
  const j = await encode({ v: 1, ops: [{ op: 'member', role: 'ops', member: M }] }, { plain: true });
  assert.equal(j, 'jeyJ2IjoxLCJvcHMiOlt7Im9wIjoibWVtYmVyIiwicm9sZSI6Im9wcyIsIm1lbWJlciI6IjB4MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyJ9XX0');
  assert.deepEqual(await decode(j), { v: 1, ops: [{ op: 'member', role: 'ops', member: M }] });
});

test('draft links: deflated round trip, and decode from a whole link', async () => {
  const z = await encode(plan);
  assert.equal(z[0], 'z');
  assert.deepEqual(await decode(z), plan);
  assert.deepEqual(await decode('https://roles.wei.limo/#/' + MOD + '?chain=1&draft=' + z), plan);
});

test('draft links: the plan becomes the same calls the editor would make', () => {
  const base = emptyState(), s = structuredClone(base);
  const said = apply(s, check(structuredClone(plan)));
  assert.equal(said.length, 5);
  const k = roleKey('treasury-ops');
  assert.equal(s.roles[k].members[M], true);
  assert.equal(s.defaults[M], k);
  assert.equal(s.roles[k].targets[USDC].clearance, 2);
  assert.equal(s.roles[k].targets[USDC].functions['0x095ea7b3'].conditions.length, 5); // root, OR of two spenders, amount within allowance
  const calls = diff(base, s, MOD).map((c) => c.signature.split('(')[0]);
  assert.deepEqual(calls.sort(), ['assignRoles', 'scopeFunction', 'scopeTarget', 'setAllowance', 'setDefaultRole'].sort());
  // Applying again changes nothing: each op states the end result.
  const again = structuredClone(s); apply(again, plan);
  assert.deepEqual(diff(s, again, MOD), []);
});

test('draft links: malformed plans are refused, naming the change', () => {
  assert.throws(() => check({ v: 2, ops: [] }), /version 2/);
  assert.throws(() => check({ v: 1, ops: [{ op: 'member', role: 'ops', member: 'nope' }] }), /Change 1: member must be a 0x address/);
  assert.throws(() => check({ v: 1, ops: [{ op: 'target', role: 'ops', target: USDC, access: 'scoped', extra: 1 }] }), /unknown field "extra"/);
  assert.throws(() => check({ v: 1, ops: [{ op: 'function', role: 'ops', target: USDC, selector: '0x095ea7b3', conditions: { spender: { mode: 'equal', value: A } } }] }), /need the signature/);
  assert.throws(() => check({ v: 1, ops: [{ op: 'function', role: 'ops', target: USDC, signature: 'approve(address,uint256)', selector: '0xa9059cbb' }] }), /does not match/);
  assert.throws(() => check({ v: 1, ops: [{ op: 'allowance', key: 'x', balance: '1.5' }] }), /whole number/);
  const s = emptyState();
  apply(s, check({ v: 1, ops: [{ op: 'target', role: 'ops', target: USDC, access: 'all' }] }));
  assert.throws(() => apply(s, check({ v: 1, ops: [{ op: 'function', role: 'ops', target: USDC, signature: 'transfer(address,uint256)' }] })), /allows every function/);
});
