import { keccakText, isAddr, hex, utf8, bytes } from './abi.js';
import { canonical, parseAbi, encodeCall, encodeParameters, decodeParameters } from './abicoder.js';
import events from './events.js';
export const MASTER = '0xf2964ce6161ce0e75964fe7927ce114cb0b283d5';
export const FACTORY = '0x00000000000dc7f163742eb4abef650037b1f588';
export const MULTISEND = '0x9641d764fc13c8b624c04430c7356c1c7c8102e2';
export const SENTINEL = '0x0000000000000000000000000000000000000001';
const versions = { [MASTER]: '2.1.1', '0x9646fdad06d3e24444381f44362a3b0eb343d337': '2.1.0', '0x85388a8cd772b19a468f982dc264c238856939c9': '1.0.0', '0xd8dfc1d938d7d163c5231688341e9635e9011889': '1.1.0' };
export const quantity = n => '0x' + BigInt(n).toString(16);
export const signature = text => parseAbi(text)[0];
export const calldata = (text, values = []) => encodeCall(signature(text), values);
export async function read(request, to, fn, outputs, block = 'latest', args = []) {
  return decodeParameters(outputs.map(type => ({ type })), await request('eth_call', [{ to, data: calldata(fn, args) }, block]));
}
export async function identify(request, address, block = 'latest') {
  const code = (await request('eth_getCode', [address, block])).toLowerCase();
  const proxy = /^0x363d3d373d3d3d363d73([a-f0-9]{40})5af43d82803e903d91602b57fd5bf3$/.exec(code);
  const implementation = proxy ? '0x' + proxy[1] : address.toLowerCase();
  const version = versions[implementation] || null;
  return { address, code, implementation, proxy: !!proxy, version, supported: version === '2.1.1' && !!proxy, faulty: version === '2.1.0' };
}
export async function metadata(request, address, block) {
  const values = await Promise.all(['owner', 'avatar', 'target'].map(n => read(request, address, n + '()', ['address'], block)));
  return Object.fromEntries(['owner', 'avatar', 'target'].map((n, i) => [n, values[i][0]]));
}
export async function safeModules(request, address, block = 'latest') {
  const [version] = await read(request, address, 'VERSION()', ['string'], block);
  if (!/^1\.\d+\.\d+$/.test(version)) throw Error('Unrecognized Safe version');
  const [owners] = await read(request, address, 'getOwners()', ['address[]'], block);
  const [threshold] = await read(request, address, 'getThreshold()', ['uint256'], block);
  if (!owners.length || threshold < 1n || threshold > BigInt(owners.length)) throw Error('Invalid Safe owner configuration');
  let cursor = SENTINEL; const seen = new Set(), modules = [];
  for (let i = 0; i < 1000; i++) {
    if (seen.has(cursor)) throw Error('Repeated module pagination cursor'); seen.add(cursor);
    const [page, next] = await read(request, address, 'getModulesPaginated(address start,uint256 pageSize)', ['address[]', 'address'], block, [cursor, 50n]);
    if (page.length > 50 || page.some(a => !isAddr(a) || modules.includes(a))) throw Error('Invalid module page');
    modules.push(...page); if (next === SENTINEL) return { address, version, owners, threshold, modules };
    cursor = next;
  }
  throw Error('Too many module pages');
}
const byTopic = new Map(events.map(e => [keccakText(e.name + '(' + e.inputs.map(canonical).join(',') + ')'), e]));
export function decodeEvent(log) {
  const event = byTopic.get(log.topics[0]?.toLowerCase());
  if (!event) return { name: 'Unknown', args: {}, raw: log };
  const indexed = event.inputs.filter(p => p.indexed), plain = event.inputs.filter(p => !p.indexed);
  if (log.topics.length !== indexed.length + 1) throw Error('Invalid topics for ' + event.name);
  const values = decodeParameters(plain, log.data), args = {};
  for (let i = 0; i < plain.length; i++) args[plain[i].name] = values[i];
  for (let i = 0; i < indexed.length; i++) args[indexed[i].name] = decodeParameters([indexed[i]], log.topics[i + 1])[0];
  return { name: event.name, args, raw: log };
}
export const emptyState = () => ({ roles: {}, enabled: {}, defaults: {}, allowances: {}, unwrappers: {}, unknown: 0 });
export const role = (s, key) => s.roles[key] ||= { key, members: {}, targets: {} };
export const target = (s, key, address) => role(s, key).targets[address] ||= { address, clearance: 0, options: 0, functions: {} };
export function replay(logs, initial) {
  const state = initial ? structuredClone(initial) : emptyState(), seen = new Set();
  const ordered = [...logs].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.transactionIndex || 0) - BigInt(b.transactionIndex || 0)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  for (const log of ordered) {
    if (log.removed) throw Error('Removed log: refresh chain history');
    const id = log.blockHash + ':' + log.transactionHash + ':' + log.logIndex;
    if (seen.has(id)) continue; seen.add(id);
    const { name, args: a } = decodeEvent(log);
    if (name === 'RolesModSetup') Object.assign(state, { owner: a.owner, avatar: a.avatar, target: a.target });
    else if (name === 'OwnershipTransferred') state.owner = a.newOwner;
    else if (name === 'AvatarSet') state.avatar = a.newAvatar;
    else if (name === 'TargetSet') state.target = a.newTarget;
    else if (name === 'EnabledModule' || name === 'DisabledModule') state.enabled[a.module] = name === 'EnabledModule';
    else if (name === 'AssignRoles') {
      if (a.roleKeys.length !== a.memberOf.length) throw Error('Mismatched role membership arrays');
      a.roleKeys.forEach((key, i) => { role(state, key).members[a.module] = a.memberOf[i]; });
    } else if (name === 'SetDefaultRole') { state.defaults[a.module] = a.defaultRoleKey; role(state, a.defaultRoleKey); }
    else if (['AllowTarget', 'RevokeTarget', 'ScopeTarget'].includes(name)) Object.assign(target(state, a.roleKey, a.targetAddress), { clearance: name === 'AllowTarget' ? 1 : name === 'ScopeTarget' ? 2 : 0, options: Number(a.options || 0) });
    else if (['AllowFunction', 'RevokeFunction', 'ScopeFunction'].includes(name)) {
      const t = target(state, a.roleKey, a.targetAddress);
      if (name === 'RevokeFunction') delete t.functions[a.selector];
      else t.functions[a.selector] = { selector: a.selector, options: Number(a.options), conditions: a.conditions?.map(c => ({ parent: Number(c[0]), paramType: Number(c[1]), operator: Number(c[2]), compValue: c[3] })) || null };
    } else if (name === 'SetAllowance') state.allowances[a.allowanceKey] = a;
    else if (name === 'ConsumeAllowance') { if (state.allowances[a.allowanceKey]) state.allowances[a.allowanceKey].balance = a.newBalance; }
    else if (name === 'SetUnwrapAdapter') state.unwrappers[a.to + ':' + a.selector] = { to: a.to, selector: a.selector, adapter: a.adapter };
    else if (name === 'Unknown') state.unknown++;
  }
  return state;
}
export function roleKey(text) {
  if (/^0x[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase();
  const value = utf8(text); if (!value.length || value.length > 32 || text.includes('\0')) throw Error('Use 1–32 UTF-8 bytes or a bytes32 key.');
  return hex(value).padEnd(66, '0');
}
export function keyName(key) {
  try { const text = new TextDecoder('utf8', { fatal: true }).decode(bytes(key).filter((_, i, a) => i < (a.indexOf(0) < 0 ? a.length : a.indexOf(0)))); return text && roleKey(text) === key ? text : key; } catch { return key; }
}
export const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);
