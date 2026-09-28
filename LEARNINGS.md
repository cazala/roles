# Learnings from building safe.wei

Everything below was learned the hard way while building safe.wei (`~/Code/safe`). Read it before writing roles.wei; most of it applies directly.

## 1. Working with the owner

- **Commits**: never GPG-sign (`git -c commit.gpgsign=false commit …`) and **never add Claude or any co-author / attribution trailers** to commits or PR descriptions, whatever a tool's default says.
- **One PR per feature or phase**: branch from `main`, commit, `gh pr create`, `gh pr merge --merge --delete-branch`, pull `main`. Never push to `main` directly (it happened once with a docs commit; it was a mistake).
- **Iterating by screenshots**: the owner reviews in the browser and sends screenshots with short notes ("the hover is weird", "this should be one line"). Fix exactly what was pointed at, look for the same problem elsewhere, check it in the browser, then report briefly: what changed, the PR link, anything not verified.
- **Wait when asked**: "do not commit until we figure out the right layout" means iterate in the working tree until they approve.
- **Design questions** ("what would a great designer do?") want a clear recommendation with the reasoning, often a short mock (ASCII is fine), then the implementation once agreed. Do not survey options without picking one.
- **Irreversible or outward-facing actions** (mainnet deploys, pointing the name, publishing) are the owner's. Agents prepare, rehearse on a fork and hand over exact steps.
- Keep the docs current with every feature (`README.md`, `docs/guide.md`, `docs/links.md`, `docs/spec.md`).

## 2. Traps that cost time

### DOM and CSS

- **Event handlers must not return `false`.** A keydown handler written as `(e) => e.key === 'Enter' && submit()` returns `false` for every other key, which cancels the keystroke: the input looked fine but you could not type. safe.wei's `h()` now wraps every handler and ignores its return value. **Test inputs by actually typing** (a real key-typing tool), never by setting `.value` from a script.
- **`false` and `0` as children** rendered as text. `h()` / `put()` skip `false`, `null` and `undefined`; write `n > 0 && …`, not `n && …`.
- **`class` in attrs replaced the tag's classes** (`h('button.link', { class: 'on' })`). It is additive now; keep it that way.
- **`[hidden]` loses to `display: flex`**. The global rule `[hidden] { display: none !important }` is required.
- **Scope styles by class, not tag**: `a.saferow` styles did not apply to the `div.saferow` folder rows.
- **`:only-of-type` counts element types**, not classes: a link next to a single button still made the button "only of type". Use explicit classes (`.solo`).
- **`overflow-x: clip`** on a container (needed for slide animations) cut the hover background of a child with a negative margin.
- **Table footers with `colSpan`** got squeezed by the table layout; a plain `div` under the table was simpler.
- **Inline rename** shifted the layout until the input used the title's exact font, size and line height, sized to its text with a canvas measurement.
- **Rows that are links** start the browser's native link drag, which cancels pointer-event drag and drop: set `draggable = false`, `preventDefault` on `dragstart`, and `-webkit-user-drag: none`, `-webkit-touch-callout: none` (iOS long-press preview).
- **Menus must close on outside clicks**: a document `pointerdown` listener was lost in a refactor and every menu stayed open. Keep one shared handler and test it after touching menus.
- **Shadowed names**: a local `const list = …` shadowed the imported wallet `list()` and blanked the page. Name locals distinctly.
- **Copy feedback**: show the ✓ immediately; do not wait for `navigator.clipboard.writeText` (it can hang or reject). The clipboard API needs a secure context: on a plain-`http` LAN address fall back to `document.execCommand('copy')`.

### Wallets and RPC

