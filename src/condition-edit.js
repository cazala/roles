import { h, put, act, sheet, warn, infoLabel } from './ui.js';
import { parseAbi } from './abicoder.js';
import { buildConditions, conditionFields, readConditions } from './condition-builder.js';
import { words } from './conditions.js';
import { mutate, draft, OPTIONS_HINT } from './edit.js';
import { target } from './roles.js';
import { isAddr, ZERO } from './abi.js';
import { parseUnits, formatUnits } from './units.js';

// A value field: `plain` text, or for numbers `amount`, typed in a unit (base units, gwei, ether, 6 or 8
// decimals, or the target token's own decimals) with the exact base units it becomes shown under it.
const plain=(label,type)=>{const input=h('input',{'aria-label':label,placeholder:type,spellcheck:'false',autocomplete:'off'});return {el:input,get:()=>input.value,set:v=>(input.value=v),key:k=>(input.placeholder=k?'Allowance name or bytes32 key':type),hint:t=>(input.placeholder=t)};};
function amount(label,token) {
  const input=h('input',{'aria-label':label,placeholder:'Amount',spellcheck:'false',autocomplete:'off',inputmode:'decimal'}),note=h('p.fhint');
  const units=h('select.unit',{'aria-label':label+' unit'},[[0,'Base units'],token!=null&&[token,'Token units ('+token+')'],[9,'Gwei (×10⁹)'],[18,'Ether (×10¹⁸)'],[6,'×10⁶'],[8,'×10⁸']].filter(Boolean).map(([v,t])=>h('option',{value:v},t)));
  let isKey=false;
  const show=()=>{
    const v=input.value.trim(),d=Number(units.value);
    if(isKey||!v)return put(note);
    try {const n=parseUnits(v,d);put(note,d?'= '+n.toString()+' base units':token!=null&&token>0?'= '+formatUnits(n,token)+' in token units':'');}
    catch(e){put(note,h('span.bad',e.message));}
  };
  input.oninput=units.onchange=show;
  return {el:h('div.amount',h('div.row',input,units),note),get:()=>isKey?input.value:parseUnits(input.value,Number(units.value)).toString(),set:v=>{input.value=v;units.value='0';show();},key:k=>{isKey=k;units.hidden=k;input.placeholder=k?'Allowance name or bytes32 key':'Amount';show();},hint:t=>(input.placeholder=t)};
}
/** The target's decimals() when it answers like a token (0–36), for typing amounts in its units. */
async function decimalsOf(ctx,a) {
  try {const r=await ctx.request('eth_call',[{to:a,data:'0x313ce567'},'latest']);if(!/^0x[0-9a-f]{64}$/i.test(r))return null;const d=Number(BigInt(r));return d>0&&d<=36?d:null;} catch {return null;}
}

const modes=p=>{
  const out=[['pass','Any value'],['equal','Equal to'],['oneof','One of these values']];
  if(p.type==='address')out.push(['avatar','Equal to avatar (the Safe)']);
  if(/^uint\d*$/.test(p.type))out.push(['greater','Greater than'],['less','Less than'],['between','Between (exclusive)'],['allowance','Within allowance']);
  return out;
};
const under=(path,k)=>path===k||path.startsWith(k+'.')||path.startsWith(k+'[');

