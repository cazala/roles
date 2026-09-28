// Browser-wallet deployer for the exact current roles.wei build.
//   npm run deployer
//   npm run deployer -- --anvil http://127.0.0.1:8545
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { build } from 'esbuild';
import { compile, DEPLOYER, plan } from '../deploy-lib.mjs';
import { shim } from '../shim.mjs';

const root = new URL('../..', import.meta.url).pathname;
const index = process.argv.indexOf('--anvil');
const anvil = index > 0 ? process.argv[index + 1] : null;
const port = Number(process.env.PORT || 8080);
execFileSync(process.execPath, [root + 'scripts/build.mjs'], { stdio: 'inherit' });
const html = readFileSync(root + 'dist/index.html', 'utf8');
const deployment = plan(html, compile());
const gas = deployment.steps.reduce((total, step) => total + 53000 + ((step.initcode.length - 2) / 2) * 216, 0);
const js = (await build({ entryPoints: [root + 'scripts/deployer/client.js'], bundle: true, minify: true, format: 'iife', write: false })).outputFiles[0].text;
const payload = { deployer: DEPLOYER, salt: deployment.salt, app: deployment.app, chunks: deployment.chunks, contentHash: deployment.contentHash, size: deployment.size, gas, steps: deployment.steps };
const css = readFileSync(root + 'src/style.css', 'utf8');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deploy roles.wei</title><style>${css}</style></head><body>
<header><b>Deploy roles.wei</b><span></span></header><main>
<section><h2>Build</h2><table class="kv"><tr><th>App contract</th><td><code>${deployment.app}</code></td></tr><tr><th>Page</th><td>${deployment.size.toLocaleString()} bytes · ${deployment.chunks.length} data chunk(s)</td></tr><tr><th>contentHash</th><td><code>${deployment.contentHash}</code></td></tr><tr><th>CREATE2 deployer</th><td><code>${DEPLOYER}</code> · salt <code>${deployment.salt}</code></td></tr><tr><th>Cost</th><td id="cost">≈ ${gas.toLocaleString()} gas</td></tr></table><p class="mut">Addresses depend only on this build and salt. Existing steps are skipped.</p></section>
<section><h2>Wallet</h2><p id="wallet" class="mut">Not connected.</p><div class="actions"><button id="connect">Connect wallet</button></div></section>
<section><h2>Steps</h2><table class="kv"><tbody id="steps"></tbody></table><div class="actions"><button id="deploy" class="primary" disabled>Deploy</button></div><div id="log" class="mono"></div></section><section id="result"></section></main>
<script>window.PLAN=${JSON.stringify(payload)}</script><script>${js}</script></body></html>`;

createServer((request, response) => {
  if (request.url.split('?')[0] !== '/') return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(anvil ? page.replace('<head>', '<head>' + shim(anvil)) : page);
}).listen(port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
  console.log('\nroles.wei deployer · app ' + deployment.app + ' · ' + deployment.size + ' B');
  for (const ip of ['localhost', ...ips]) console.log('  http://' + ip + ':' + port + '/');
  if (anvil) console.log('  (test wallet → ' + anvil + ')');
});