- **EIP-6963 plus `window.ethereum`** listed the same wallet twice (Rabby proxies `window.ethereum`). Once any wallet announces itself, drop the unnamed injected fallback. Wallets can also announce late: re-render when they do.
- **Wallet RPCs limit `eth_getLogs`** very differently (block ranges, result counts, history depth). Scan in bounded windows, adapt the window, say how far back the search went, offer "scan older", and cache results.
- **Never assume a contract exists on a chain.** Probe with `eth_getCode` at connect and enable features accordingly (safe.wei's `chainInfo()`).
- **Names resolve on Ethereum mainnet only** (ENS registry, WNS). On other chains, do not fail loudly: fall back to a saved address, or offer to switch chains. Refuse CCIP-read (offchain) records.
- **Every action that needs a wallet or a chain should ask for it and continue** ("connect, then open the Safe you clicked"). A red "Connect a wallet" error after a click was the owner's top complaint.
- **Chain switching**: `wallet_switchEthereumChain` fails with code 4902 when the wallet does not know the chain and 4001 when the user cancels; word both.

### Protocol

- **Compute selectors and hashes**, never type them from memory: two guessed selectors were wrong. Use `keccakText('fn(types)')`.
- **Verify what you sign against the contract**: safe.wei compares its SafeTx hash with the Safe's own `getTransactionHash` and disables everything on mismatch. Do the equivalent for anything roles.wei asks users to sign.
- **Only the canonical MultiSendCallOnly** is accepted as a batch target; any other DELEGATECALL is flagged as dangerous.
- **Decode only exact, canonical encodings** (re-encode and compare bytes); show raw otherwise.
- **Address poisoning**: short addresses are fine for browsing, but show full addresses wherever something is signed.

### Testing and tooling

- **Anvil's default accounts are EIP-7702-delegated on mainnet**, so on a mainnet fork they have code. The fork harness clears it (`anvil_setCode` to `0x`); without that, signatures and `msg.sender` checks misbehave.
- Pin `FORK_BLOCK` for reproducible fork tests; publicnode works for mainnet; Polygon and L2 forks need an archive RPC to live long.
- Use `viem` only in tests, as a reference implementation to compare against (encoders, hashes, typed data).
- Fork runs of the deploy script must never write the mainnet record (`deploy/1.json`); forks write gitignored `deploy/local-*.json`.
- The in-app browser's screenshots can be stale after scrolling. Verify layout with DOM measurements (`getBoundingClientRect`, `elementFromPoint`) or scroll to the top first.

### Build, size, deploy

- esbuild bundles everything into one HTML file; the build fails on any remote resource reference and above 200 KB raw. It prints a size report; keep `docs/size.md` updated per feature.
- The page is stored as 24,575-byte chunks (SSTORE2-style data contracts) behind an ERC-8244 `html()` contract, all through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`: addresses depend only on bytes and salt. Cost is roughly 220 gas per page byte. Pin per-transaction gas at 15,000,000 (EIP-7825's cap is 16,777,216).
- **Each gateway origin has its own `localStorage`** (`safe.wei.limo` and a `w3link` URL are different sites), which is why Backup & sync exists. Prefix keys (`roles.wei:`), wrap every access in try/catch, and never make storage required.
- Links are built from `location.href.split('#')[0]`, so they point at whichever gateway the user is on; the fragment is the payload and works on any gateway.

## 3. What the owner liked and disliked (UI)

Liked:
- One clear next step, chosen by who is looking (owner who has not approved / has approved / not an owner / ready to execute).
- Explaining states before the click (gates for no wallet, not connected, wrong chain).
- First-visit screen vs returning screen (the data becomes the page).
- Compact one-line rows, hover actions, search-or-open in one field, split button for the main action plus rare ones.
- Breadcrumb with a switcher instead of a "‹ Home" row.
- Short addresses with full address on hover and click-to-copy everywhere.

Disliked (all fixed in safe.wei; do not reintroduce):
- "name → address" pairs: show one name.
- Red text for things the user chose (a token they added) or expected states (not connected, unknown token).
- Important information buried mid-page (not being an owner) and important features at the bottom (sharing).
- Widths that do not match the header; content that stretches to one width while the header has another.
- Empty columns reserved for hover buttons; misaligned inline links; rounded corners on a split divider; hover backgrounds cut off or touching text.
- Long hint sentences (keep them to one line), hints that do not apply (a drag hint with one item), empty widgets (tabs with nothing in them).
- Chips that repeat what is visible elsewhere (chain, balance, version) in the header.
- A second, redundant back link when the header already goes Home.

## 4. How a feature was delivered

1. Read the relevant code; plan in a few lines.
2. Implement; `npm run build` (watch the size); run unit tests.
3. Check in the browser with the dev server and the Anvil test wallet: the actual states (owner, non-owner, not connected, no wallet, phone width), typing into inputs, hover states.
4. Branch, commit (no GPG, no trailers), PR, merge.
5. Rebuild the LAN deployer page (safe.wei's `scripts/deployer/serve.mjs`) and report the new app address, so the owner can test the exact build.
