import { h, put, act, sheet } from './ui.js';
import { parseAbi } from './abicoder.js';
import { buildConditions, conditionFields } from './condition-builder.js';
import { conditionView } from './condition-view.js';
import { mutate } from './edit.js';
import { target } from './roles.js';
import { isAddr, ZERO } from './abi.js';
import { parseUnits, formatUnits } from './units.js';

// A value field: `plain` text, or for numbers `amount`, typed in a unit (base units, gwei, ether, 6 or 8
// decimals, or the target token's own decimals) with the exact base units it becomes shown under it.
const plain=(label,type)=>{const input=h('input',{'aria-label':label,placeholder:type,spellcheck:'false',autocomplete:'off'});return {el:input,get:()=>input.value,key:k=>(input.placeholder=k?'Allowance name or bytes32 key':type)};};
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
  return {el:h('div.amount',h('div.row',input,units),note),get:()=>isKey?input.value:parseUnits(input.value,Number(units.value)).toString(),key:k=>{isKey=k;units.hidden=k;input.placeholder=k?'Allowance name or bytes32 key':'Amount';show();}};
}
/** The target's decimals() when it answers like a token (0–36), for typing amounts in its units. */
async function decimalsOf(ctx,a) {
  try {const r=await ctx.request('eth_call',[{to:a,data:'0x313ce567'},'latest']);if(!/^0x[0-9a-f]{64}$/i.test(r))return null;const d=Number(BigInt(r));return d>0&&d<=36?d:null;} catch {return null;}
}

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
    const fn=h('select',{'aria-label':'Function'},functions.map(f=>h('option',{value:f.sig},f.sig))),options=h('select',{'aria-label':'Execution options'},[[0,'CALL, no ETH'],[1,'CALL with ETH'],[2,'CALL or DELEGATECALL, no ETH'],[3,'CALL or DELEGATECALL with ETH']].map(([v,t])=>h('option',{value:v},t))),rows=h('div.cfields'),preview=h('div'),ether=h('input',{'aria-label':'ETH allowance key',placeholder:'Optional name or bytes32 key'}),calls=h('input',{'aria-label':'Call allowance key',placeholder:'Optional name or bytes32 key'});
    if(pre.options!=null)options.value=String(pre.options);let controls=[];
    const token=await decimalsOf(ctx,a);
    const render=()=>{
      const active=functions.find(f=>f.sig===fn.value);
      controls=conditionFields(active).map(field=>{
        const number=/^u?int\d*$/.test(field.p.type);
        const mode=h('select',{'aria-label':field.path+' condition'},modes(field.p).map(([v,t])=>h('option',{value:v},t)));
        const value=number?amount(field.path+' value',token):plain(field.path+' value',field.p.type),second=number?amount(field.path+' upper bound or second value',token):plain(field.path+' second value',field.p.type);
        const update=()=>{value.el.hidden=['pass','avatar'].includes(mode.value);second.el.hidden=!['oneof','between'].includes(mode.value);value.key(mode.value==='allowance');};
        mode.onchange=update;update();
        return {field,mode,value,second,row:h('div.panel.cfield',h('b',field.path,h('span.mut',' · '+field.p.type)),mode,value.el,second.el)};
      });
      put(rows,controls.map(x=>x.row));put(preview);
    };
    fn.onchange=render;render();
    const add=h('button.primary','Add to pending changes');add.onclick=act(add,async()=>{const active=functions.find(f=>f.sig===fn.value),configs=Object.fromEntries(controls.map(x=>[x.field.path,{mode:x.mode.value,value:x.mode.value==='pass'||x.mode.value==='avatar'?'':x.value.get(),second:['oneof','between'].includes(x.mode.value)?x.second.get():''}])),flat=buildConditions(active,configs,{ether:ether.value.trim(),call:calls.value.trim()});put(preview,h('h3','Condition preview'),conditionView(flat));mutate(ctx,s=>{const t=target(s,key,a);t.clearance=2;t.options=0;t.functions['0x'+active.selector]={selector:'0x'+active.selector,options:Number(options.value),conditions:flat};});close();},preview);
    put(editor,functions.length>1&&[h('label','Function'),fn],h('label','Execution options'),options,rows,h('details',h('summary','Transaction allowances'),h('label','ETH allowance key'),ether,h('label','Call allowance key'),calls),h('div.actions',add),preview);
  },out);
  if(pre.address)address.value=pre.address;
  if(pre.fn){put(body,h('p.mut.small','Conditions for ',h('code',pre.fn.sig),'. Saving replaces its current conditions.'),editor,out);load.onclick();return;}
  put(body,h('label','Target address'),address,h('label','Target ABI'),abi,h('div.actions',load),editor,out);address.focus();
}
