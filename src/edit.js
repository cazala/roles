import { $, h, put, addr, bad, warn, act, sheet, copyButton, short, friendlyError, toClipboard, infoLabel } from './ui.js';
import * as labels from './labels.js';
import { KNOWN_IDS, label } from './chains.js';
import { parseAbi } from './abicoder.js';
import { session } from './app.js';
import { roleView, body as readBody } from './views.js';
import { namesFor } from './role-view.js';
import { diff, SIG } from './diff.js';
import { roleKey, keyName, role, target, json, signature, decodeEvent, replay, quantity, metadata } from './roles.js';
import { isAddr, ZERO } from './abi.js';
import { parseValue } from './abicoder.js';
import { proposal, gateway } from './handoff.js';
import { load, store } from './store.js';
import { allowancesView } from './allowances.js';
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
/**
 * An address input that suggests your labelled addresses: all of them on focus (the list scrolls past a few),
 * filtered by label or address as you type; arrows and Enter pick one. `list()` gives [address, label] pairs.
 */
function suggest(input,list) {
  const box=h('div.suggest',{hidden:true,role:'listbox'});let rows=[],at=-1;
  const pick=a=>{input.value=a;box.hidden=true;input.dispatchEvent(new Event('input'));};
  const draw=()=>{
    const q=input.value.trim().toLowerCase(),all=list();
    const found=all.filter(([a,l])=>!q||l.toLowerCase().includes(q)||a.includes(q)).sort((x,y)=>x[1].localeCompare(y[1]));
    rows=found.slice(0,100);at=-1;
    put(box,rows.map(([a,l],i)=>h('button.sopt',{type:'button',role:'option',onpointerdown:e=>e.preventDefault(),onclick:()=>pick(a)},h('b',l),h('code',short(a)))),found.length>rows.length&&h('p.mut.small',(found.length-rows.length)+' more: type to filter'),!rows.length&&all.length>0&&q&&h('p.mut.small','No label matches. Paste the 0x address.'));
    box.hidden=!rows.length||(isAddr(input.value.trim())&&rows.some(([a])=>a===input.value.trim().toLowerCase()));
  };
  const move=d=>{if(!rows.length)return;at=(at+d+rows.length)%rows.length;box.querySelectorAll('.sopt').forEach((b,i)=>b.classList.toggle('on',i===at));box.querySelectorAll('.sopt')[at].scrollIntoView({block:'nearest'});};
  input.addEventListener('focus',draw);input.addEventListener('input',draw);
  input.addEventListener('blur',()=>setTimeout(()=>box.hidden=true,100));
  input.addEventListener('keydown',e=>{if(box.hidden)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();move(e.key==='ArrowDown'?1:-1);}else if(e.key==='Enter'&&at>=0){e.preventDefault();pick(rows[at][0]);}else if(e.key==='Escape'){e.stopPropagation();e.preventDefault();box.hidden=true;}});
  const named=h('p.fhint.picked');
  input.addEventListener('input',()=>put(named,labels.get(input.value.trim())&&['Your label: ',h('b',labels.get(input.value.trim()))]));
  input.placeholder='0x… or search your labels';
  return h('div.combo',input,box,named);
}
/** Your labelled addresses as [address, label], leaving out `skip` (addresses already there). */
const labelled=skip=>Object.entries(labels.all()).filter(([a])=>isAddr(a)&&!skip.includes(a));
export { OPTIONS_HINT };
export function form(title, fields, submit) {
  const {body,close}=sheet('edit',title,true), out=h('div'), controls={};
  for(const f of fields) {
    const input=f.options?h('select',{'aria-label':f.label},f.options.map(([value,text])=>h('option',{value},text))):h(f.multiline?'textarea':'input',{'aria-label':f.label,spellcheck:'false',autocomplete:'off'});
    if(f.value!=null)input.value=String(f.value);
    controls[f.key]=input;
    body.append(f.info?infoLabel(f.label,f.info):h('label',f.label),f.suggest?suggest(input,f.suggest):input);
    if (f.hint) body.append(h('p.fhint',f.hint));
  }
  const save=h('button.primary','Add to pending changes');save.onclick=act(save,async()=>{await submit(Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value])));close();},out);
  body.append(out,h('div.actions',h('button',{onclick:close},'Cancel'),save));
  Object.values(controls)[0]?.focus();
}
const OPTIONS_HINT='CALL is a normal call. DELEGATECALL runs the target’s code as the Safe itself, so it can change anything in the Safe: allow it only for trusted batch contracts such as MultiSend. “With ETH” also lets the role send the Safe’s ETH.';
const opOptions=[[0,'CALL, no ETH'],[1,'CALL with ETH'],[2,'CALL or DELEGATECALL, no ETH'],[3,'CALL or DELEGATECALL with ETH']];
export function targetForm(ctx,key) {
  const have=Object.values(draft(ctx).value.roles[key]?.targets||{}).filter(t=>t.clearance).map(t=>t.address);
  form('Add target',[{key:'address',label:'Target contract address',hint:'The contract this role may call.',suggest:()=>labelled(have)},{key:'mode',label:'Access',value:2,options:[[2,'Only functions I add'],[1,'Every function']]},{key:'options',label:'Execution options (every function)',value:0,options:opOptions,info:OPTIONS_HINT}],v=>mutate(ctx,s=>{const a=checkAddress(v.address),t=target(s,key,a);if(t.clearance)throw Error('This role already has this target.');t.clearance=Number(v.mode);t.options=t.clearance===1?Number(v.options):0;}));
}
/** Add a function to a scoped target: pick it from the contract's ABI (yours or Etherscan's), or type a signature or selector. */
function addFunction(ctx,key,t,names) {
  const {body,close}=sheet('edit','Add function',true),out=h('div');
  const options=h('select',{'aria-label':'Execution options'},opOptions.map(([value,text])=>h('option',{value},text)));
  const add=(sel,withConditions,f)=>{mutate(ctx,s=>{const x=target(s,key,t.address);if(x.clearance!==2)throw Error('This target allows every function already.');x.functions[sel]={selector:sel,options:Number(options.value),conditions:null};});close();if(withConditions&&editorHooks.conditions)editorHooks.conditions(ctx,key,{address:t.address,fn:f});};
  const fns=names?names.abi.filter(f=>f.write&&!t.functions['0x'+f.selector]):[];
  const search=h('input',{placeholder:'Search functions',spellcheck:'false',autocomplete:'off','aria-label':'Search functions'}),rows=h('div.slist.fpick');
  const draw=()=>{const q=search.value.trim().toLowerCase();const found=fns.filter(f=>f.sig.toLowerCase().includes(q));put(rows,found.length?found.map(f=>h('div.srow',h('code.sig',h('b',f.name),'('+f.inputs.map(i=>i.type+(i.name?' '+i.name:'')).join(', ')+')'),h('span.grow'),f.inputs.length>0&&h('button.link',{onclick:()=>add('0x'+f.selector,true,f)},'With conditions…'),h('button.sm',{onclick:()=>add('0x'+f.selector,false,f)},'Allow'))):h('p.empty',q?'No function matches.':'Every function in the ABI is already configured.'));};
  search.oninput=draw;
  const sig=h('input',{placeholder:'transfer(address to, uint256 amount) or 0xa9059cbb',spellcheck:'false',autocomplete:'off','aria-label':'Function signature or selector'}),byHand=h('button','Add');
  byHand.onclick=act(byHand,async()=>{const text=sig.value.trim();if(!text)throw Error('Enter a signature or a selector.');const f=/^0x[0-9a-fA-F]{8}$/.test(text)?null:parseAbi(text)[0];add(selector(text),false,f);},out);
  put(body,infoLabel('Execution options',OPTIONS_HINT),options,
    names?.abi.length?[h('label','From the contract’s ABI'),fns.length>6&&search,rows]:h('p.mut.small','No ABI for this contract: type the function, or add its ABI from the target’s ⋯ menu to pick from a list.'),
    h('label','Or type a signature or selector'),h('div.row',sig,byHand),out);
  if(names?.abi.length)draw();
  (fns.length>6?search:sig).focus();
}
function optionsForm(title,value,save){form(title,[{key:'options',label:'Execution options',value,options:opOptions,info:OPTIONS_HINT}],v=>save(Number(v.options)));}
/** The actions on a role page's cards, functions and members; role-view.js calls them from the ⋯ menus. */
function edits(ctx,key) {
  const base=()=>draft(ctx).base.roles[key];
  const on=(t,fn)=>s=>fn(target(s,key,t.address),s);
  return {
    addTarget:()=>targetForm(ctx,key),
    allowAll:t=>optionsForm('Allow every function',t.clearance===1?t.options:0,o=>mutate(ctx,on(t,x=>{x.clearance=1;x.options=o;}))),
    scope:t=>mutate(ctx,on(t,x=>{x.clearance=2;x.options=0;})),
    revokeTarget:t=>mutate(ctx,on(t,x=>{x.clearance=0;x.options=0;})),
    restoreTarget:t=>mutate(ctx,s=>{role(s,key).targets[t.address]=structuredClone(base().targets[t.address]);}),
    addFunction:(t,names)=>addFunction(ctx,key,t,names),
    conditions:(t,fn,f,focus)=>editorHooks.conditions&&editorHooks.conditions(ctx,key,{address:t.address,fn:f,options:fn.options,focus}),
    allowAny:(t,fn)=>mutate(ctx,on(t,x=>{x.functions[fn.selector].conditions=null;})),
    fnOptions:(t,fn)=>optionsForm('Execution options',fn.options,o=>mutate(ctx,on(t,x=>{x.functions[fn.selector].options=o;}))),
    revokeFn:(t,fn)=>mutate(ctx,on(t,x=>{delete x.functions[fn.selector];})),
    restoreFn:(t,fn)=>mutate(ctx,on(t,x=>{x.functions[fn.selector]=structuredClone(base().targets[t.address].functions[fn.selector]);})),
    addMember:()=>form('Add member',[{key:'member',label:'Member address',hint:'The account or Safe that may use this role.',suggest:()=>labelled(Object.keys(draft(ctx).value.roles[key]?.members||{}).filter(a=>draft(ctx).value.roles[key].members[a]))},{key:'def',label:'Default role',options:[['no','Keep their current default role'],['yes','Make this their default role']],hint:'Calls without a role key use the member’s default role.'}],v=>mutate(ctx,s=>{const a=checkAddress(v.member);role(s,key).members[a]=true;s.enabled[a]=true;if(v.def==='yes')s.defaults[a]=key;})),
    removeMember:a=>mutate(ctx,s=>{role(s,key).members[a]=false;}),
    restoreMember:a=>mutate(ctx,s=>{role(s,key).members[a]=true;}),
    makeDefault:a=>mutate(ctx,s=>{s.defaults[a]=key;}),
  };
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
// ---- Review changes: the calls in order, each as a card with its parameters read by type ----
const ACTION={assignRoles:'Change membership',setDefaultRole:'Set default role',allowTarget:'Allow every function',scopeTarget:'Scope target to its functions',revokeTarget:'Revoke target',allowFunction:'Allow function, any parameters',scopeFunction:'Set function conditions',revokeFunction:'Revoke function',setAllowance:'Set allowance',setTransactionUnwrapper:'Set transaction unwrapper',setAvatar:'Set avatar',setTarget:'Set target',transferOwnership:'Transfer ownership'};
const OPTION_TEXT=['CALL, no ETH','CALL with ETH','CALL or DELEGATECALL, no ETH','CALL or DELEGATECALL with ETH'];
const chainText=c=>KNOWN_IDS.includes(c)?label(c).name:'Chain ID: '+c;
const params=c=>parseAbi(c.signature)[0].inputs;
const callTarget=c=>{const i=params(c).findIndex(p=>p.name==='targetAddress');return i<0?null:c.args[i];};
/** One parameter as text (for Copy changes): addresses with your label, role keys with their name. */
function argText(p,v,n) {
  if(p.type==='address')return v+(labels.get(v)?' ('+labels.get(v)+')':n?.name?' ('+n.name+')':'');
  if(p.type==='bytes4'&&n?.fns.get(v.slice(2)))return v+' ('+n.fns.get(v.slice(2)).sig+')';
  if(p.type==='bytes32')return v+(keyName(v)!==v?' ('+keyName(v)+')':'');
  if(p.type==='bytes32[]')return v.map(k=>keyName(k)).join(', ');
  if(p.name==='options')return v+' ('+OPTION_TEXT[Number(v)]+')';
  if(/^(tuple|\()/.test(p.type))return json(v);
  return Array.isArray(v)?v.map(String).join(', '):String(v);
}
/** One parameter as UI: full addresses (this is what gets signed), role keys by name, options in words. */
function argView(p,v,n) {
  // `n`: the call's target names (a promise): its contract name next to the target, the function by its selector.
  if(p.type==='address'){const tag=h('span.mut.aname');if(p.name==='targetAddress')n.then(x=>x?.name&&!labels.get(v)&&put(tag,x.name));return [addr(v),tag];}
  if(p.type==='bytes4'){const tag=h('span.mut.aname');n.then(x=>{const f=x?.fns.get(v.slice(2));if(f)put(tag,f.name+'('+f.inputs.map(i=>i.type).join(', ')+')');});return [h('code',v),tag];}
  if(p.type==='bytes32')return keyName(v)!==v?h('span',{title:v},keyName(v)):h('code',v);
  if(p.type==='bytes32[]')return v.map(k=>keyName(k)).join(', ');
  if(p.type==='bool[]')return v.map(x=>x?'add':'remove').join(', ');
  if(p.name==='options')return OPTION_TEXT[Number(v)];
  if(/^(tuple|\()/.test(p.type))return h('details.rvconds',h('summary',v.length+' condition'+(v.length===1?'':'s')),h('pre',json(v)));
  return h('code',Array.isArray(v)?v.map(String).join(', '):String(v));
}
/** Every call as plain text, to paste to a reviewer (a person or an agent): what, in order, with calldata. */
function changesText(ctx,d,calls,names) {
  const lines=['Zodiac Roles modifier changes for review','Modifier: '+ctx.address+' (Roles '+ctx.info.version+')','Chain: '+chainText(ctx.chain)+' (chain ID '+ctx.chain+')','Owner: '+d.base.owner+(labels.get(d.base.owner)?' ('+labels.get(d.base.owner)+')':''),'',calls.length+' call'+(calls.length===1?'':'s')+' to the modifier, applied in this order:'];
  calls.forEach((c,i)=>{const ps=params(c);lines.push('',(i+1)+'. '+(ACTION[c.signature.split('(')[0]]||c.text)+(c.danger?' [widens access]':''),'   '+c.text,'   '+c.signature,...ps.map((p,j)=>'   '+p.name+': '+argText(p,c.args[j],names[callTarget(c)]).replace(/\n/g,'\n   ')),'   to: '+c.to,'   data: '+c.data);});
  return lines.join('\n');
}
export function review(ctx) {
  const d=draft(ctx),calls=diff(d.base,d.value,ctx.address),{body,close}=sheet('people','Review changes',true);
  body.classList.add('fulladdr');
  const risky=calls.filter(c=>c.danger).length;
  // Names for each target (your ABI, Etherscan's, standard interfaces; each matched by its selector).
  const names={},loading=Object.fromEntries([...new Set(calls.map(callTarget).filter(Boolean))].map(a=>[a,namesFor(ctx.chain,a).then(n=>(names[a]=n),()=>null)]));
  const card=(c,i)=>{const ps=params(c),n=loading[callTarget(c)]||Promise.resolve(null);return h('section.rvcall',h('div.rvtop',h('span.rvnum',String(i+1)),h('b',ACTION[c.signature.split('(')[0]]||c.text),c.danger&&h('span.chip.warn','Widens access')),
    h('table.kv.rvargs',ps.map((p,j)=>h('tr',h('th',p.name),h('td',argView(p,c.args[j],n))))),
    h('details.rvraw',h('summary','Calldata'),h('code.sig',c.signature),h('pre',c.data)));};
  put(body,h('div.rvhead',h('div',h('span.mut','Modifier'),addr(ctx.address)),h('div',h('span.mut','Chain'),h('span.chip',chainText(ctx.chain)))),
    calls.length>0&&h('p.mut.small.rvnote',calls.length+' call'+(calls.length===1?'':'s')+' to the modifier, applied in this order.'),
    risky>0&&warn((risky===1?'One change widens':risky+' changes widen')+' access to the Safe’s assets. Review every address and parameter.'),
    h('div.rvcalls',calls.map(card)));
  if(!calls.length){body.append(h('p','No onchain changes.'));return;}
  const copyAll=h('button',{title:'Every call as text, with calldata, to paste to a reviewer'},'Copy changes');
  copyAll.onclick=async()=>{await Promise.all(Object.values(loading));toClipboard(changesText(ctx,d,calls,names)).then(()=>{put(copyAll,'✓ Copied');setTimeout(()=>put(copyAll,'Copy changes'),1500);},()=>{});};
  const direct=d.base.owner===session.account, supported=direct||ctx.ownerSafe;
  if(!supported){body.append(warn('This modifier owner is neither the connected wallet nor a readable Safe. Review the calls above, then use a tool that can act for '+d.base.owner+'.'),h('div.actions.rvfoot',copyAll));return;}
  const gatewayInput=h('input',{'aria-label':'safe.wei gateway',value:load('gateway','https://safe.wei.limo/')});
  const nonce=h('input',{'aria-label':'Safe nonce',placeholder:'Current Safe nonce',inputmode:'numeric'});
  const foot=h('div.actions.rvfoot'),out=h('div');
  if(direct) {
    const apply=h('button.primary','Apply changes');
    apply.onclick=act(apply,async()=>{await preflight(ctx,d);await directApply(ctx,d,text=>put(out,h('p',text)));drafts.delete(id(ctx));close();ctx.refresh();},out);
    put(foot,apply,copyAll);body.append(foot,out);return;
  }
  // A Safe owns the modifier: the safe.wei link is prepared right away (checked against the Safe's own
  // transaction hash), and again when the hand-off options change; one row of actions once it is ready.
  let seq=0;
  const prepare=async()=>{
    const mine=++seq;
    put(foot,h('span.rvwait',h('span.spin'),'Preparing the safe.wei link…'),copyAll);put(out);
    try {
      await preflight(ctx,d);
      const base=gateway(gatewayInput.value),result=await proposal(ctx.request,ctx.chain,d.base.owner,calls,base,nonce.value);
      if(mine!==seq)return;
      store('gateway',base);
      put(foot,h('a.btn.primary',{href:result.url,target:'_blank',rel:'noopener'},'Open in safe.wei to approve'),copyButton('Copy link',result.url),copyAll);
      put(out,h('p.mut.small.rvsend','Send the link to the Safe’s owners: they check it, sign and execute it in safe.wei.'));
    } catch(e) {
      if(mine!==seq)return;
      put(foot,h('button',{onclick:prepare},'Try again'),copyAll);put(out,bad(friendlyError(e)));
    }
  };
  gatewayInput.onchange=nonce.onchange=prepare;
  body.append(h('details',h('summary','Safe hand-off options'),h('label','safe.wei gateway'),gatewayInput,h('label','Safe nonce (current or later)'),nonce),foot,out);
  prepare();
}
export function editBody(ctx,path) {
  if(!ctx.complete||ctx.info.faulty)return null;
  const d=draft(ctx),root=h('div');
  ctx.redraw=()=>{
    const calls=diff(d.base,d.value,ctx.address);
    put($('batch'),calls.length > 0 && h('button',{onclick:()=>review(ctx)},calls.length+' change'+(calls.length===1?'':'s')));
    // The draft, in one bar above the page: how many changes, Undo, Discard, Review.
    const toolbar=calls.length?h('div.draftbar',h('span',calls.length+' pending change'+(calls.length===1?'':'s')),h('span.grow'),d.history.length>0&&h('button.link',{onclick:()=>{d.value=d.history.pop();ctx.redraw();}},'Undo'),h('button.link',{onclick:()=>{drafts.delete(id(ctx));put($('batch'));ctx.refresh();}},'Discard'),h('button.primary.sm',{onclick:()=>review(ctx)},'Review changes')):null;
    const stateCtx={...ctx,state:d.value,base:d.base};
    if(path[0]==='role') {
      const key=path[1],member=d.value.roles[key]?.members[session.account]&&d.value.enabled[session.account];
      put(root,toolbar,roleView({...stateCtx,edit:edits(ctx,key),roleActions:member&&editorHooks.use&&h('button.primary.sm',{onclick:()=>editorHooks.use(ctx,key)},'Use this role')},key));
    } else if(path[0]==='allowances')put(root,toolbar,allowancesView({...stateCtx,edit:{set:(k,v)=>mutate(ctx,s=>{s.allowances[k]=v;})}}));
    else {const roles=Object.values(d.value.roles);put(root,toolbar,h('h2','Roles'),roles.length?h('div.slist',roles.map(r=>h('a.srow',{href:'#/'+ctx.address+'/role/'+r.key},h('b',keyName(r.key)),h('span.mut',Object.values(r.members).filter(Boolean).length+' members · '+Object.values(r.targets).filter(t=>t.clearance).length+' targets')))):h('p.empty','No roles configured yet. Choose New role to start.'),h('div.actions',h('button',{onclick:()=>form('New role',[{key:'key',label:'Role name or bytes32 key'}],v=>{const key=roleKey(v.key);mutate(ctx,s=>role(s,key));location.hash='/'+ctx.address+'/role/'+key;})},'New role')),h('details',h('summary','Modifier settings'),h('div.actions',h('button',{onclick:()=>settings(ctx)},'Owner, avatar and target'),h('button',{onclick:()=>unwrapForm(ctx)},'Transaction unwrapper'))));}
  };
  ctx.redraw(); return root;
}
