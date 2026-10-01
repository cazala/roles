// #draft= links: a set of permission changes, proposed by a link (often written by an agent), loaded into the
// editor's draft so a person reviews every one in place before anything is sent. The link never applies or signs.
// FROZEN FORMAT once released: docs/links.md → Draft links, pinned by test/unit/draftlink.test.mjs. Extend only with
// a new version number or optional additions.
//
//   #/<modifier>?chain=<id>&draft=<z|j><base64url>      z: deflate-raw JSON, j: plain JSON
//   { "v": 1, "note": "…", "ops": [ … ] }
//
// Each op states the end result ("this function has these conditions"), so a change that already matches the chain
// drops out of the review, and applying a link twice is the same as once.
import { utf8, isAddr } from './abi.js';
import { parseAbi } from './abicoder.js';
import { roleKey, role, target } from './roles.js';
import { buildConditions } from './condition-builder.js';
import { validate } from './conditions.js';

const MAX128 = (1n << 128n) - 1n, MAX64 = (1n << 64n) - 1n;
const OPTIONS = { call: 0, 'call+eth': 1, delegatecall: 2, 'delegatecall+eth': 3 };
const MODES = new Set(['pass', 'equal', 'oneof', 'avatar', 'greater', 'less', 'between', 'allowance']);
const KEYS = {
  role: ['role'],
  member: ['role', 'member', 'remove', 'default'],
  target: ['role', 'target', 'access', 'options'],
  function: ['role', 'target', 'signature', 'selector', 'conditions', 'allowances', 'options', 'remove'],
  allowance: ['key', 'balance', 'refill', 'period', 'maxRefill', 'timestamp'],
};

// ---- encoding (the same as #import=) ----
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (data, T) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new T('deflate-raw'))).arrayBuffer());

