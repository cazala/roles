# Deploying roles.wei

The app is a single immutable HTML page served by `RolesWeiApp`. Its page chunks and app contract use the canonical CREATE2 deployer, so their addresses depend on the exact build bytes and salt, not the deploying account. Mainnet deployment and pointing `roles.wei` are owner actions.

## Rehearsal

Start from a clean commit. The footer build ID must not end in `+`.

```sh
npm ci
npm test
npm run test:fork
npm run build
PORT=18600 npm run fork
```

In another terminal, deploy to the fork and verify `html()` byte for byte:

```sh
node scripts/deploy.mjs --rpc http://127.0.0.1:18600 --from 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
node scripts/dev.mjs --anvil http://127.0.0.1:18600 --onchain <app-from-deploy-output> --port 5174
```

Operate that onchain-served page in the browser: connect, open a Safe and a modifier, type into each relevant form, review a Safe hand-off, and check the phone layout. The fork record is written to gitignored `deploy/local-1.json`.

The browser-wallet deployer is useful when the funded wallet is on another computer. It rebuilds, embeds the exact plan, skips deployed steps, keeps each transaction below the gas cap, and verifies the final page:

```sh
npm run deployer -- --anvil http://127.0.0.1:18600
# Mainnet handoff: npm run deployer
```

## Owner mainnet steps

1. Build and run all checks above from the commit to deploy.
2. Print the mainnet plan without sending anything: `node scripts/deploy.mjs --rpc <mainnet-rpc> --plan`.
3. Send the plan using the LAN deployer or a funded local signer: `PRIVATE_KEY=0x… node scripts/deploy.mjs --rpc <mainnet-rpc>`. The script is idempotent, verifies `html()` against `dist/index.html`, and writes `deploy/1.json`.
4. Verify the published `RolesWeiApp` source and constructor arguments, then check the page directly and through ERC-8244 and ERC-5219 gateways. The direct result must match the recorded `contentHash`:

   ```sh
   cast call <app> "html()(string)" --rpc-url <mainnet-rpc> > roles.wei.html
   cast keccak "$(cat roles.wei.html)"
   ```

5. Print the current name owner, resolution and exact pointing transaction with `node scripts/name.mjs --rpc <mainnet-rpc> --app <app>`. This helper is read-only.
6. The reported owner sends the printed `setAddr(uint256,address)` transaction. Re-run the helper until it says both that `html()` matches and `roles.wei` already points at the app. Open `https://roles.wei.limo/` and perform a final read and a small end-to-end action.
7. Commit `deploy/1.json`, record the app, content hash, code hash and gas in the README, and tag that deployed commit (for example `deployed-1`).

## Cloudflare Pages

The same `dist/index.html` is published by CI to the `roles-wei` Pages project. Pull requests receive a branch preview; pushes to `main` update `roles.caza.la`. The workflow adds anti-framing, MIME-sniffing and referrer headers. Repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` authorize Pages, while `ALCHEMY_API_KEY` gives fork tests an archive RPC.

Never put a private key or Cloudflare token in shell history, the repository or the deployer page.

## Latest clean rehearsal

Phase 8 was rehearsed on a fresh pinned mainnet fork on 2026-09-28. The 111,627-byte page deployed in five chunks plus the app contract, used 25,177,704 gas, and `html()` matched `dist/index.html` byte for byte.

- App: `0x87150d22a9500ad12cd2c52d18cea24937d3d730`
- Content hash: `0x84ed550e83f15a5dfb9deda395952c50f270c54cec7436b07bb4711f6112fecf`
- Runtime code hash: `0x0be3051eca1c6af87a2ad2574b010806b0f3d1295cbe9141c9c8242c75de9f55`
