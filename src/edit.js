import { $, h, put, addr, bad, warn, act, sheet, copyButton } from './ui.js';
import { session } from './app.js';
import { roleView, body as readBody } from './views.js';
import { diff, SIG } from './diff.js';
import { roleKey, keyName, role, target, json, signature, decodeEvent, replay, quantity, metadata } from './roles.js';
import { isAddr, ZERO } from './abi.js';
import { parseValue } from './abicoder.js';
import { proposal, gateway } from './handoff.js';
import { load, store } from './store.js';
import { allowanceView } from './condition-view.js';
export const drafts = new Map();
export const editorHooks = {};
const id = ctx => ctx.chain + ':' + ctx.address;
export function draft(ctx) {
  let d = drafts.get(id(ctx));
  if (!d) { d={ base:structuredClone(ctx.state), value:structuredClone(ctx.state), block:Number(BigInt(ctx.snapshot.number)), history:[] }; drafts.set(id(ctx),d); }
  return d;
}
const checkAddress = text => { if(!isAddr(text.trim()) || text.toLowerCase()===ZERO)throw Error('Enter a nonzero 0x address.');return text.trim().toLowerCase(); };
const selector = text => /^0x[0-9a-fA-F]{8}$/.test(text)?text.toLowerCase():'0x'+signature(text).selector;
export function mutate(ctx, fn) { const d=draft(ctx), next=structuredClone(d.value);fn(next);diff(d.base,next,ctx.address);d.history.push(d.value);d.value=next;ctx.redraw(); }
export function form(title, fields, submit) {
  const {body,close}=sheet('edit',title,true), out=h('div'), controls={};
  for(const f of fields) {
    const input=f.options?h('select',{'aria-label':f.label},f.options.map(([value,text])=>h('option',{value},text))):h(f.multiline?'textarea':'input',{'aria-label':f.label,spellcheck:'false',autocomplete:'off'});
    if(f.value!=null)input.value=String(f.value);
    controls[f.key]=input;
    body.append(h('label',f.label),input);
    if (f.hint) body.append(h('p.fhint',f.hint));
  }
  const save=h('button.primary','Add to pending changes');save.onclick=act(save,async()=>{await submit(Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value])));close();},out);
  body.append(out,h('div.actions',h('button',{onclick:close},'Cancel'),save));
  Object.values(controls)[0]?.focus();
}
const opOptions=[[0,'CALL, no ETH'],[1,'CALL with ETH'],[2,'CALL or DELEGATECALL, no ETH'],[3,'CALL or DELEGATECALL with ETH']];
export function memberForm(ctx,key,member='') {
  form('Role membership',[{key:'member',label:'Member address',value:member},{key:'mode',label:'Membership',options:[['add','Add member'],['remove','Remove member'],['default','Set as default role']]}],v=>mutate(ctx,s=>{const a=checkAddress(v.member);if(v.mode==='default')s.defaults[a]=key;else {role(s,key).members[a]=v.mode==='add';s.enabled[a]=true;}}));
}
export function targetForm(ctx,key,address='') {
  const t=draft(ctx).value.roles[key]?.targets[address];
  form('Target permission',[{key:'address',label:'Target address',value:address},{key:'mode',label:'Access',value:t?.clearance??2,options:[[2,'Only configured functions'],[1,'All functions'],[0,'Revoke target']]},{key:'options',label:'Execution options',value:t?.options??0,options:opOptions}],v=>mutate(ctx,s=>{const t=target(s,key,checkAddress(v.address));t.clearance=Number(v.mode);t.options=t.clearance===1?Number(v.options):0;}));
}
export function functionForm(ctx,key,address='',select='') {
  const existing=draft(ctx).value.roles[key]?.targets[address]?.functions[select];
  form('Function permission',[{key:'address',label:'Target address',value:address},{key:'selector',label:'Function signature or selector',value:select,hint:'For example transfer(address recipient,uint256 amount).'},{key:'mode',label:'Parameter permission',options:[['allow','Allow any parameters'],['revoke','Revoke function']]},{key:'options',label:'Execution options',value:existing?.options??0,options:opOptions}],v=>mutate(ctx,s=>{const a=checkAddress(v.address), sel=selector(v.selector),t=target(s,key,a);if(v.mode==='revoke')delete t.functions[sel];else {if(t.clearance!==2)throw Error('Set this target to “Only configured functions” before adding a function.');t.functions[sel]={selector:sel,options:Number(v.options),conditions:null};}}));
}
function allowanceForm(ctx,key='') {
  const a=draft(ctx).value.allowances[key]||{};
  form('Set allowance',[{key:'key',label:'Allowance name or bytes32 key',value:key?keyName(key):''},...['balance','maxRefill','refill','period','timestamp'].map(k=>({key:k,label:({balance:'Balance (base units)',maxRefill:'Maximum refill balance',refill:'Refill amount',period:'Period (seconds)',timestamp:'Last refill timestamp'})[k],value:a[k]??0,hint:k==='maxRefill'?'Zero means unlimited refill ceiling.':k==='timestamp'?'Zero uses the execution block timestamp.':k==='period'?'Zero creates a one-time allowance.':null}))],v=>mutate(ctx,s=>{const key=roleKey(v.key),a={allowanceKey:key};for(const k of ['balance','maxRefill','refill','period','timestamp'])a[k]=parseValue({type:k==='period'||k==='timestamp'?'uint64':'uint128'},v[k]);s.allowances[key]=a;}));
}
function settings(ctx) {
  const d=draft(ctx);
  form('Modifier settings',['owner','avatar','target'].map(k=>({key:k,label:k[0].toUpperCase()+k.slice(1)+' address',value:d.value[k],hint:k==='owner'?'This address can change every permission. Ownership transfer executes last.':null})),v=>mutate(ctx,s=>{for(const k of ['owner','avatar','target'])s[k]=checkAddress(v[k]);}));
}
function unwrapForm(ctx) {
  form('Transaction unwrapper',[{key:'to',label:'Batch target address'},{key:'selector',label:'Batch function signature or selector'},{key:'adapter',label:'Adapter address',hint:'Use the zero address to remove an adapter.'}],v=>mutate(ctx,s=>{const to=checkAddress(v.to),sel=selector(v.selector);if(!isAddr(v.adapter))throw Error('Invalid adapter address');s.unwrappers[to+':'+sel]={to,selector:sel,adapter:v.adapter.toLowerCase()};}));
}
const configurationEvents = new Set(['RolesModSetup','OwnershipTransferred','AvatarSet','TargetSet','EnabledModule','DisabledModule','AssignRoles','SetDefaultRole','AllowTarget','RevokeTarget','ScopeTarget','AllowFunction','RevokeFunction','ScopeFunction','SetAllowance','SetUnwrapAdapter']);
export async function preflight(ctx,d) {
  if (!ctx.complete) throw Error('Complete history is required.');
  const latest=Number(BigInt(await ctx.request('eth_blockNumber')));
  for(let from=d.block+1;from<=latest;from+=5000){const logs=await ctx.request('eth_getLogs',[{address:ctx.address,fromBlock:quantity(from),toBlock:quantity(Math.min(latest,from+4999))}]);if(logs.some(l=>configurationEvents.has(decodeEvent(l).name)))throw Error('Configuration changed onchain. Discard this draft and refresh before applying.');}
  const meta=await metadata(ctx.request,ctx.address,'latest');
  if(['owner','avatar','target'].some(k=>meta[k]!==d.base[k]))throw Error('Modifier configuration changed. Refresh first.');
  if(!session.account)throw Error('Connect your wallet first.');
}
export async function directApply(ctx,d,status) {
  const account=session.account;
  for (;;) {
    const calls=diff(d.base,d.value,ctx.address);if(!calls.length)break;
    if(d.base.owner!==account)throw Error('The connected wallet is no longer the modifier owner.');
    await preflight(ctx,d); const c=calls[0];
    await ctx.request('eth_call',[{from:account,to:c.to,data:c.data},'latest']);
    const hash=await ctx.request('eth_sendTransaction',[{from:account,to:c.to,data:c.data,value:'0x0'}]);
    status('Waiting for '+hash);let receipt;
    for(let attempt=0;attempt<120;attempt++){receipt=await ctx.request('eth_getTransactionReceipt',[hash]);if(receipt)break;await new Promise(r=>setTimeout(r,1000));}
    if(!receipt)throw Error('Receipt is still pending. Refresh before sending again.');
    if(receipt.status!=='0x1')throw Error('Transaction reverted. Remaining changes are preserved.');
    const previousBlock=d.block;
    d.base=replay(receipt.logs.filter(l=>l.address.toLowerCase()===ctx.address),d.base);
    if(c.signature===SIG.allowance)d.value.allowances[c.args[0]]=structuredClone(d.base.allowances[c.args[0]]);
    // Any other configuration transaction between our baseline and this receipt invalidates the draft.
    for(let from=previousBlock+1;from<=Number(BigInt(receipt.blockNumber));from+=5000){const logs=await ctx.request('eth_getLogs',[{address:ctx.address,fromBlock:quantity(from),toBlock:quantity(Math.min(Number(BigInt(receipt.blockNumber)),from+4999))}]);if(logs.some(l=>l.transactionHash!==hash && configurationEvents.has(decodeEvent(l).name)))throw Error('Another configuration transaction executed. Refresh the remaining draft.');}
    d.block=Number(BigInt(receipt.blockNumber));d.history=[];status('Confirmed '+hash+' · '+diff(d.base,d.value,ctx.address).length+' changes remaining');
  }
}
export function review(ctx) {
  const d=draft(ctx),calls=diff(d.base,d.value,ctx.address),{body,close}=sheet('shield','Review changes',true),out=h('div');
  body.classList.add('fulladdr');
  put(body,h('p','Modifier ',addr(ctx.address), ' · Chain '+ctx.chain),calls.map(c=>h('div.panel',h('b',c.text),c.danger&&warn('This changes access to the Safe’s assets. Review every address and parameter.'),h('pre',json(c.args)),h('details',h('summary','Calldata and signature'),h('code',c.signature),h('pre',c.data)))));
  if(!calls.length){body.append(h('p','No onchain changes.'));return;}
  const direct=d.base.owner===session.account, supported=direct||ctx.ownerSafe;
  if(!supported){body.append(warn('This modifier owner is neither the connected wallet nor a readable Safe. Review the calls above, then use a tool that can act for '+d.base.owner+'.'));return;}
  const gatewayInput=h('input',{'aria-label':'safe.wei gateway',value:load('gateway','https://safe.wei.limo/')});
  const nonce=h('input',{'aria-label':'Safe nonce',placeholder:'Current Safe nonce',inputmode:'numeric'});
  const apply=h('button.primary',direct?'Apply changes':'Prepare safe.wei link');
  let running=false;
  apply.onclick=act(apply,async()=>{
    if(running)return;running=true;
    try {
      await preflight(ctx,d);
      if(direct) {await directApply(ctx,d,text=>put(out,h('p',text)));drafts.delete(id(ctx));close();ctx.refresh();}
      else {const base=gateway(gatewayInput.value);const result=await proposal(ctx.request,ctx.chain,d.base.owner,calls,base,nonce.value);store('gateway',base);apply.classList.remove('primary');put(out,h('p','Send this link to the owners. Execution happens in safe.wei.'),h('a.btn.primary',{href:result.url,target:'_blank',rel:'noopener'},'Open in safe.wei to approve'),copyButton('Copy link',result.url));}
    } finally {running=false;}
  },out);
  if (!direct) body.append(h('details',h('summary','Safe hand-off options'),h('label','safe.wei gateway'),gatewayInput,h('label','Safe nonce (current or later)'),nonce));
  body.append(h('div.actions',apply),out);
}
export function editBody(ctx,path) {
  if(!ctx.complete||ctx.info.faulty)return null;
  const d=draft(ctx),root=h('div');
  ctx.redraw=()=>{
    const calls=diff(d.base,d.value,ctx.address);
    put($('batch'),calls.length > 0 && h('button',{onclick:()=>review(ctx)},calls.length+' changes'));
    const toolbar=calls.length?h('div.actions',h('button.primary',{onclick:()=>review(ctx)},'Review changes ('+calls.length+')'),d.history.length>0&&h('button',{onclick:()=>{d.value=d.history.pop();ctx.redraw();}},'Undo'),h('button.link',{onclick:()=>{drafts.delete(id(ctx));put($('batch'));ctx.refresh();}},'Discard draft')):null;
    const stateCtx={...ctx,state:d.value};
    if(path[0]==='role') {
      const key=path[1],member=d.value.roles[key]?.members[session.account]&&d.value.enabled[session.account];put(root,toolbar,roleView(stateCtx,key),h('div.actions',member&&editorHooks.use&&h('button.primary',{onclick:()=>editorHooks.use(ctx,key)},'Use this role'),h('button',{onclick:()=>memberForm(ctx,key)},'Edit members'),h('button',{onclick:()=>targetForm(ctx,key)},'Edit target'),h('button',{onclick:()=>functionForm(ctx,key)},'Edit function'),editorHooks.conditions&&h('button',{onclick:()=>editorHooks.conditions(ctx,key)},'Edit conditions')));
    } else if(path[0]==='allowances')put(root,toolbar,allowanceView(stateCtx),h('button',{onclick:()=>allowanceForm(ctx)},'Set allowance'),Object.keys(d.value.allowances).map(key=>h('div.actions',h('button.link',{onclick:()=>allowanceForm(ctx,key)},'Edit '+keyName(key)))));
    else {const roles=Object.values(d.value.roles);put(root,toolbar,h('h2','Roles'),roles.length?h('div.slist',roles.map(r=>h('a.srow',{href:'#/'+ctx.address+'/role/'+r.key},h('b',keyName(r.key)),h('span.mut',Object.values(r.members).filter(Boolean).length+' members · '+Object.values(r.targets).filter(t=>t.clearance).length+' targets')))):h('p.empty','No roles configured yet. Choose New role to start.'),h('div.actions',h('button',{onclick:()=>form('New role',[{key:'key',label:'Role name or bytes32 key'}],v=>{const key=roleKey(v.key);mutate(ctx,s=>role(s,key));location.hash='/'+ctx.address+'/role/'+key;})},'New role')),h('details',h('summary','Modifier settings'),h('div.actions',h('button',{onclick:()=>settings(ctx)},'Owner, avatar and target'),h('button',{onclick:()=>unwrapForm(ctx)},'Transaction unwrapper'))));}
  };
  ctx.redraw(); return root;
}