/** The `draft=` value for a plan: deflated when the runtime can (`z`), else plain (`j`). */
export async function encode(plan, { plain = false } = {}) {
  const raw = utf8(JSON.stringify(check(plan)));
  const z = !plain && typeof CompressionStream === 'function' ? await pipe(raw, CompressionStream).catch(() => null) : null;
  return z ? 'z' + b64(z) : 'j' + b64(raw);
}
/** A plan from a `draft=` value (or a whole link containing one). Throws, saying why, on anything malformed. */
export async function decode(text) {
  const v = String(text).trim(), m = /^([zj])([A-Za-z0-9_-]+)$/.exec(/[?&#]draft=/.test(v) ? v.split(/[?&#]draft=/).pop().split('&')[0] : v);
  if (!m) throw Error('This is not a roles.wei draft link.');
  const b = unb64(m[2]);
  let plan;
  try { plan = JSON.parse(new TextDecoder().decode(m[1] === 'z' ? await pipe(b, DecompressionStream) : b)); } catch { throw Error('The draft in this link could not be read.'); }
  return check(plan);
}

// ---- validation: only well-formed plans, every field known ----
const fail = (i, why) => { throw Error((i == null ? '' : 'Change ' + (i + 1) + ': ') + why); };
const address = (i, v, what) => (typeof v === 'string' && isAddr(v) ? v.toLowerCase() : fail(i, what + ' must be a 0x address.'));
const amount = (i, v, what, max) => {
  if (v == null) return null;
  if (!(typeof v === 'string' || Number.isSafeInteger(v)) || !/^\d+$/.test(String(v))) fail(i, what + ' must be a whole number of base units (a decimal string).');
  const n = BigInt(v); if (n > max) fail(i, what + ' is too large.'); return n;
};
const optionsOf = (i, v) => (v == null ? 0 : v in OPTIONS ? OPTIONS[v] : Number.isInteger(v) && v >= 0 && v <= 3 ? v : fail(i, 'options must be one of ' + Object.keys(OPTIONS).join(', ') + '.'));
const roleOf = (i, v) => (typeof v === 'string' && (/^0x[0-9a-fA-F]{64}$/.test(v) || (v.trim() && new TextEncoder().encode(v).length <= 31)) ? v : fail(i, 'role must be a name (up to 31 bytes) or a bytes32 key.'));
/** Checks a plan's shape (not the chain): returns it as given, or throws naming the change at fault. */
export function check(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail(null, 'A draft is a JSON object.');
  for (const k of Object.keys(plan)) if (!['v', 'note', 'ops'].includes(k)) fail(null, 'Unknown field "' + k + '".');
  if (plan.v !== 1) fail(null, 'This draft is version ' + plan.v + '; this roles.wei reads version 1.');
  if (plan.note != null && (typeof plan.note !== 'string' || plan.note.length > 500)) fail(null, 'note must be text, up to 500 characters.');
  if (!Array.isArray(plan.ops) || !plan.ops.length || plan.ops.length > 200) fail(null, 'ops must list 1 to 200 changes.');
  plan.ops.forEach((o, i) => {
    if (!o || typeof o !== 'object' || !KEYS[o.op]) fail(i, 'op must be one of ' + Object.keys(KEYS).join(', ') + '.');
    for (const k of Object.keys(o)) if (k !== 'op' && !KEYS[o.op].includes(k)) fail(i, 'unknown field "' + k + '" for ' + o.op + '.');
    if (o.op !== 'allowance') roleOf(i, o.role);
    if (o.op === 'member') { address(i, o.member, 'member'); for (const k of ['remove', 'default']) if (o[k] != null && typeof o[k] !== 'boolean') fail(i, k + ' must be true or false.'); }
    if (o.op === 'target') { address(i, o.target, 'target'); if (!['scoped', 'all', 'revoke'].includes(o.access)) fail(i, 'access must be scoped, all or revoke.'); optionsOf(i, o.options); }
    if (o.op === 'function') {
      address(i, o.target, 'target'); optionsOf(i, o.options);
      if (o.signature == null && o.selector == null) fail(i, 'name the function by signature or selector.');
      if (o.selector != null && !/^0x[0-9a-fA-F]{8}$/.test(o.selector)) fail(i, 'selector must be 0x and 8 hex digits.');
      if (o.signature != null) { let f; try { [f] = parseAbi(o.signature); } catch (e) { fail(i, 'signature: ' + e.message); } if (o.selector != null && '0x' + f.selector !== o.selector.toLowerCase()) fail(i, 'selector does not match the signature.'); }
      if (o.remove != null && typeof o.remove !== 'boolean') fail(i, 'remove must be true or false.');
      const c = o.conditions;
      if (c != null && c !== 'any' && !Array.isArray(c)) {
        if (typeof c !== 'object') fail(i, 'conditions must be "any", parameter conditions, or the exact list.');
        if (o.signature == null) fail(i, 'parameter conditions need the signature.');
        for (const [p, x] of Object.entries(c)) if (!x || !MODES.has(x.mode)) fail(i, 'condition for ' + p + ': mode must be one of ' + [...MODES].join(', ') + '.');
      }
      if (o.allowances != null) for (const k of Object.keys(o.allowances)) if (!['ether', 'calls'].includes(k) || typeof o.allowances[k] !== 'string') fail(i, 'allowances takes ether and calls (allowance names).');
    }
    if (o.op === 'allowance') {
      if (typeof o.key !== 'string' || !o.key.trim()) fail(i, 'key must be an allowance name or bytes32 key.');
      if (amount(i, o.balance, 'balance', MAX128) == null) fail(i, 'balance is required.');
      amount(i, o.refill, 'refill', MAX128); amount(i, o.maxRefill, 'maxRefill', MAX128); amount(i, o.period, 'period', MAX64); amount(i, o.timestamp, 'timestamp', MAX64);
    }
  });
  return plan;
}

// ---- applying: onto a draft state (the editor's), all or nothing ----
/** Apply a checked plan to `state` (mutated). Returns one line per change, in words. Throws (state untouched by the caller's copy) on conflicts. */
export function apply(state, plan) {
  const said = [];
  plan.ops.forEach((o, i) => {
    const k = o.op === 'allowance' ? null : roleKey(o.role), name = o.role;
    if (o.op === 'role') { role(state, k); said.push('Role ' + name); }
    if (o.op === 'member') {
      const a = o.member.toLowerCase(), r = role(state, k);
      if (o.remove) { r.members[a] = false; said.push('Remove ' + a + ' from ' + name); }
      else { r.members[a] = true; state.enabled[a] = true; said.push('Add ' + a + ' to ' + name); }
      if (o.default) { if (o.remove) fail(i, 'a removed member cannot get this role as default.'); state.defaults[a] = k; said.push(name + ' is the default role of ' + a); }
    }
    if (o.op === 'target') {
      const t = target(state, k, o.target.toLowerCase());
      t.clearance = { revoke: 0, all: 1, scoped: 2 }[o.access]; t.options = t.clearance === 1 ? optionsOf(i, o.options) : 0;
      said.push({ revoke: 'Revoke target ', all: 'Allow every function of ', scoped: 'Scope ' }[o.access] + o.target.toLowerCase() + ' for ' + name);
    }
    if (o.op === 'function') {
      const t = target(state, k, o.target.toLowerCase()), f = o.signature != null ? parseAbi(o.signature)[0] : null, sel = f ? '0x' + f.selector : o.selector.toLowerCase();
      const what = (f ? f.sig : sel) + ' on ' + t.address + ' for ' + name;
      if (o.remove) { delete t.functions[sel]; said.push('Revoke ' + what); return; }
      if (t.clearance === 1) fail(i, 'the target allows every function; scope it first (a target op with access scoped).');
      if (t.clearance === 0) t.clearance = 2, (t.options = 0); // a function implies a scoped target
      const c = o.conditions;
      let conditions = null;
      if (Array.isArray(c)) { try { validate(c); } catch (e) { fail(i, 'conditions: ' + e.message); } conditions = c.map((n) => ({ parent: n.parent, paramType: n.paramType, operator: n.operator, compValue: String(n.compValue).toLowerCase() })); }
      else if ((c && c !== 'any') || o.allowances) { try { conditions = buildConditions(f, c && c !== 'any' ? c : {}, o.allowances || {}); } catch (e) { fail(i, 'conditions: ' + e.message); } }
      t.functions[sel] = { selector: sel, options: optionsOf(i, o.options), conditions };
      said.push('Allow ' + what + (conditions ? ' with conditions' : ', any parameters'));
    }
    if (o.op === 'allowance') {
      const key = roleKey(o.key), period = amount(i, o.period, 'period', MAX64) ?? 0n;
      state.allowances[key] = { allowanceKey: key, balance: amount(i, o.balance, 'balance', MAX128), refill: period ? amount(i, o.refill, 'refill', MAX128) ?? 0n : 0n, period, maxRefill: amount(i, o.maxRefill, 'maxRefill', MAX128) ?? MAX128, timestamp: amount(i, o.timestamp, 'timestamp', MAX64) ?? 0n };
      said.push('Set allowance ' + o.key);
    }
  });
  return said;
}
