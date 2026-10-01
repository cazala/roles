import { h, put, addr, warn, act, sheet, copyButton, friendlyError } from './ui.js';
import { session, route } from './app.js';
import { verifyCreation, creationCalls } from './create-plan.js';
import { proposal, gateway } from './handoff.js';
import { identify, metadata, read, FACTORY } from './roles.js';
import { load, store } from './store.js';

const records = () => { const value=load('created',[]);return Array.isArray(value)?value:[]; };
const saveRecord = value => {
  const all=records().filter(x=>!(x.chain===value.chain&&x.safe===value.safe&&x.address===value.address));
  all.unshift(value);store('created',all.slice(0,20));
};
const randomSalt = () => { const b=new Uint8Array(16);crypto.getRandomValues(b);return BigInt('0x'+[...b].map(x=>x.toString(16).padStart(2,'0')).join('')).toString(); };

async function receipt(request, hash) {
  for(let i=0;i<120;i++){const r=await request('eth_getTransactionReceipt',[hash]);if(r)return r;await new Promise(ok=>setTimeout(ok,1000));}
  throw Error('The deployment receipt is still pending. Reopen this Safe to continue enabling it.');
}

// Creating a modifier, as a wizard: one step on screen at a time (Setup → How → Review → Done), Back and Next
// in the footer. A modifier deployed earlier but not enabled resumes at Review.
function wizard(ctx, resume) {
  const { d, body } = sheet('people', resume ? 'Enable a deployed modifier' : 'Create a Roles modifier', true);
  body.classList.add('fulladdr', 'wizard');
  const bar = h('ol.wsteps'), page = h('div.wpage'), out = h('div'), foot = h('div.wfoot');
  put(body, bar, page, out, foot);
  const safe = ctx.address;
  const v = { owner: safe, avatar: safe, target: safe, salt: randomSalt(), how: resume ? 'enable' : 'safe', nonce: '', gateway: load('gateway', 'https://safe.wei.limo/'), plan: resume ? { proxy: resume.address } : null, deployed: resume ? resume.address : null, result: null };
  const steps = resume ? [review, done] : [setup, how, review, done], names = resume ? ['Review', 'Done'] : ['Setup', 'How', 'Review', 'Done'];
  let at = 0;
  const go = (i) => ((at = i), put(out), draw());
  function draw() {
    put(bar, names.map((n, i) => h('li' + (i === at ? '.on' : i < at ? '.past' : ''), h('span', i < at ? '✓' : String(i + 1)), n)));
    put(page, steps[at]());
    put(foot, footer());
  }
  const next = (label = 'Next') => h('button.primary', { onclick: () => go(at + 1) }, label);
  const back = () => at > 0 && steps[at] !== done && h('button', { onclick: () => go(at - 1) }, 'Back');
  function footer() {
    if (steps[at] === done) return v.result || v.failed ? h('button', { onclick: () => d.close() }, 'Close') : null;
    if (steps[at] !== review) return [back() || h('span'), next()];
    const label = v.how === 'wallet' ? 'Deploy from my wallet' : v.how === 'enable' ? 'Create the enable link' : 'Create the safe.wei link';
    const b = h('button.primary', label);
    b.onclick = act(b, async () => {
      if (!v.plan || !v.calls) throw Error('The review is still being checked.');
      if (v.how === 'wallet') return go(at + 1); // the deployment runs, with its progress, on the Done step
      const calls = v.how === 'enable' ? [v.calls[1]] : v.calls, base = gateway(v.gateway);
      v.result = await proposal(ctx.request, ctx.chain, safe, calls, base, v.nonce);
      store('gateway', base);
      go(at + 1);
    }, out);
    return [back() || h('span'), b];
  }

  // 1. Setup: the recommended setup in one card; the three addresses only when customized.
  function setup() {
    const warnings = h('div');
    const check = () => put(warnings, v.owner.toLowerCase() !== safe && warn('This owner can change every role and so control the Safe’s assets.'), (v.avatar.toLowerCase() !== safe || v.target.toLowerCase() !== safe) && warn('Avatar or target differs from this Safe: roles would act for that account.'));
    const field = (key, label) => { const el = h('input', { value: v[key], spellcheck: 'false', autocomplete: 'off', 'aria-label': label }); el.oninput = () => ((v[key] = el.value.trim()), (v.plan = null), check()); return [h('label', label), el]; };
    const custom = h('details.wcustom', h('summary', 'Customize'), field('owner', 'Owner'), field('avatar', 'Avatar'), field('target', 'Target'), warnings, h('details', h('summary', 'Advanced'), field('salt', 'Salt')));
    custom.open = v.owner !== safe || v.avatar !== safe || v.target !== safe;
    check();
    return [h('p', 'A Roles modifier lets members act for this Safe within the permissions you give them.'), h('div.wcard', h('div', h('b', 'Owner, avatar and target: this Safe'), h('span.wtag', 'recommended')), h('p.mut', 'Only the Safe’s owners can change its roles, and roles act for this Safe.'), addr(safe)), custom];
  }
  // 2. How: deploy and enable together through the Safe, or deploy now and enable later.
  function how() {
    const choice = (id, title, tag, text) => h('button.wcard.wpick' + (v.how === id ? '.on' : ''), { onclick: () => ((v.how = id), draw()) }, h('div', h('span.wradio'), h('b', title), tag && h('span.wtag', tag)), h('p.mut', text));
    return [
      choice('safe', 'With the Safe, in one transaction', 'recommended', 'The owners approve one batch that deploys the modifier and enables it. Nothing happens until they do.'),
      choice('wallet', 'Deploy now from my wallet, enable later', 'you pay gas', 'Your wallet deploys the modifier now. It can’t use the Safe’s assets until the owners approve enabling it.'),
    ];
  }
  // 3. Review: everything computed and read-only; the Safe nonce comes from the Safe.
  function review() {
    const box = h('div', h('p.mut', 'Checking the deployment…'));
    v.calls = null;
    (async () => {
      if (!v.plan) v.plan = await verifyCreation(ctx.request, session.account, v);
      const [current] = await read(ctx.request, safe, 'nonce()', ['uint256']);
      if (v.nonce === '') v.nonce = String(current);
      const plan = v.plan, calls = creationCalls(safe, plan);
      const nonceIn = h('input', { value: v.nonce, inputmode: 'numeric', 'aria-label': 'Safe nonce' }), gwIn = h('input', { value: v.gateway, spellcheck: 'false', 'aria-label': 'safe.wei gateway' });
      nonceIn.oninput = () => (v.nonce = nonceIn.value.trim());
      gwIn.oninput = () => (v.gateway = gwIn.value.trim());
      const row = (k, val) => h('div.wrow', h('span.mut', k), h('span', val));
      const now = v.how === 'enable' ? [calls[1]] : v.how === 'wallet' ? [calls[0]] : calls;
      put(box,
        h('div.wcard', row(v.deployed ? 'Modifier' : 'New modifier', addr(plan.proxy)), !v.deployed && [row('Owner', addr(plan.owner)), row('Avatar', addr(plan.avatar)), row('Target', addr(plan.target))]),
        !v.deployed && plan.owner !== safe && warn('This owner can change every role and so control the Safe’s assets.'),
        h('p.wsec', v.how === 'wallet' ? 'Your wallet sends' : 'The Safe owners approve'),
        h('ol.wcalls', now.map((c) => h('li', c.text))),
        v.how === 'wallet' && [h('p.wsec', 'Then the Safe owners approve'), h('ol.wcalls', h('li', calls[1].text))],
        h('label', 'Safe nonce'), nonceIn, h('p.mut.small', 'The Safe’s current nonce is ' + current + '. A later one queues it behind other transactions.'),
        h('details', h('summary', 'Advanced'), h('label', 'safe.wei gateway'), gwIn));
      v.calls = calls;
    })().catch((e) => put(box, warn(friendlyError(e)), h('p.mut', 'Go back to change the setup.')));
    return box;
  }
  // 4. Done: the link for the owners; from the wallet path, the deployment's progress first.
  function done() {
    if (v.result) return [h('div.wdone', h('b', v.how === 'wallet' || v.deployed ? 'Deployed. Now the owners enable it.' : 'Ready for the owners'), h('p.mut', 'Send this link to the Safe owners. They open it in safe.wei, check it and approve. The transaction hash was checked against the Safe.')), h('div.actions', h('a.btn.primary', { href: v.result.url, target: '_blank', rel: 'noopener' }, 'Open in safe.wei'), copyButton('Copy link', v.result.url))];
    const list = h('ol.wprogress'), box = h('div', list), stage = (text) => { const li = h('li', text); list.append(li); return li; };
    (async () => {
      const fresh = await verifyCreation(ctx.request, session.account, v);
      const s1 = stage('Confirm the deployment in your wallet…');
      const hash = await ctx.request('eth_sendTransaction', [{ from: session.account, to: FACTORY, data: fresh.data, value: '0x0' }]);
      put(s1, '✓ Sent ', h('code', hash.slice(0, 10) + '…'));
      const s2 = stage('Waiting for it to be mined…');
      const r = await receipt(ctx.request, hash);
      if (r.status !== '0x1') throw Error('The deployment transaction reverted.');
      put(s2, '✓ Mined');
      const s3 = stage('Checking the deployed modifier…');
      const found = await identify(ctx.request, fresh.proxy, 'latest');
      if (!found.supported) throw Error('The deployed proxy does not match Roles 2.1.1.');
      const meta = await metadata(ctx.request, fresh.proxy, 'latest');
      if (['owner', 'avatar', 'target'].some((k) => meta[k] !== fresh[k])) throw Error('The deployed modifier settings do not match the review.');
      saveRecord({ chain: ctx.chain, safe, address: fresh.proxy, owner: fresh.owner, avatar: fresh.avatar, target: fresh.target, tx: hash });
      put(s3, '✓ Deployed at ', addr(fresh.proxy));
      stage('Preparing the link to enable it…');
      const base = gateway(v.gateway);
      v.result = await proposal(ctx.request, ctx.chain, safe, [creationCalls(safe, fresh)[1]], base, v.nonce);
      store('gateway', base);
      draw();
    })().catch((e) => { v.failed = true; box.append(warn(friendlyError(e))); put(foot, h('button', { onclick: () => ((v.failed = false), go(at - 1)) }, 'Back to review')); });
    return box;
  }
  // Leaving after a deployment or a link: refresh the Safe page (a deployed modifier is listed there).
  d.addEventListener('close', () => (v.result || v.deployed) && route());
  draw();
}

export function createView(ctx) {
  // Home → + New: open the wizard right away (once: the flag leaves the URL).
  if(ctx.start){history.replaceState(null,'',location.hash.replace(/[?&]create\b/,''));setTimeout(()=>wizard(ctx));}
  const pending=records().filter(x=>x.chain===ctx.chain&&x.safe===ctx.address&&!ctx.safe.modules.includes(x.address));
  return h('div',h('div.panel.create',h('div',h('b','Create a Roles modifier'),h('p.mut','Predict, deploy and enable Roles 2.1.1.')),h('button.primary',{onclick:()=>wizard(ctx)},'Create')),
    pending.map(x=>h('div.panel',h('b','Deployed, awaiting Safe enablement'),h('p',addr(x.address)),h('p.mut','Deployment '+x.tx),h('button',{onclick:()=>wizard(ctx,x)},'Prepare enablement'))));
}
