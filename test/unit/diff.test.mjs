import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, SIG } from '../../src/diff.js';
import { emptyState, role, target, roleKey } from '../../src/roles.js';

const modifier = '0x' + '11'.repeat(20);
const member = '0x' + '22'.repeat(20);
const destination = '0x' + '33'.repeat(20);
const nextOwner = '0x' + '44'.repeat(20);
const key = roleKey('treasurer');
const allowance = roleKey('weekly');

test('diff orders allowances, targets, functions, membership, defaults and ownership', () => {
  const base = Object.assign(emptyState(), { owner: member, avatar: member, target: member });
  const draft = structuredClone(base);
  draft.allowances[allowance] = { balance: 10n, maxRefill: 100n, refill: 10n, period: 60n, timestamp: 0n };
  const permission = target(draft, key, destination);
  permission.clearance = 2;
  permission.functions['0x12345678'] = {
    selector: '0x12345678', options: 0,
    conditions: [{ parent: 0, paramType: 5, operator: 5, compValue: '0x' }],
  };
  role(draft, key).members[member] = true;
  draft.defaults[member] = key;
  draft.owner = nextOwner;
  const calls = diff(base, draft, modifier);
  assert.deepEqual(calls.map(c => c.signature), [
    SIG.allowance, SIG.scopeTarget, SIG.scopeFunction, SIG.member, SIG.default, SIG.owner,
  ]);
  assert.equal(calls.at(-1).danger, true);
});

test('target revoke keeps dormant functions and reactivation is marked dangerous', () => {
  const base = emptyState(), draft = emptyState();
  const before = target(base, key, destination);
  before.functions['0x12345678'] = { selector: '0x12345678', options: 0, conditions: null };
  const after = target(draft, key, destination);
  after.functions = structuredClone(before.functions);
  after.clearance = 2;
  const calls = diff(base, draft, modifier);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signature, SIG.scopeTarget);
  assert.equal(calls[0].danger, true);
});

test('identical states produce no calls', () => {
  const state = Object.assign(emptyState(), { owner: member, avatar: member, target: member });
  assert.deepEqual(diff(state, structuredClone(state), modifier), []);
});
