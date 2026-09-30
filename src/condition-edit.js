import { h, put, act, sheet } from './ui.js';
import { parseAbi } from './abicoder.js';
import { buildConditions, conditionFields } from './condition-builder.js';
import { conditionView } from './condition-view.js';
import { mutate } from './edit.js';
import { target } from './roles.js';
import { isAddr, ZERO } from './abi.js';

const modes=p=>{
  const out=[['pass','Any value'],['equal','Equal to'],['oneof','One of two values']];
  if(p.type==='address')out.push(['avatar','Equal to avatar']);
  if(/^uint\d*$/.test(p.type))out.push(['greater','Greater than'],['less','Less than'],['between','Between two bounds'],['allowance','Within allowance']);
  return out;
};

// `pre` (from a function's ⋯ menu or Add function): { address, fn (the parsed ABI function, if known), options }.
// With a known function, the editor opens on it directly; the new conditions replace the function's current ones.
export function editConditions(ctx,key,pre={}) {
  const {body,close}=sheet('edit','Function conditions',true),out=h('div'),editor=h('div');
  const address=h('input',{'aria-label':'Target address',placeholder:'0x…',spellcheck:'false'}),abi=h('textarea',{'aria-label':'Target ABI',placeholder:'Paste JSON ABI or function transfer(address recipient,uint256 amount)',spellcheck:'false'}),load=h('button.primary','Load ABI');
  load.onclick=act(load,async()=>{
    const a=address.value.trim().toLowerCase();if(!isAddr(a)||a===ZERO)throw Error('Enter a nonzero target address.');
    const functions=pre.fn&&a===pre.address?[pre.fn]:parseAbi(abi.value).filter(f=>f.write);if(!functions.length)throw Error('That ABI has no write functions.');
    const fn=h('select',{'aria-label':'Function'},functions.map(f=>h('option',{value:f.sig},f.sig))),options=h('select',{'aria-label':'Execution options'},[[0,'CALL, no ETH'],[1,'CALL with ETH'],[2,'CALL or DELEGATECALL, no ETH'],[3,'CALL or DELEGATECALL with ETH']].map(([v,t])=>h('option',{value:v},t))),rows=h('div'),preview=h('div'),ether=h('input',{'aria-label':'ETH allowance key',placeholder:'Optional name or bytes32 key'}),calls=h('input',{'aria-label':'Call allowance key',placeholder:'Optional name or bytes32 key'});
    if(pre.options!=null)options.value=String(pre.options);let controls=[];
    const render=()=>{const active=functions.find(f=>f.sig===fn.value);controls=conditionFields(active).map(field=>{const mode=h('select',{'aria-label':field.path+' condition'},modes(field.p).map(([v,t])=>h('option',{value:v},t))),value=h('input',{'aria-label':field.path+' comparison',placeholder:field.p.type,spellcheck:'false'}),second=h('input',{'aria-label':field.path+' second comparison',placeholder:'Second value or upper bound',spellcheck:'false'}),update=()=>{value.hidden=['pass','avatar'].includes(mode.value);second.hidden=!['oneof','between'].includes(mode.value);value.placeholder=mode.value==='allowance'?'Allowance name or bytes32 key':field.p.type;};mode.onchange=update;update();return {field,mode,value,second,row:h('div.panel',h('b',field.path+' · '+field.p.type),mode,value,second)};});put(rows,controls.map(x=>x.row));put(preview);};
    fn.onchange=render;render();
    const add=h('button.primary','Add to pending changes');add.onclick=act(add,async()=>{const active=functions.find(f=>f.sig===fn.value),configs=Object.fromEntries(controls.map(x=>[x.field.path,{mode:x.mode.value,value:x.value.value,second:x.second.value}])),flat=buildConditions(active,configs,{ether:ether.value.trim(),call:calls.value.trim()});put(preview,h('h3','Condition preview'),conditionView(flat));mutate(ctx,s=>{const t=target(s,key,a);t.clearance=2;t.options=0;t.functions['0x'+active.selector]={selector:'0x'+active.selector,options:Number(options.value),conditions:flat};});close();},preview);
    put(editor,h('label','Function'),fn,h('label','Execution options'),options,h('p.fhint','Every comparison is ABI encoded from the supplied function. Dynamic arrays apply their child condition to every element.'),rows,h('details',h('summary','Transaction allowances'),h('label','ETH allowance key'),ether,h('label','Call allowance key'),calls),h('div.actions',add),preview);
  },out);
  if(pre.address)address.value=pre.address;
  if(pre.fn){put(body,h('p.mut.small','Conditions for ',h('code',pre.fn.sig),'. Saving replaces its current conditions.'),editor,out);load.onclick();return;}
  put(body,h('label','Target address'),address,h('label','Target ABI'),abi,h('div.actions',load),editor,out);address.focus();
}
