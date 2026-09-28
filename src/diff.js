import { calldata, json, keyName } from './roles.js';
export const SIG = {
  member:'assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',
  default:'setDefaultRole(address module,bytes32 roleKey)',
  allowTarget:'allowTarget(bytes32 roleKey,address targetAddress,uint8 options)',
  scopeTarget:'scopeTarget(bytes32 roleKey,address targetAddress)',
  revokeTarget:'revokeTarget(bytes32 roleKey,address targetAddress)',
  allowFunction:'allowFunction(bytes32 roleKey,address targetAddress,bytes4 selector,uint8 options)',
  scopeFunction:'scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',
  revokeFunction:'revokeFunction(bytes32 roleKey,address targetAddress,bytes4 selector)',
  allowance:'setAllowance(bytes32 key,uint128 balance,uint128 maxRefill,uint128 refill,uint64 period,uint64 timestamp)',
  unwrap:'setTransactionUnwrapper(address to,bytes4 selector,address adapter)',
  avatar:'setAvatar(address avatar)', target:'setTarget(address target)', owner:'transferOwnership(address newOwner)',
};
const sorted = (...maps) => [...new Set(maps.flatMap(m => Object.keys(m || {})))].sort();
const eq = (a,b) => json(a) === json(b);
const fnState = f => f ? [f.options, f.conditions] : null;
export function diff(base, draft, modifier) {
  const calls = [];
  const add = (kind, args, text, danger = false) => calls.push({ to:modifier,value:0n,signature:SIG[kind],data:calldata(SIG[kind],args),args,text,danger });
  for (const key of sorted(draft.allowances)) {
    const a=draft.allowances[key], b=base.allowances[key];
    const fields=['balance','maxRefill','refill','period','timestamp'];
    if (!b || fields.some(k=>String(a[k])!==String(b[k]))) add('allowance',[key,...fields.map(k=>BigInt(a[k]))],'Set allowance '+keyName(key));
  }
  for (const key of sorted(base.roles,draft.roles)) {
    const a=base.roles[key] || {members:{},targets:{}}, b=draft.roles[key] || {members:{},targets:{}};
    for (const address of sorted(a.targets,b.targets)) {
      const x=a.targets[address] || {clearance:0,options:0,functions:{}}, y=b.targets[address] || {clearance:0,options:0,functions:{}};
      if (x.clearance!==y.clearance || x.options!==y.options) {
        const kind=y.clearance===1?'allowTarget':y.clearance===2?'scopeTarget':'revokeTarget';
        add(kind,[key,address,...(y.clearance===1?[BigInt(y.options)]:[])],(y.clearance===1?'Allow every function':y.clearance===2?'Use stored function permissions':'Revoke target')+' for '+keyName(key)+' on '+address,y.clearance===1 || y.options>=2 || y.clearance===2 && x.clearance!==2 && Object.keys(y.functions).length>0);
      }
      for (const selector of sorted(x.functions,y.functions)) {
        const before=x.functions[selector], after=y.functions[selector];
        if (eq(fnState(before),fnState(after))) continue;
        const kind=!after?'revokeFunction':after.conditions?'scopeFunction':'allowFunction';
        add(kind,[key,address,selector,...(!after?[]:after.conditions?[after.conditions.map(c=>[BigInt(c.parent),BigInt(c.paramType),BigInt(c.operator),c.compValue]),BigInt(after.options)]:[BigInt(after.options)])],(!after?'Revoke ':after.conditions?'Set conditions for ':'Allow any parameters for ')+selector+' on '+address+' for '+keyName(key),!!after && (!after.conditions || after.options>=2));
      }
    }
  }
  const members = sorted(...Object.values(base.roles).map(r=>r.members),...Object.values(draft.roles).map(r=>r.members));
  for (const member of members) {
    const keys=sorted(base.roles,draft.roles).filter(key=>!!base.roles[key]?.members[member]!==!!draft.roles[key]?.members[member]);
    if(keys.length) add('member',[member,keys,keys.map(key=>!!draft.roles[key]?.members[member])],'Change membership for '+member);
  }
  for (const member of sorted(draft.defaults)) if(base.defaults[member]!==draft.defaults[member]) add('default',[member,draft.defaults[member]],'Set default role for '+member);
  for (const key of sorted(draft.unwrappers)) if(!eq(base.unwrappers[key],draft.unwrappers[key])) {const a=draft.unwrappers[key];add('unwrap',[a.to,a.selector,a.adapter],'Set transaction unwrapper for '+a.to,true);}
  for (const field of ['avatar','target','owner']) if(draft[field]!==base[field]) add(field,[draft[field]],'Change '+field+' to '+draft[field],true);
  return calls;
}
