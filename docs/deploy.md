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

## WalletConnect project ID

The project ID (`config/walletconnect.json`) and the links to other places (`config/links.json`: `safe`, safe.wei's gateways, where Safe transactions are handed off and the footer links, the one on the same gateway family as the page being used; `source`, the source code) are built into their own tiny first chunk, cut at the `<!--config-->` marker, as in safe.wei. Replacing either changes only that chunk and the app contract; the other chunks keep their addresses, provided the rest is built from the deployed `src/` (tag the deployed commit). The steps are safe.wei's: `docs/deploy.md` → Replacing the WalletConnect project ID. The project must allow `roles.caza.la`, `*.roles-wei.pages.dev` and the gateway domains.

## Vanity address

As in safe.wei, the app contract's address starts with five zero hex digits (`0x00000…`, `VANITY` in `scripts/deploy-lib.mjs`): the app gets its own salt, mined deterministically by counting from 0 (about a million tries, seconds), while the chunks keep the plain salt and so their addresses. `scripts/deploy.mjs` and the deployer page plan the same address independently; `deploy/<chainId>.json` records `salt` and `appSalt`; `--no-vanity` turns it off. Any change to the app contract (a rebuild, a config-only redeploy) gives a new address, mined the same way.

## Cloudflare Pages

The same `dist/index.html` is published by CI to the `roles-wei` Pages project. Pull requests receive a branch preview; pushes to `main` update `roles.caza.la`. The workflow adds anti-framing, MIME-sniffing and referrer headers. Repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` authorize Pages, while `ALCHEMY_API_KEY` gives fork tests an archive RPC.

Never put a private key or Cloudflare token in shell history, the repository or the deployer page.

## Latest clean rehearsal

Rehearsed on a fresh mainnet fork (latest block) on 2026-10-01: the 208,660-byte page deployed in the config chunk plus 9 chunks and the app contract, at the mined vanity address, using **46,700,821 gas**, and `html()` matched `dist/index.html` byte for byte. At 0.4 gwei that is ~0.019 ETH, at 1.2 gwei ~0.056 ETH; fees are usually lowest on weekends.

- App: `0x00000179dddf4e99bfa509d50eee6d321024f788` (app salt `0x…09f847`; it changes with every rebuild)
- Content hash: `0x8d8afe431bf74658dfa316c9611f02e5f5ebc54d0d28ebfd560f036c1d1ebc38`
- Runtime code hash: `0x8502ba71d3ffcb9b4f070222aad3ed1042897376e2ea18c4c2ccd697bfd07b99`
