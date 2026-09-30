import { encodeParameters, decodeParameters, parseValue } from './abicoder.js';
import { flatten, toTree, validate } from './conditions.js';
import { roleKey, keyName } from './roles.js';

const arrayOf=t=>/^(.*)\[(\d*)\]$/.exec(t);
const inner=(p,m)=>({...p,type:m[1]});
const dynamic=p=>p.type==='bytes'||p.type==='string';
const node=(paramType,operator,children=[],compValue='0x')=>({paramType,operator,compValue,children});

// The editor's shape of a function: one leaf per scalar parameter (tuples field by field, dynamic arrays by
// their element, fixed arrays item by item); structural nodes carry their path too, so a whole subtree can be kept.
function shape(p,path,leaves) {
  const m=arrayOf(p.type);
  if(m) {
    if(m[2]==='')return {...node(4,7,[shape(inner(p,m),path+'[]',leaves)]),path};
    const count=Number(m[2]);if(count>64)throw Error('Fixed arrays above 64 items are not supported by this editor.');
    return {...node(3,5,Array.from({length:count},(_,i)=>shape(inner(p,m),path+'['+i+']',leaves))),path};
  }
  if(p.type==='tuple')return {...node(3,5,p.components.map((c,i)=>shape(c,path+'.'+(c.name||i),leaves))),path};
  const leaf={p,path,paramType:dynamic(p)?2:1};leaves.push(leaf);return leaf;
}

const encoded=(p,value)=>encodeParameters([p],[parseValue(p,value)]);
const copy=n=>node(n.paramType,n.operator,n.children.map(copy),n.compValue);
function leafCondition(leaf,config={mode:'pass'}) {
  const {p,paramType}=leaf,base=(operator,compValue='0x')=>node(paramType,operator,[],compValue);
  if(config.mode==='pass')return base(0);
  if(config.mode==='keep')return copy(config.node);
  if(config.mode==='equal')return base(16,encoded(p,config.value));
  if(config.mode==='avatar') {if(p.type!=='address')throw Error(leaf.path+': avatar comparison requires address.');return base(15);}
  if(config.mode==='greater'||config.mode==='less') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': unsigned comparison requires uint.');return base(config.mode==='greater'?17:18,encoded(p,config.value));}
  if(config.mode==='allowance') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': allowance requires uint.');return base(28,roleKey(config.value));}
  if(config.mode==='between') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': range requires uint.');return node(0,1,[base(17,encoded(p,config.value)),base(18,encoded(p,config.second))]);}
  if(config.mode==='oneof') {
    const values=(config.values||[config.value,config.second]).filter(v=>String(v??'').trim()!=='');
    if(values.length<2)throw Error(leaf.path+': enter at least two values, or use Equal to.');
    return node(0,2,values.map(v=>base(16,encoded(p,v))));
  }
  throw Error(leaf.path+': unsupported condition.');
}

function materialize(n,configs) {
  if(configs[n.path]?.mode==='keep'&&!n.p)return copy(configs[n.path].node);
  if(n.p)return leafCondition(n,configs[n.path]);
  return node(n.paramType,n.operator,n.children.map(c=>materialize(c,configs)));
}

export function conditionFields(fn) {const leaves=[];fn.inputs.forEach((p,i)=>shape(p,p.name||'arg'+i,leaves));return leaves;}
export function buildConditions(fn,configs={},extras={}) {
  const leaves=[],children=fn.inputs.map((p,i)=>shape(p,p.name||'arg'+i,leaves)).map(n=>materialize(n,configs));
  if(extras.ether)children.push(node(0,29,[],roleKey(extras.ether)));
  if(extras.call)children.push(node(0,30,[],roleKey(extras.call)));
  if(!children.length)throw Error('This function has no parameters. Add a transaction allowance or keep it unrestricted.');
  const flat=flatten(node(5,5,children));validate(flat);return flat;
}

// ---- reading stored conditions back into the editor (the inverse of buildConditions) ----
/** A comparison value as the editor types it: addresses and numbers as text, bytes as hex. */
function text(p,compValue) {
  const v=decodeParameters([p],compValue)[0];
  return typeof v==='bigint'?v.toString():p.type==='address'?String(v).toLowerCase():String(v);
}
function readLeaf(leaf,n) {
  const {p,paramType}=leaf,uint=/^uint\d*$/.test(p.type),keep={mode:'keep',node:n};
  try {
    if(n.operator===1&&uint&&n.children.length===2&&n.children[0].operator===17&&n.children[1].operator===18&&n.children.every(c=>c.paramType===paramType&&!c.children.length))
      return {mode:'between',value:text(p,n.children[0].compValue),second:text(p,n.children[1].compValue)};
    if(n.operator===2&&n.children.length>=2&&n.children.every(c=>c.operator===16&&c.paramType===paramType&&!c.children.length))
      return {mode:'oneof',values:n.children.map(c=>text(p,c.compValue))};
    if(n.paramType!==paramType||n.children.length)return keep;
    if(n.operator===0)return {mode:'pass'};
    if(n.operator===15&&p.type==='address')return {mode:'avatar'};
    if(n.operator===16)return {mode:'equal',value:text(p,n.compValue)};
    if((n.operator===17||n.operator===18)&&uint)return {mode:n.operator===17?'greater':'less',value:text(p,n.compValue)};
    if(n.operator===28&&uint)return {mode:'allowance',value:keyName(n.compValue)};
  } catch {}
  return keep;
}
function read(s,n,out) {
  if(s.p){out.configs[s.path]=readLeaf(s,n);if(out.configs[s.path].mode==='keep')out.kept.push(s.path);return;}
  if(n.operator===s.operator&&n.paramType===s.paramType&&n.children.length===s.children.length)s.children.forEach((c,i)=>read(c,n.children[i],out));
  else {out.configs[s.path]={mode:'keep',node:n};out.kept.push(s.path);}
}
/**
 * A function's stored conditions as editor fields: { configs (by path), extras (ETH / call allowance names),
 * kept (paths kept exactly as stored, which the editor cannot express), unreadable (the whole tree) }.
 * Saving the unchanged result rebuilds the same conditions.
 */
export function readConditions(fn,flat) {
  const out={configs:{},extras:{ether:'',call:''},kept:[],unreadable:false};
  let root;
  try {root=toTree(flat);} catch {return {...out,unreadable:true};}
  if(root.operator!==5||root.paramType!==5)return {...out,unreadable:true};
  const kids=root.children.filter(c=>c.operator!==29&&c.operator!==30);
  for(const c of root.children){if(c.operator===29)out.extras.ether=keyName(c.compValue);if(c.operator===30)out.extras.call=keyName(c.compValue);}
  if(kids.length>fn.inputs.length)return {...out,unreadable:true};
  const leaves=[];fn.inputs.forEach((p,i)=>{const s=shape(p,p.name||'arg'+i,leaves);if(kids[i])read(s,kids[i],out);});
  return out;
}
