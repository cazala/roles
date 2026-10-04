# roles.wei: implementation plan

> The plan roles.wei was built from, kept for its model of Zodiac Roles and the decisions behind the design. Everything in it is implemented; for what the app does now, see the [README](../README.md) and the [guide](guide.md).

An onchain interface to **inspect, create and edit Zodiac Roles** (Roles Modifier v2) for Safes, served from an ERC-8244 `html()` contract at `roles.wei`. It is a sibling of [safe.wei](../safe) (`~/Code/safe`, github.com/cazala/safe): same principles, same look and feel, and it hands every Safe transaction to safe.wei through links.

Read these before writing code:

- [LEARNINGS.md](../LEARNINGS.md): what building safe.wei taught us (technical traps, process, the owner's preferences).
- [DESIGN.md](../DESIGN.md): the visual and interaction design roles.wei must match.
- [AGENTS.md](../AGENTS.md): working rules (commits, PRs, what not to break).
- safe.wei's `docs/links.md`: the stable link formats roles.wei uses to talk to safe.wei.

---

## 1. Principles (inherited from safe.wei, non-negotiable)

- **One self-contained HTML file.** No backend, no remote code, no fonts or images from anywhere, no analytics, no API keys. The build fails if the output references a remote resource.
- **Chain only.** Everything is read from contracts (`eth_call`, `eth_getLogs`, `eth_getCode`) through the connected wallet's RPC. When that RPC cannot serve the permission history (full nodes drop old logs or state), the scan continues through WalletConnect's RPC; RPC endpoints you add in Settings take every read on their chain; a wallet connected with WalletConnect reads through WalletConnect's RPC. No subgraph and no Zodiac API. Where a block explorer covers the chain (Blockscout or Routescan by default; Etherscan with a key, any Etherscan-compatible API, or None in Settings), the history comes from its index in a few requests; roles.wei still checks every event against the chain, but then trusts the explorer to return all of them. Every event is replayed locally.
- **Wallet signs.** roles.wei never holds a key.
- **Never guess.** Decode only what can be decoded exactly; show raw data otherwise. Every transaction a Safe must approve is reviewed in safe.wei, which checks the hash against the Safe and simulates it.
- **Small.** The page is stored onchain (~220 gas per byte). Budget: good < 100 KB, hard limit 300 KB raw.

## 2. How Zodiac Roles works (what the app must model)

Verified against `gnosisguild/zodiac-modifier-roles` (`packages/evm/contracts`). **Pin to the tag of the mastercopy you target**: `main` may be ahead of what is deployed (for example an `AbiType` enum with `Calldata` / `AbiEncoded` variants where 2.1.x releases call it `ParameterType`).

### Contracts and addresses

- The Roles Modifier is deployed per Safe as an **EIP-1167 minimal proxy** of a mastercopy, through Zodiac's **ModuleProxyFactory** (`deployModule(mastercopy, initializer, saltNonce)`, where `initializer` is `setUp(abi.encode(owner, avatar, target))`).
- Take mastercopy and factory addresses from `gnosisguild/zodiac` → `src/contracts.ts`, per chain, and record them (with the source commit) in `docs/research.md`. Do not copy them from memory. safe.wei's `src/zodiac.js` has a list of known mastercopies (Roles 1.0.0, 1.1.0, 2.1.0, 2.1.1, …) used to identify modules; reuse and cross-check it. Roles 2.1.0 is listed by the Zodiac team as faulty.

### Three addresses (set in `setUp`, changeable by the owner)

| | Meaning | Usual value |
| --- | --- | --- |
| `owner` | Can change every permission (`onlyOwner`) | The Safe itself |
| `avatar` | The account whose assets are used | The Safe |
| `target` | The contract the modifier calls `execTransactionFromModule` on | The Safe |

If `owner` is not the Safe (an EOA or another account), that owner can grant itself anything, so it effectively controls the Safe's assets. The UI must say so prominently.

### Lifecycle

1. **Deploy**: anyone, from any wallet, calls the factory. No Safe signature needed. Alternatively, put the factory call and step 2 in one Safe batch so the owners approve once.
2. **Attach**: the Safe calls `enableModule(roles)` on itself (a Safe transaction). safe.wei decodes it and shows its danger warning, which is correct.
3. **Configure** (`onlyOwner`): `assignRoles(module, roleKeys[], memberOf[])`, `setDefaultRole(module, roleKey)`, `allowTarget(roleKey, target, options)`, `revokeTarget`, `scopeTarget(roleKey, target)`, `allowFunction(roleKey, target, selector, options)`, `revokeFunction`, `scopeFunction(roleKey, target, selector, ConditionFlat[] conditions, options)`, `setAllowance(key, balance, maxRefill, refill, period, timestamp)`, `setTransactionUnwrapper(to, selector, adapter)` (lets role members batch through MultiSend), and `setAvatar` / `setTarget` / ownership transfer.
   - If `owner` is the Safe: every configuration change is a Safe transaction. roles.wei builds the calls, batches them through the canonical **MultiSendCallOnly** and opens safe.wei with a `#tx=` link (see §5).
   - If `owner` is the connected wallet: roles.wei sends the calls directly (a batch through MultiSendCallOnly needs a Safe, so send them one by one, or use `multicall` if the version has it; check).
4. **Use**: role members call `execTransactionWithRole(to, value, data, operation, roleKey, shouldRevert)` (or `execTransactionWithRoleReturnData`) on the Roles contract from their own wallets. No Safe signatures. Members of the default role can use `execTransactionFromModule`.

### Reading the configuration without a subgraph

The contract emits the whole configuration as events, so it can be rebuilt from logs:

- `RolesModSetup(initiator, owner, avatar, target)`, `AvatarSet`, `TargetSet`, `OwnershipTransferred` (check exact names at your tag)
- `AssignRoles(module, roleKeys[], memberOf[])`, `SetDefaultRole(module, defaultRoleKey)`
- `AllowTarget(roleKey, targetAddress, options)`, `RevokeTarget(roleKey, targetAddress)`, `ScopeTarget(roleKey, targetAddress)`
- `AllowFunction(roleKey, targetAddress, selector, options)`, `RevokeFunction(roleKey, targetAddress, selector)`
- `ScopeFunction(roleKey, targetAddress, selector, ConditionFlat[] conditions, options)`: the **full condition tree** is in the event
- `SetAllowance(allowanceKey, balance, maxRefill, refill, period, timestamp)`, `ConsumeAllowance(...)`
- `SetUnwrapAdapter(to, selector, adapter)`

Replay the events in order (block, then log index) to get the current state: later events override earlier ones for the same key. Live allowance balances come from the `allowances(key)` getter (refill accrues over time; compute the accrued balance the same way the contract does).

Log reading is the hard part, exactly as for safe.wei's pending-transaction scan:

- Find the module's deployment block by binary search on `eth_getCode` (or from the factory's `ModuleProxyCreation` event).
- Scan from there to `latest` in bounded windows (start at 5,000–10,000 blocks; halve on "range too large" errors; wallets' RPCs differ a lot).
- Cache decoded events per module in `localStorage` with the last scanned block, so the next visit only scans new blocks.
- Show progress and let the user continue ("Scanned to block N"), never a spinner that may never end.

### Conditions

`ConditionFlat[]` is a flattened tree: `{ parent (index), paramType, operator, compValue }`, in breadth-first order, root first (`parent == 0` for the root's direct children; check the exact convention and integrity rules in `Integrity.sol` at your tag). The UI needs:

- a **reader** that turns the flat list into a tree and shows it in words: "`recipient` equal to 0xabcd…", "`amount` within allowance *weekly-usdc*", "one of: …" (Or), "all of: …" (And);
- an **editor** that builds the tree from a function's ABI (the parameter structure must match the function's ABI: tuples, arrays, dynamic types) and flattens it back, running the same integrity checks as the contract before producing a transaction;
- operator coverage in phases: start with Pass, EqualTo, EqualToAvatar, GreaterThan / LessThan, WithinAllowance, EtherWithinAllowance, CallWithinAllowance, And / Or, Matches; then ArraySome / ArrayEvery / ArraySubset, Bitmask, Custom.

## 3. Screens

Same shell as safe.wei (header, breadcrumb, tabs; see DESIGN.md).

1. **Home**: a field to open a Safe (address or `.eth` / `.wei` name) or a Roles modifier address; saved Safes (reuse safe.wei's list: pin, rename, folders are optional, search is not).
2. **Safe → Roles modifiers**: the Safe's enabled modules (`getModulesPaginated`), each identified (Roles version, owner, avatar, target), with a warning when `owner` is not the Safe or the version is faulty. **Create a Roles modifier** (deploy + enable, see §4).
3. **Modifier → Roles**: one row per role (role key shown as text when it is a short string, else hex), with members count, targets count, allowances used. **New role**.
4. **Role**: members (add/remove), targets and functions with their conditions in words, allowances with live balances. Everything editable in place; edits accumulate as a **pending change set** (like safe.wei's batch), shown as a diff.
5. **Allowances**: all allowances of the modifier, balance / refill / period / next refill, and which roles use each.
6. **Apply changes**: the diff in words, then:
   - owner is a Safe → "Open in safe.wei to approve" (a `#tx=` link with call signatures, §5), plus **Copy link** for sending to signers;
   - owner is the connected wallet → send the transactions directly.
7. **Use a role** (for members): pick role, target, function (from an ABI you paste, as in safe.wei's Custom tab), fill parameters, see whether the current conditions allow it (simulate `execTransactionWithRole` with `eth_call` from the member), then send.

### Links

Every screen has a link, and `#draft=` links propose permission changes (often written by an agent) that load into the editor for a person to review and send; nothing is applied by a link. See [docs/links.md](links.md); `node scripts/draft-link.mjs plan.json --modifier 0x…` builds one. Agents: [skills/roles-wei/SKILL.md](../skills/roles-wei/SKILL.md).

## 4. Creating a modifier

- Form: owner (defaults to the Safe; warn when changed), avatar and target (default to the Safe), salt (random, editable, under Advanced).
- Predict the proxy address before deploying (factory CREATE2 formula; verify with an `eth_call` of the factory, as safe.wei does for new Safes).
- Two ways, explained side by side (like safe.wei's Sign / Approve onchain choice):
  - **One Safe transaction** (recommended): batch `factory.deployModule(...)` + `safe.enableModule(predicted)` (+ the initial roles) and hand it to safe.wei.
  - **Deploy now, enable later**: deploy from the connected wallet, then hand `enableModule` to safe.wei.

## 5. Talking to safe.wei

safe.wei's link formats are documented as stable in safe.wei's `docs/links.md`; use them, do not invent new ones.

- **Proposing a Safe transaction**: build the SafeTx (nonce = the Safe's current `nonce()`, unless the user picks a later one to queue), encode it with safe.wei's `src/share.js` (copy the file; it has no dependencies beyond `abi.js` and `safe.js`), and open `https://safe.wei.limo/#tx=<payload>` (or whichever gateway the user prefers; make the base URL a setting with a sensible default).
- **Readable review**: include the **call signatures** of every call you encoded in the link (the optional signature section of the `#tx=` payload; see safe.wei's `docs/links.md`). safe.wei decodes each call with them, but only if re-encoding reproduces the calldata byte for byte, so signers see "assignRoles(module, roleKeys, memberOf)" with values instead of raw hex. Use descriptive parameter names: they are shown to signers.
- **Batches**: use the canonical MultiSendCallOnly (safe.wei accepts no other batch target) with operation `DELEGATECALL`.
- **Getting signatures back**: nothing to do. Owners approve in safe.wei; once executed, roles.wei sees the new events.

## 6. Architecture

Copy safe.wei's structure and reuse its modules (they are small and dependency-free):

| From safe.wei | Use |
| --- | --- |
| `src/abi.js`, `src/keccak.js` | hex, ABI word helpers, keccak |
| `src/abicoder.js` | ABI parsing and encoding (and the decoder being added for link signatures) |
| `src/rpc.js`, `src/wallets.js` | EIP-1193 wrapper, EIP-6963 discovery |
| `src/chains.js` | chain labels, contract probing on connect |
| `src/names.js` | ENS / WNS resolution (mainnet only) |
| `src/ui.js`, `src/style.css` | `h()`, `put()`, icons, address display, copy buttons, sheets, all the styles |
| `src/share.js`, `src/safe.js` | SafeTx hashing and `#tx=` links |
| `src/multisend.js` | MultiSendCallOnly encoding |
| `src/zodiac.js` | module identification |
| `scripts/build.mjs`, `dev.mjs`, `shim.mjs`, `fork.mjs` | build (esbuild, single file, remote-resource checks, size report), dev server with an Anvil test wallet (or `--live`: a read-only wallet on the real chain, with Alchemy and Etherscan keys from `.env` kept server-side), fork harness |
| `scripts/deploy*.mjs`, `scripts/deployer/`, `contract/SafeWeiApp.sol` | CREATE2 deployment of the page chunks and the ERC-8244 contract, LAN deployer page |

Do not create a shared package yet; copy the files and note the safe.wei commit they came from in `docs/research.md`, so fixes can be ported both ways.

New modules: `roles.js` (ABI, event decoding, replay into state), `conditions.js` (flat ↔ tree, integrity checks, words), `scan.js` (bounded log scanning with cache), `diff.js` (current vs edited state → minimal list of calls, in the order the contract requires: targets before functions, etc.).

## 7. Phases (one PR each, merged before starting the next)

0. **Research**: pin mastercopy / factory / MultiSendCallOnly addresses per chain; pick a fork block with real Roles deployments (e.g. a DAO treasury managed with Roles, such as those set up by karpatkey / Gnosis Guild) for tests; write `docs/research.md` and `docs/spec.md`.
1. **Skeleton**: copy the build, dev server, fork harness, `ui.js` / `style.css`; header, wallet, Home; deployable empty app.
2. **Read**: identify modifiers on a Safe, scan and replay events, show roles, members, targets, functions (conditions as raw first).
3. **Conditions reader**: tree + words for the phase-one operators; allowances with live balances.
4. **Edit + diff**: pending change set, diff view, minimal call list; hand-off to safe.wei (`#tx=` with call signatures) and direct send for EOA owners.
5. **Create**: deploy + enable (one Safe transaction or two steps), predicted address.
6. **Use a role**: member execution with simulation.
7. **Conditions editor**: build conditions from an ABI, integrity checks.
8. **Polish**: mobile, empty states, errors in words, docs (`docs/guide.md`), size report, deploy to `roles.wei`.

## 8. Testing

- Unit tests (`node --test`) for condition flattening / unflattening, integrity checks, diff generation, event decoding (compare against `viem` encoders/decoders in tests only).
- Fork tests on Anvil (reuse safe.wei's `test/fork/anvil.mjs`; note that Anvil's default accounts are EIP-7702-delegated on mainnet and the harness clears their code): deploy a modifier for a demo Safe, configure a role through a Safe transaction, execute as a member, check allowances decrease and refill.
- Manual checks in the browser with the dev server's Anvil test wallet, including typing into every input (see LEARNINGS.md: a keydown handler once blocked all typing).

## 9. Deployment

Same as safe.wei (`docs/deploy.md` there): CREATE2 chunks + ERC-8244 contract, rehearse on a fork, LAN deployer page, verify `html()` byte for byte, test through gateways, then the owner of `roles.wei` points the name (`setAddr`). The name owner does the mainnet deploy and pointing; agents only prepare and rehearse.
