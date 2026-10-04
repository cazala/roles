// Adapted from safe.wei: one HTML file, no runtime network/resource loaders.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(root + f, 'utf8');
const digest = createHash('sha256');
for (const f of readdirSync(root + 'src').sort()) digest.update(f).update(read('src/' + f));
const id = digest.digest('hex').slice(0, 10);
const js = (await build({ entryPoints: [root + 'src/app.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none', charset: 'utf8', define: { __BUILD__: JSON.stringify(id) } })).outputFiles[0].text.trim();
const css = (await transform(read('src/style.css'), { loader: 'css', minify: true })).code.trim();
if (/<\/script/i.test(js)) throw Error('Unsafe inline script terminator');
// Config that may need replacing after deployment (the WalletConnect project ID, links to safe.wei and the source, block explorers) lives outside src/ and goes
// into its own tiny first chunk, cut at <!--config--> (scripts/deploy-lib.mjs): replacing it redeploys only
// that chunk and the app contract.
const config = JSON.parse(read('config/walletconnect.json'));
if (!/^[0-9a-f]{32}$/.test(config.projectId)) throw Error('config/walletconnect.json: projectId must be 32 hex characters');
// Links to other places (safe.wei's gateways, where Safe transactions are handed off, and the source code), in the
// same first chunk: config/links.json.
const links = JSON.parse(read('config/links.json'));
const url = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/[\w./-]*$/.test(u);
if (!Array.isArray(links.safe) || !links.safe.length || !links.safe.every((u) => url(u) && u.endsWith('/')) || !url(links.source + '/'))
  throw Error('config/links.json: safe must be https:// gateway URLs ending in /, source an https:// URL');
// Block explorers (config/explorers.json, also in the first chunk): the providers, the chains each one covers, and
// the default order. Any Etherscan-compatible API; replacing this file changes them without touching the code.
const explorers = JSON.parse(read('config/explorers.json'));
const api = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/[\w./{}-]*)?(\?[\w=&{}.-]*)?$/.test(u) && !/\{(?!chain\})/.test(u);
for (const [eid, p] of Object.entries(explorers.providers || {})) {
  const bad = (why) => { throw Error('config/explorers.json: ' + eid + ' ' + why); };
  if (!/^[a-z0-9-]+$/.test(eid) || ['default', 'none', 'custom'].includes(eid)) bad('is not a valid id');
  if (typeof p.name !== 'string' || !p.name.trim()) bad('needs a name');
  if (!['required', 'optional', 'none'].includes(p.key)) bad('key must be required, optional or none');
  if (p.keyUrl !== undefined && !url(p.keyUrl)) bad('keyUrl must be an https:// URL');
  if (p.note !== undefined && (typeof p.note !== 'string' || /[<>]|https?:/i.test(p.note))) bad('note must be plain text');
  if (p.api !== undefined && (!api(p.api) || !p.api.includes('{chain}') || !Array.isArray(p.chains) || !p.chains.every((c) => Number.isSafeInteger(c) && c > 0))) bad('api must be an https:// URL with {chain}, with a list of chain ids');
  if (p.urls !== undefined && !Object.entries(p.urls).every(([c, u]) => /^[1-9]\d*$/.test(c) && api(u) && !u.includes('{'))) bad('urls must map chain ids to https:// URLs');
  if (!p.api && !p.urls) bad('needs api or urls');
}
if (!Array.isArray(explorers.default) || !explorers.default.every((d) => explorers.providers[d])) throw Error('config/explorers.json: default must list provider ids');
const OPEN = '<!doctype html><html lang="en"><head><meta charset="utf-8">';
const shell = read('src/index.html').replace(/>\s+</g, '><');
if (!shell.startsWith(OPEN)) throw Error('src/index.html must start with ' + OPEN);
const html = OPEN + '<script>var WC_PROJECT="' + config.projectId + '",LINKS=' + JSON.stringify({ safe: links.safe, source: links.source }) + ',EXPLORERS=' + JSON.stringify({ default: explorers.default, providers: explorers.providers }) + '</script><!--config-->' + shell.slice(OPEN.length).replace('<!--CSS-->', () => '<style>' + css + '</style>').replace('<!--JS-->', () => '<script>' + js + '</script>');
for (const re of [/<script[^>]+src\s*=/i, /<link[^>]+rel=["']?stylesheet/i, /@import/i, /\b(?:XMLHttpRequest|EventSource|importScripts)\s*\(/, /\bimport\s*\(/, /(?:src|poster)\s*=\s*["']?(?:https?:)?\/\//i]) {
  if (re.test(html)) throw Error('Remote resource/network loader check failed: ' + re);
}
// Network: only src/net.js opens connections (WalletConnect's relay, and JSON-RPC reads a wallet cannot
// serve), so no other source file may, and the bundle holds exactly one fetch( and one WebSocket(.
for (const f of readdirSync(root + 'src').filter((f) => f.endsWith('.js') && f !== 'net.js'))
  if (/\b(?:fetch|WebSocket)\s*\(/.test(read('src/' + f))) throw Error('src/' + f + ': network requests go through src/net.js only');
for (const re of [/\bfetch\s*\(/g, /\bWebSocket\s*\(/g]) if ((js.match(re) || []).length > 1) throw Error('More than one ' + re + ' in the bundle: network requests go through src/net.js only');
// Scan CSS separately: the case-insensitive HTML regex would mistake JavaScript's
// `new URL(...)` constructor for a CSS url(...) resource reference.
if (/url\(\s*["']?(?!data:|#)[^)]/i.test(css)) throw Error('Remote CSS resource check failed');
const raw = Buffer.byteLength(html), gzip = gzipSync(html).length;
if (raw > 300000) throw Error('Production HTML exceeds 300,000 bytes');
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/index.html', html);
writeFileSync(root + 'docs/size.md', '# Size report\n\nGenerated by `npm run build`.\n\n| Build | Raw HTML | gzip | JavaScript | CSS |\n| --- | ---: | ---: | ---: | ---: |\n| `' + id + '` | ' + raw + ' B | ' + gzip + ' B | ' + Buffer.byteLength(js) + ' B | ' + Buffer.byteLength(css) + ' B |\n\nTarget below 100,000 bytes; hard limit 300,000 bytes. No remote code/assets. Network requests only through src/net.js (the WalletConnect relay and RPC, or your history RPC); chain reads otherwise use the wallet provider.\n');
console.log('Build ' + id + ': ' + raw + ' B raw, ' + gzip + ' B gzip');
