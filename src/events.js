// The Roles 2.1.1 events, as signatures (a * after a name marks an indexed parameter), parsed once at load into
// { name, inputs: [{ name, type, components, indexed }] } for decodeEvent. test/unit/roles.test.mjs pins their topics.
import { parseAbi } from './abicoder.js';
const SIGS = `AllowFunction(bytes32 roleKey,address targetAddress,bytes4 selector,uint8 options)
AllowTarget(bytes32 roleKey,address targetAddress,uint8 options)
AssignRoles(address module,bytes32[] roleKeys,bool[] memberOf)
AvatarSet(address previousAvatar*,address newAvatar*)
ConsumeAllowance(bytes32 allowanceKey,uint128 consumed,uint128 newBalance)
DisabledModule(address module)
EnabledModule(address module)
ExecutionFromModuleFailure(address module*)
ExecutionFromModuleSuccess(address module*)
HashExecuted(bytes32)
HashInvalidated(bytes32)
Initialized(uint64 version)
OwnershipTransferred(address previousOwner*,address newOwner*)
RevokeFunction(bytes32 roleKey,address targetAddress,bytes4 selector)
RevokeTarget(bytes32 roleKey,address targetAddress)
RolesModSetup(address initiator*,address owner*,address avatar*,address target)
ScopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)
ScopeTarget(bytes32 roleKey,address targetAddress)
SetAllowance(bytes32 allowanceKey,uint128 balance,uint128 maxRefill,uint128 refill,uint64 period,uint64 timestamp)
SetDefaultRole(address module,bytes32 defaultRoleKey)
SetUnwrapAdapter(address to,bytes4 selector,address adapter)
TargetSet(address previousTarget*,address newTarget*)`;
export default SIGS.split('\n').map((line) => {
  const indexed = new Set([...line.matchAll(/(\w+)\*/g)].map((m) => m[1]));
  const [f] = parseAbi(line.replace(/\*/g, ''));
  return { name: f.name, inputs: f.inputs.map((p) => ({ ...p, indexed: indexed.has(p.name) })) };
});
