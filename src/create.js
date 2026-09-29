import { h, put, addr, warn, act, sheet, copyButton } from './ui.js';
import { session } from './app.js';
import { verifyCreation, creationCalls } from './create-plan.js';
import { proposal, gateway } from './handoff.js';
import { identify, metadata, FACTORY } from './roles.js';
import { load, store } from './store.js';

const records = () => { const value=load('created',[]);return Array.isArray(value)?value:[]; };
const saveRecord = value => {
  const all=records().filter(x=>!(x.chain===value.chain&&x.safe===value.safe&&x.address===value.address));
  all.unshift(value);store('created',all.slice(0,20));
};
const randomSalt = () => { const b=new Uint8Array(16);crypto.getRandomValues(b);return BigInt('0x'+[...b].map(x=>x.toString(16).padStart(2,'0')).join('')).toString(); };
const linkResult = (out, result, ...lead) => put(out,lead,h('p','The transaction hash was verified against the Safe. Review and approve it in safe.wei.'),h('div.actions',h('a.btn.primary',{href:result.url,target:'_blank',rel:'noopener'},'Open in safe.wei to approve'),copyButton('Copy link',result.url)));

async function receipt(request, hash) {
  for(let i=0;i<120;i++){const r=await request('eth_getTransactionReceipt',[hash]);if(r)return r;await new Promise(ok=>setTimeout(ok,1000));}
  throw Error('The deployment receipt is still pending. Reopen this Safe to continue enabling it.');
}

function createDialog(ctx) {
  const {body}=sheet('people','Create a Roles modifier',true),out=h('div'),review=h('div');
  body.classList.add('fulladdr');
  const input=(label,value,attrs={})=>{const el=h('input',{value,'aria-label':label,spellcheck:'false',autocomplete:'off',...attrs});return {label:h('label',label),el};};
  const owner=input('Owner address',ctx.address),avatar=input('Avatar address',ctx.address),target=input('Target address',ctx.address),salt=input('Salt',randomSalt(),{inputmode:'numeric'}),gatewayInput=input('safe.wei gateway',load('gateway','https://safe.wei.limo/')),nonce=input('Safe nonce',null,{placeholder:'Current Safe nonce',inputmode:'numeric'});
  const values=()=>({owner:owner.el.value.trim(),avatar:avatar.el.value.trim(),target:target.el.value.trim(),salt:salt.el.value.trim()});
  const show=async()=>{
    const plan=await verifyCreation(ctx.request,session.account,values()),calls=creationCalls(ctx.address,plan);
    const together=h('button.primary','Prepare deploy + enable link');
    together.onclick=act(together,async()=>{const base=gateway(gatewayInput.el.value),result=await proposal(ctx.request,ctx.chain,ctx.address,calls,base,nonce.el.value);store('gateway',base);linkResult(out,result);},out);
    const deploy=h('button','Deploy now');
    deploy.onclick=act(deploy,async()=>{
      const fresh=await verifyCreation(ctx.request,session.account,values());
      const hash=await ctx.request('eth_sendTransaction',[{from:session.account,to:FACTORY,data:fresh.data,value:'0x0'}]);put(out,h('p','Waiting for '+hash));
      const r=await receipt(ctx.request,hash);if(r.status!=='0x1')throw Error('The deployment transaction reverted.');
      const found=await identify(ctx.request,fresh.proxy,'latest');if(!found.supported)throw Error('The deployed proxy does not match Roles 2.1.1.');
      const meta=await metadata(ctx.request,fresh.proxy,'latest');if(['owner','avatar','target'].some(k=>meta[k]!==fresh[k]))throw Error('The deployed modifier settings do not match the review.');
      saveRecord({chain:ctx.chain,safe:ctx.address,address:fresh.proxy,owner:fresh.owner,avatar:fresh.avatar,target:fresh.target,tx:hash});
      const base=gateway(gatewayInput.el.value),result=await proposal(ctx.request,ctx.chain,ctx.address,[calls[1]],base,nonce.el.value);store('gateway',base);linkResult(out,result,h('p','Deployed ',addr(fresh.proxy),'. It cannot use Safe assets until the Safe enables it.'));
    },out);
    put(review,h('h3','Review creation'),h('p','Predicted modifier ',addr(plan.proxy)),h('p','Owner ',addr(plan.owner),' · Avatar ',addr(plan.avatar),' · Target ',addr(plan.target)),plan.owner!==ctx.address&&warn('This owner can change every role and control the Safe’s assets.'),(plan.avatar!==ctx.address||plan.target!==ctx.address)&&warn('Avatar or target differs from this Safe.'),
      h('div.panel',h('b','One Safe transaction · recommended'),h('p','The Safe deploys the modifier and enables the predicted address in one atomic batch.'),together),
      h('div.panel',h('b','Deploy now, enable later'),h('p','Your connected wallet deploys the proxy now. The Safe must still approve enableModule before any role can use its assets.'),deploy));
  };
  const check=h('button.primary','Review predicted deployment');check.onclick=act(check,show,out);
  put(body,h('p','Owner, avatar and target default to this Safe.'),owner.label,owner.el,avatar.label,avatar.el,target.label,target.el,h('details',h('summary','Advanced'),salt.label,salt.el),gatewayInput.label,gatewayInput.el,nonce.label,nonce.el,h('div.actions',check),review,out);
  owner.el.focus();
}

function pendingDialog(ctx,x) {
  const {body}=sheet('people','Enable deployed modifier'),out=h('div');
  const gatewayInput=h('input',{'aria-label':'safe.wei gateway',value:load('gateway','https://safe.wei.limo/')});
  const nonce=h('input',{'aria-label':'Safe nonce',placeholder:'Current Safe nonce',inputmode:'numeric'});
  const enable=h('button.primary','Prepare enablement link');
  enable.onclick=act(enable,async()=>{const base=gateway(gatewayInput.value),call=creationCalls(ctx.address,{proxy:x.address})[1],result=await proposal(ctx.request,ctx.chain,ctx.address,[call],base,nonce.value);store('gateway',base);linkResult(out,result);},out);
  put(body,h('p','Modifier ',addr(x.address)),h('p','This proxy is deployed but cannot use Safe assets until the Safe enables it.'),h('label','safe.wei gateway'),gatewayInput,h('label','Safe nonce (current or later)'),nonce,h('div.actions',enable),out);
}

export function createView(ctx) {
  const pending=records().filter(x=>x.chain===ctx.chain&&x.safe===ctx.address&&!ctx.safe.modules.includes(x.address));
  return h('div',h('div.panel.create',h('div',h('b','Create a Roles modifier'),h('p.mut','Predict, deploy and enable Roles 2.1.1.')),h('button.primary',{onclick:()=>createDialog(ctx)},'Create')),
    pending.map(x=>h('div.panel',h('b','Deployed, awaiting Safe enablement'),h('p',addr(x.address)),h('p.mut','Deployment '+x.tx),h('button',{onclick:()=>pendingDialog(ctx,x)},'Prepare enablement'))));
}
