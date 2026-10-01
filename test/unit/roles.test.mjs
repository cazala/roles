import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { readFileSync } from 'node:fs';
import { decodeEvent, replay, roleKey, keyName } from '../../src/roles.js';
const abi = JSON.parse(readFileSync(new URL('../../config/roles-2.1.1.abi.json', import.meta.url)));
const key = roleKey('treasurer'), address = '0x' + '12'.repeat(20);
function event(name, values, n) {
  const spec = abi.find(e => e.type === 'event' && e.name === name);
  const args = Object.fromEntries(spec.inputs.map((p, i) => [p.name, values[i]]));
  return { address, topics: encodeEventTopics({ abi, eventName: name, args }), data: encodeAbiParameters(spec.inputs.filter(p => !p.indexed), values.filter((_, i) => !spec.inputs[i].indexed)), blockNumber: '0x1', logIndex: '0x' + n.toString(16), transactionIndex: '0x0', blockHash: 'block1', transactionHash: 'tx1' };
}
test('decode all permission events against viem, retaining dormant functions', () => {
  const logs = [event('AssignRoles', [address, [key], [true]], 0), event('ScopeTarget', [key, address], 1), event('ScopeFunction', [key, address, '0xa9059cbb', [{ parent: 0, paramType: 5, operator: 5, compValue: '0x' }, { parent: 0, paramType: 1, operator: 0, compValue: '0x' }], 0], 2), event('RevokeTarget', [key, address], 3)];
  const state = replay([...logs].reverse());
  assert.equal(state.roles[key].targets[address].clearance, 0);
  assert.equal(state.roles[key].targets[address].functions['0xa9059cbb'].conditions.length, 2);
  assert.equal(decodeEvent(logs[0]).args.memberOf[0], true);
  assert.throws(() => decodeEvent({ ...logs[0], data: logs[0].data + '00' }));
});
test('indexed setup and lossless role names', () => {
  const log = event('RolesModSetup', [address, address, address, address], 1);
  assert.equal(decodeEvent(log).args.owner, address);
  assert.equal(keyName(key), 'treasurer');
  assert.equal(keyName('0x' + 'ff'.repeat(32)), '0x' + 'ff'.repeat(32));
});
test('event signatures keep their onchain topics and indexed parameters', async () => {
  const { default: events } = await import('../../src/events.js');
  const { canonical } = await import('../../src/abicoder.js');
  const { keccakText } = await import('../../src/abi.js');
  const topic = (n) => { const e = events.find((x) => x.name === n); return keccakText(e.name + '(' + e.inputs.map(canonical).join(',') + ')'); };
  assert.equal(events.length, 22);
  assert.equal(topic('RolesModSetup'), '0x34d3b96a088381c6843a1f9d94d251afa88f83cc7a0d17fc23a7057506a3fc6d');
  assert.equal(topic('ScopeFunction'), '0x4f6c340456f64db31a3d003c1224ba1de058557b1cdf71f21ae48ce4a4f64f52');
  assert.equal(topic('AssignRoles'), '0x9f8368fa4ddcbd561efd7ad2a2174235bf5b840a73fb18f20db9705c11462498');
  assert.equal(topic('SetAllowance'), '0x63d7ec44a20b176da1d60d75259d264ee67b3d8213706afa71a28f69ed8ebece');
  assert.deepEqual(events.find((x) => x.name === 'RolesModSetup').inputs.map((p) => p.indexed), [true, true, true, false]);
});