/** One parameter's control: its condition, then the value(s) it needs; prefilled from `cfg` (readConditions). */
function field(f,token,cfg) {
  const {p,path}=f,number=/^u?int\d*$/.test(p.type),make=()=>number?amount(path+' value',token):plain(path+' value',p.type);
  const mode=h('select',{'aria-label':path+' condition'},[cfg?.mode==='keep'&&['keep','Keep as stored'],...modes(p)].filter(Boolean).map(([v,t])=>h('option',{value:v},t)));
  const widgets=[make(),make()],vals=h('div.cvals');
  const add=h('button.link.addval',{type:'button'},'+ Add value');
  const count=()=>{const m=mode.value;return m==='pass'||m==='avatar'||m==='keep'?0:m==='between'?2:m==='oneof'?Math.max(2,widgets.oneof||2):1;};
  const draw=()=>{
    const m=mode.value;
    if(m==='oneof')widgets.oneof=Math.max(2,widgets.oneof||2);
    while(widgets.length<count())widgets.push(make());
    widgets[0].key(m==='allowance');
    widgets[0].hint(m==='between'?'Greater than':m==='allowance'?'Allowance name or bytes32 key':number?'Amount':p.type);
    widgets[1].hint(m==='between'?'Less than':number?'Amount':p.type);
    put(vals,widgets.slice(0,count()).map((w,i)=>m==='oneof'&&i>=2?h('div.cval',w.el,h('button.link',{type:'button',onclick:()=>{widgets.splice(i,1);widgets.oneof=Math.max(2,widgets.oneof-1);draw();}},'Remove')):w.el),
      m==='oneof'&&add,m==='keep'&&h('p.fhint','Kept exactly as stored: ',h('code',words(cfg.node,path)),'. This editor cannot show this condition; choose another to replace it.'));
  };
  add.onclick=()=>{widgets.oneof=(widgets.oneof||2)+1;draw();const w=widgets[widgets.oneof-1].el;(w.querySelector?w.querySelector('input'):w)?.focus();};
  mode.onchange=draw;
  if(cfg){
    mode.value=cfg.mode;
    if(cfg.mode==='oneof'){widgets.oneof=cfg.values.length;while(widgets.length<cfg.values.length)widgets.push(make());cfg.values.forEach((v,i)=>widgets[i].set(v));}
    else {if(cfg.value!=null)widgets[0].set(cfg.value);if(cfg.second!=null)widgets[1].set(cfg.second);}
  }
  draw();
  const get=()=>{const m=mode.value;if(m==='keep')return {mode:m,node:cfg.node};if(m==='pass'||m==='avatar')return {mode:m};if(m==='oneof')return {mode:m,values:widgets.slice(0,count()).map(w=>w.get())};if(m==='between')return {mode:m,value:widgets[0].get(),second:widgets[1].get()};return {mode:m,value:widgets[0].get()};};
  return {path,mode,get,row:h('div.panel.cfield',{'data-path':path},h('b',path,h('span.mut',' · '+p.type)),mode,vals)};
}

