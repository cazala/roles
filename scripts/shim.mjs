// Test wallet for local development only: an injected EIP-1193 provider that forwards
// every request to an Anvil node and uses its unlocked accounts (?acct=N picks one).
// Never part of any build.
// Live mode (dev.mjs --live): a read-only wallet "as" an address on a real chain (reads through the dev server,
// which holds the RPC key), and Etherscan requests sent to the dev server, which adds the real key: the page only
// ever sees a placeholder key, and signing is refused.
export const shim = (url, live = null) => `<script>(()=>{
const LIVE=${JSON.stringify(live)};
if(LIVE){try{localStorage.setItem('roles.wei:explorerkey',JSON.stringify(LIVE.placeholder))}catch{}
const f=window.fetch.bind(window);window.fetch=(u,o)=>typeof u==='string'&&u.startsWith('https://api.etherscan.io/')?f('/etherscan?'+u.split('?')[1],o):f(u,o);}
let id=0;const L={};
const rpc=async(method,params=[])=>{const r=await fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}).then(r=>r.json());if(r.error)throw Object.assign(Error(r.error.message),r.error);return r.result};
const n=Number(new URLSearchParams(location.search).get('acct')||0);
const p={isDevAnvil:true,
request:async({method,params})=>{if(method==='eth_requestAccounts'||method==='eth_accounts'){if(LIVE)return[LIVE.account];const a=await rpc('eth_accounts');return[a[n]]}if(method==='wallet_revokePermissions')return null;if(LIVE&&/^(eth_send|eth_sign|personal_sign|wallet_)/.test(method))throw Object.assign(Error('The live dev wallet only reads: it cannot sign or send.'),{code:4001});return rpc(method,params)},
on:(e,f)=>(L[e]=L[e]||[]).push(f),removeListener(){}};
// Announce through EIP-6963 so it can be picked next to a real wallet extension,
// and fill window.ethereum only when no extension has taken it.
const info=Object.freeze({uuid:'00000000-0000-4000-8000-00000000a771',name:LIVE?'Live read-only wallet (dev)':'Anvil test wallet (dev)',icon:'data:,',rdns:'dev.anvil.test'});
const ann=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:Object.freeze({info,provider:p})}));
window.addEventListener('eip6963:requestProvider',ann);ann();
try{if(!window.ethereum)window.ethereum=p}catch{}
})()</script>`;
