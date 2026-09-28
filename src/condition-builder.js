import { encodeParameters, parseValue } from './abicoder.js';
import { flatten, validate } from './conditions.js';
import { roleKey } from './roles.js';

const arrayOf=t=>/^(.*)\[(\d*)\]$/.exec(t);
const inner=(p,m)=>({...p,type:m[1]});
const dynamic=p=>p.type==='bytes'||p.type==='string';
const node=(paramType,operator,children=[],compValue='0x')=>({paramType,operator,compValue,children});

function shape(p,path,leaves) {
  const m=arrayOf(p.type);
  if(m) {
    if(m[2]==='')return node(4,7,[shape(inner(p,m),path+'[]',leaves)]);
    const count=Number(m[2]);if(count>64)throw Error('Fixed arrays above 64 items are not supported by this editor.');
    return node(3,5,Array.from({length:count},(_,i)=>shape(inner(p,m),path+'['+i+']',leaves)));
  }
  if(p.type==='tuple')return node(3,5,p.components.map((c,i)=>shape(c,path+'.'+(c.name||i),leaves)));
  const leaf={p,path,paramType:dynamic(p)?2:1};leaves.push(leaf);return leaf;
}

const encoded=(p,value)=>encodeParameters([p],[parseValue(p,value)]);
function leafCondition(leaf,config={mode:'pass',value:'',second:''}) {
  const {p,paramType}=leaf,base=(operator,compValue='0x')=>node(paramType,operator,[],compValue);
  if(config.mode==='pass')return base(0);
  if(config.mode==='equal')return base(16,encoded(p,config.value));
  if(config.mode==='avatar') {if(p.type!=='address')throw Error(leaf.path+': avatar comparison requires address.');return base(15);}
  if(config.mode==='greater'||config.mode==='less') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': unsigned comparison requires uint.');return base(config.mode==='greater'?17:18,encoded(p,config.value));}
  if(config.mode==='allowance') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': allowance requires uint.');return base(28,roleKey(config.value));}
  if(config.mode==='between') {if(!/^uint\d*$/.test(p.type))throw Error(leaf.path+': range requires uint.');return node(0,1,[base(17,encoded(p,config.value)),base(18,encoded(p,config.second))]);}
  if(config.mode==='oneof')return node(0,2,[base(16,encoded(p,config.value)),base(16,encoded(p,config.second))]);
  throw Error(leaf.path+': unsupported condition.');
}

function materialize(n,configs) {
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
