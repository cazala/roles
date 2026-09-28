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
