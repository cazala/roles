import { h, put, addr, act, sheet } from './ui.js';
import { parseAbi } from './abicoder.js';
import { executionPlan, simulateExecution } from './execution.js';
import { session } from './app.js';
import { json } from './roles.js';

const receipt=async(request,hash)=>{for(let i=0;i<120;i++){const r=await request('eth_getTransactionReceipt',[hash]);if(r)return r;await new Promise(ok=>setTimeout(ok,1000));}throw Error('The receipt is still pending. Refresh before trying again.');};

export function useRole(ctx,key) {
  const role=ctx.state.roles[key],targets=Object.values(role.targets).filter(t=>t.clearance>0);
  const {body}=sheet('people','Use role',true),out=h('div'),builder=h('div');
  body.classList.add('fulladdr');
  const abi=h('textarea',{'aria-label':'Target ABI',placeholder:'Paste a JSON ABI or function transfer(address recipient, uint256 amount)',spellcheck:'false'});
  const load=h('button.primary','Load ABI');
  load.onclick=act(load,async()=>{
    if(!targets.length)throw Error('This role has no active targets.');
    const functions=parseAbi(abi.value).filter(f=>f.write);if(!functions.length)throw Error('That ABI has no write functions.');
    const target=h('select',{'aria-label':'Target'},targets.map(t=>h('option',{value:t.address},t.address)));
    const fn=h('select',{'aria-label':'Function'}),fields=h('div'),value=h('input',{'aria-label':'Safe value',value:'0',inputmode:'numeric'}),operation=h('select',{'aria-label':'Operation'},h('option',{value:0},'CALL'),h('option',{value:1},'DELEGATECALL')),sim=h('div');
    let active=[];
    const allowed=()=>{const t=role.targets[target.value];return functions.filter(f=>t.clearance===1||t.functions['0x'+f.selector]);};
    const renderFields=()=>{const f=allowed().find(x=>x.sig===fn.value);active=f?.inputs.map(p=>h('input',{'aria-label':p.name||p.type,placeholder:p.type,spellcheck:'false',autocomplete:'off'}))||[];put(fields,active.flatMap((input,i)=>[h('label',(f.inputs[i].name||'Argument '+(i+1))+' · '+f.inputs[i].type),input]));put(sim);};
    const renderFunctions=()=>{const options=allowed();put(fn,options.map(f=>h('option',{value:f.sig},f.sig)));renderFields();};
    const current=()=>{const f=allowed().find(x=>x.sig===fn.value);if(!f)throw Error('The selected ABI function is not allowed for this target.');return executionPlan(ctx.address,key,target.value,value.value,operation.value,f,active.map(x=>x.value));};
    const simulate=h('button.primary','Simulate role call');
    const reset=()=>put(sim);
    for(const el of [target,fn,value,operation])el.onchange=reset;
    target.onchange=()=>{renderFunctions();reset();};fn.onchange=()=>{renderFields();reset();};
    simulate.onclick=act(simulate,async()=>{
      const plan=current();await simulateExecution(ctx.request,session.account,plan);const fingerprint=session.chain+':'+session.account+':'+plan.data;
      const send=h('button.primary','Send from this member');
      send.onclick=act(send,async()=>{const fresh=current();if(fingerprint!==session.chain+':'+session.account+':'+fresh.data)throw Error('Inputs changed. Simulate again.');await simulateExecution(ctx.request,session.account,fresh);const hash=await ctx.request('eth_sendTransaction',[{from:session.account,to:fresh.to,data:fresh.data,value:'0x0'}]);put(sim,h('p','Waiting for '+hash));const r=await receipt(ctx.request,hash);if(r.status!=='0x1')throw Error('The role execution reverted.');put(sim,h('p','Confirmed '+hash));},sim);
      put(sim,h('p','Simulation succeeded. The Safe will call ',addr(plan.target),' with value '+plan.safeValue+'.'),h('details',h('summary','Review exact execution'),h('p','Role ',h('code',key)),h('p',h('code',plan.fn.sig)),h('pre',json(plan.args)),h('pre',plan.inner)),h('div.actions',send));
    },sim);
    renderFunctions();
    put(builder,h('label','Target'),target,h('label','Function'),fn,fields,h('label','Safe value (wei)'),value,h('label','Operation'),operation,h('p.fhint','The connected member sends no ETH. This value is what the Safe sends.'),h('div.actions',simulate),sim);
  },out);
  put(body,h('p','The transaction goes to the Roles modifier from the connected member. It is simulated against current chain state before sending.'),h('label','Target ABI'),abi,h('div.actions',load),builder,out);
  abi.focus();
}