// `pre` (from a function's ⋯ menu, a condition row, or Add function): { address, fn (the parsed ABI function,
// if known), options, focus (the index of the parameter to scroll to) }. The editor opens with the function's
// current conditions (from the draft), so saving changes only what you change; conditions it cannot express are
// kept exactly as stored.
export function editConditions(ctx,key,pre={}) {
  const {body,close}=sheet('edit','Function conditions',true),out=h('div'),editor=h('div');
  const address=h('input',{'aria-label':'Target address',placeholder:'0x…',spellcheck:'false'}),abi=h('textarea',{'aria-label':'Target ABI',placeholder:'Paste JSON ABI or function transfer(address recipient,uint256 amount)',spellcheck:'false'}),load=h('button.primary','Load ABI');
  load.onclick=act(load,async()=>{
    const a=address.value.trim().toLowerCase();if(!isAddr(a)||a===ZERO)throw Error('Enter a nonzero target address.');
    const functions=pre.fn&&a===pre.address?[pre.fn]:parseAbi(abi.value).filter(f=>f.write);if(!functions.length)throw Error('That ABI has no write functions.');
    const token=await decimalsOf(ctx,a);
    const fn=h('select',{'aria-label':'Function'},functions.map(f=>h('option',{value:f.sig},f.sig))),options=h('select',{'aria-label':'Execution options'},[[0,'CALL, no ETH'],[1,'CALL with ETH'],[2,'CALL or DELEGATECALL, no ETH'],[3,'CALL or DELEGATECALL with ETH']].map(([v,t])=>h('option',{value:v},t)));
    const rows=h('div.cfields'),note=h('div'),ether=h('input',{'aria-label':'ETH allowance key',placeholder:'Optional name or bytes32 key'}),calls=h('input',{'aria-label':'Call allowance key',placeholder:'Optional name or bytes32 key'}),allow=h('details',h('summary','Transaction allowances'),h('label','ETH allowance key'),ether,h('label','Call allowance key'),calls);
    let controls=[],kept={},stored=null;const scratch=new Set(); // kept structures the user chose to rebuild
    const render=()=>{
      const active=functions.find(f=>f.sig===fn.value);
      stored=draft(ctx).value.roles[key]?.targets[a]?.functions['0x'+active.selector]||null;
      const read=stored?.conditions?readConditions(active,stored.conditions):null;
      if(stored)options.value=String(stored.options);else if(pre.options!=null)options.value=String(pre.options);
      ether.value=read?.extras.ether||'';calls.value=read?.extras.call||'';allow.open=!!(ether.value||calls.value);
      const leaves=conditionFields(active),leafPaths=new Set(leaves.map(l=>l.path));
      // Whole structures (a tuple, an array) whose stored shape the editor cannot express stay as one kept card.
      kept=Object.fromEntries((read?.kept||[]).filter(k=>!leafPaths.has(k)&&!scratch.has(k)).map(k=>[k,read.configs[k]]));
      controls=leaves.filter(l=>!Object.keys(kept).some(k=>under(l.path,k))).map(l=>field(l,token,read&&!read.unreadable?read.configs[l.path]:null));
      put(note,read?.unreadable?warn('These conditions have a shape this editor cannot show, so it starts from Any value; saving replaces them. The function’s ⋯ → Exact conditions shows them as stored.'):stored?.conditions?h('p.mut.small','Opened with its current conditions: change what you need.'):null);
      put(rows,Object.entries(kept).map(([k,c])=>h('div.panel.cfield',h('b',k),h('p.fhint','Kept exactly as stored: ',h('code',words(c.node,k)),'.'),h('button.link',{type:'button',onclick:()=>{scratch.add(k);render();}},'Edit it from scratch'))),controls.map(x=>x.row));
    };
    fn.onchange=render;render();
    if(pre.focus!=null&&pre.fn){const name=pre.fn.inputs[pre.focus]?.name||'arg'+pre.focus,x=controls.find(c=>under(c.path,name));if(x)setTimeout(()=>{x.row.scrollIntoView({block:'center'});x.row.classList.add('flash');x.mode.focus();});}
    const add=h('button.primary','Add to pending changes');add.onclick=act(add,async()=>{
      const active=functions.find(f=>f.sig===fn.value),configs={...Object.fromEntries(Object.entries(kept)),...Object.fromEntries(controls.map(x=>[x.path,x.get()]))};
      const flat=buildConditions(active,configs,{ether:ether.value.trim(),call:calls.value.trim()}),sel='0x'+active.selector,opt=Number(options.value);
      if(!(stored&&JSON.stringify(stored.conditions)===JSON.stringify(flat)&&stored.options===opt))mutate(ctx,s=>{const t=target(s,key,a);if(t.clearance!==2){t.clearance=2;t.options=0;}t.functions[sel]={selector:sel,options:opt,conditions:flat};});
      close();
    },out);
    put(editor,functions.length>1&&[h('label','Function'),fn],note,infoLabel('Execution options',OPTIONS_HINT),options,rows,allow,h('div.actions',add),out);
  },out);
  if(pre.address)address.value=pre.address;
  if(pre.fn){put(body,h('p.mut.small','Conditions for ',h('code',pre.fn.sig),'.'),editor,out);load.onclick();return;}
  put(body,h('label','Target address'),address,h('label','Target ABI'),abi,h('div.actions',load),editor,out);address.focus();
}
