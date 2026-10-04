# Implementation specification

Status: implemented. This was the contract and acceptance criteria for phases 1–8, all merged; later features (the in-place editor, draft links, Settings, Backup & sync) are described in the [guide](guide.md) and [links.md](links.md). Addresses, ABI and source revisions are pinned in [research.md](research.md).

## Runtime and trust boundaries

Ship one self-contained HTML file, vanilla JavaScript and CSS, no runtime packages or network resources. Chain reads use the selected EIP-1193 wallet, with three exceptions, all only through `src/net.js`: WalletConnect's RPC (a phone wallet cannot serve reads, and history the wallet's RPC dropped), RPC endpoints the user adds in Settings, and a block explorer's API (history and contract names in a few requests; every event is still checked against the chain). The explorers, the chains each covers and the default order (Blockscout, then Routescan) are data in the config chunk (`config/explorers.json`, the same format as safe.wei's, docs/spec.md §27f there), so they change without touching the code; the user's choice in Settings (Default, None, a provider, or any Etherscan-compatible URL with `{chain}`) overrides them. A provider that refuses a chain (or is rate-limited) hands the read to the RPC. Blockscout gives logs without a block hash: each is checked in its transaction's receipt from the chain instead, and a receipt no RPC serves stops the scan rather than skip an event. No public RPC URL, API key or dev wallet goes in the production build; the explorer URLs in the config chunk are the only built-in endpoints. HTTP RPC access in the research/fork tooling is development-only. Reject remote resource references and raw output above 300,000 bytes; target below 100,000 bytes.

Support reading identified contracts independently of creation dependencies. Creation requires the pinned 2.1.1 mastercopy and ModuleProxyFactory to have code on the current chain. Batching requires a MultiSendCallOnly address recognized by the pinned safe.wei. Recognize Roles 1.x and faulty 2.1.0 with clear version information; do not decode them as 2.1.1 or offer writes through the wrong ABI. Unknown implementations remain raw/read-only. A recognized address alone is not proof of arbitrary proxy compatibility: match the exact minimal-proxy runtime and implementation.

An owner different from the associated Safe can change all permissions. Display this prominently, including owner/avatar/target mismatches. An enabled module can move the Safe's assets without owner signatures. Enabling modules, unrestricted targets and delegatecall require explicit, full-address review. Roles does not automatically grant permissions just because a member is on its enabled-module list; retain both membership and module-enabled state.

## Shell, navigation and local data

Copy safe.wei `ui.js` and `style.css` verbatim first, with the provenance in research. Retain handler wrapping, additive classes, `[hidden]`, copy fallback, dialog and address behavior. Resolve their imports before deleting unused features. Keep the 820px shared header/page width, monochrome tokens and one primary action per screen from [DESIGN.md](../DESIGN.md).

Routes live in fragments: Home, Safe/modifier selection, a modifier's roles, an individual bytes32 role key, allowances, review, creation and execution. Canonicalize addresses; encode role keys losslessly. Route loading never initiates a transaction. A stale asynchronous result after route, wallet, account or chain changes must not render or submit against the new state.

Home uses one search-or-open input accepting an address, `.eth` or `.wei`; search filters saved entries without needing a wallet. Open navigates to the address's URL whatever the wallet state; that route shows a gate, as in safe.wei, for what it needs first (connect a wallet; switch chain when `?chain=` says so, or when the address is saved only on another chain, with an option to open it on the current one), then continues there. Names resolve only through the mainnet wallet, with no CCIP fetches. On other chains use a saved resolved address or offer switching. Reuse the saved-list interaction, not cross-origin storage assumptions: roles.wei cannot read safe.wei.limo's localStorage. A future explicit backup import may copy compatible Safe entries. Prefix every key `roles.wei:` and guard all storage operations; persistence is optional.

## Chain snapshot and scanning

Choose a block number/hash at the beginning of each load. Read code, owner/avatar/target, Safe modules, default roles and allowances at that same block; use that block's timestamp for balances. Traverse `getModulesPaginated` from the sentinel `0x0000000000000000000000000000000000000001`, bounded page sizes, rejecting repeated cursors. Keep non-Roles modules visible as identified/unknown rows rather than treating them as Roles.

Discover deployment through historical code binary search only if the RPC supports historical state. Otherwise use factory creation logs or a user-specified start block, visibly marking incomplete history. Failure to read history is not an empty configuration. Scan address-filtered logs in windows initially 5,000 blocks, halving for range/result-limit errors down to one block. At one block, stop with an actionable error instead of looping. Separate transient retries (bounded) from unsupported history. Expose scanned block, target block, pause/cancel and resume; cancellation never advances the cursor beyond completely decoded windows.

Cache canonical decoded events plus raw evidence, schema/ABI revision, chain ID, module address, deployment/start block and last-complete block/hash. Deduplicate by block hash/transaction hash/log index and replay ordered by block number, transaction index and log index. Check the cached block hash before resuming. On mismatch, discard the affected cache and rescan; a full reset is acceptable initially. Do not present partially scanned state as complete or create an editable baseline from it. Never skip a malformed known event and advance the cursor silently.

## State and replay

State contains modifier metadata; an enabled-member set; default roles by member; roles keyed by exact bytes32; targets keyed by address; functions keyed by exact bytes4; allowances keyed by bytes32; unwrap adapters keyed by `(to, selector)`. Role display names are reversible short UTF-8 strings with zero padding, otherwise full hex. Reject invalid UTF-8, embedded padding and non-round-tripping names. There is no onchain role list or create-role transaction: roles are discovered from membership and permission events; a new empty role is local until a meaningful change is applied.

`AssignRoles` overwrites only its named member/key pairs, and automatically enables that member if disabled, including when all supplied membership flags are false. Replay `EnabledModule` and `DisabledModule` as separate state. `SetDefaultRole` does not grant membership. Ownership, avatar and target events update their own values; getter reads cross-check current metadata.

`AllowTarget`, `ScopeTarget`, and `RevokeTarget` overwrite target clearance/options only. **They do not erase function entries.** Keep dormant function permissions: scoping a target again can reactivate them. `AllowFunction` replaces conditions with unrestricted function access, `ScopeFunction` replaces conditions/options, and `RevokeFunction` deletes only that selector. Diff and review must reveal previously stored permissions that a target-level change would reactivate.

The configuration events and their exact indexed fields come from `config/roles-2.1.1.abi.json`. Most permission events have no indexed arguments; do not filter roleKey as a topic. Setup indexes initiator/owner/avatar; ownership/avatar/target change events index both addresses. Decode dynamic arrays/tuples canonically and verify by re-encoding. Preserve unknown events without inventing semantics.

## Conditions and allowances

Use the pinned `ParameterType` and operator numbers from research, never an enum ordinal inferred from a later release. Preserve the original flat array for exact round trips. Reader coverage initially includes Pass, And/Or, Matches, EqualToAvatar, EqualTo, unsigned greater/less comparisons and all three allowance operators. Show unimplemented operators and comparison bytes raw without implying that they allow or deny a call. ABI names and token units require supplied, structurally compatible metadata; otherwise use parameter positions and raw integers.

Editor validation follows both `Integrity.sol` and `Topology.sol` at the pinned source. Require a nonempty tree, exactly one self-parent root at index zero, valid earlier parent indices for every other node, nondecreasing parent indices (BFS), uint8 parent indices, correct parameter/operator combinations, compValue lengths and child counts. The root's resolved type tree must be Calldata; logical roots are possible. Logical siblings and array element type trees must be compatible, including the contract's asymmetric Dynamic/Calldata/AbiEncoded compatibility. Ether/Call allowance nodes must have a Calldata parent. Reject placeholders. Derive ABI structural children, tuple/array shapes and comparison encoding rather than accepting an arbitrary flat list as valid.

Do not impose a guessed total-node limit merely because parent is uint8: parent indices must fit; any additional editor limit must be stated as an app limit. Compare accepted/rejected cases with the deployed Integrity validation through simulated `scopeFunction`. Fixed arrays, nested tuples and dynamic offsets need contract-backed tests before enabling editing.

`allowances(key)` returns `(refill, maxRefill, period, balance, timestamp)`, unlike `SetAllowance`'s `(key, balance, maxRefill, refill, period, timestamp)`. Read live storage at the snapshot block: consumption logs alone cannot recover the refill timestamp. If period is zero or the next interval has not elapsed, keep balance and timestamp. Otherwise compute elapsed whole intervals, advance timestamp by those intervals, and add refill only when balance is below maxRefill, capping at maxRefill. Preserve a balance already above maxRefill. Match Solidity checked uint128/uint64 arithmetic, reporting overflow instead of showing a spendable balance the contract would reject. Setting maxRefill zero means uint128 maximum; setting timestamp zero means the execution block timestamp. Show those meanings before approval.

## Editing and application

Maintain immutable baseline and editable draft with local undo. Generate a deterministic minimal call list from their semantic difference. Deduplicate membership changes per member; reject unequal arrays. Preserve dormant function state unless the user explicitly deletes it. Set allowances before functions referring to them, target clearance before function changes, membership/default-role changes in a stable order. Ownership transfer comes last; do not generate subsequent onlyOwner calls that will fail. Avatar/target changes invalidate any previous simulation and warning context.

Review describes additions, removals, permission widening and any reactivated functions, with full addresses, exact amounts and calldata available. Re-read ownership, chain, account, baseline metadata and relevant state before submission; require a refreshed diff when the baseline has changed. Never mutate cached confirmed state just because a link was opened or a transaction was sent.

When the modifier owner is a verified Safe, target that owner's Safe address, even when it differs from avatar or the Safe used to discover the modifier. Read its nonce, build the transaction using copied safe.wei codecs, include human-readable call signatures with descriptive names, and open `https://safe.wei.limo/#tx=<payload>` by default. A validated gateway setting can change only the base; reject executable URL schemes. One call uses CALL directly; multiple calls use canonical MultiSendCallOnly and outer DELEGATECALL, with CALL for every inner call. Do not substitute MultiSend, unrecognized batch addresses or an invented link format. Provide Copy link. Never claim approval/execution happened in roles.wei; refresh from chain.

When owner equals the connected wallet, simulate and send each call in order, awaiting a successful receipt before the next. Roles 2.1.1 has no multicall. Show progress and confirmed partial completion; rejection/failure stops the sequence and refreshes the remaining diff. Other contract owners get an unsupported-owner explanation and inspectable calls; do not assume every owner with code is a Safe or a directly usable wallet.

## Creation and member execution

New modifiers use Roles 2.1.1 and factory 1.1.0. Default owner/avatar/target to the Safe, reject zero addresses in this UI and explain changed ownership. Use a random uint256 salt editable under Advanced. Predict CREATE2 exactly as research specifies and compare against the factory `eth_call` result from the actual sender. A collision requires a new salt, not reuse of an existing contract. Simulate the final complete Safe batch where possible; initial permission calls work only if the Safe is the configured owner.

Recommended creation is a single Safe batch: deploy then `enableModule(predicted)`, then optional initial permissions. Alternative is a connected-wallet deploy, verify receipt/proxy/metadata, then hand only enableModule to safe.wei. If enabling is delayed, keep an explicit deployed-but-not-enabled state. Deploying alone does not let the modifier use Safe funds.

For member execution, pick an exactly identified 2.1.1 modifier and a membership, encode the selected ABI function, show role/target/value/data/operation, and simulate `execTransactionWithRole(..., shouldRevert=true)` from the actual member at current state. Decode and require successful return, not merely absence of a transport error. Simulation is advisory: re-simulate immediately before sending and invalidate on account/chain/input changes. Member sends directly to Roles; never send the underlying call to the target from the wallet. Value describes funds used by the Safe; do not attach that amount as wallet msg.value to the nonpayable Roles method.

## Acceptance gates by phase

| Phase | Required result before its PR is merged |
| --- | --- |
| 0 | Immutable source/address/ABI pins, real fixture, research, spec, reproducible RPC evidence and size status |
| 1 | Single-file build and size guard, copied shell, wallet discovery/connect, searchable saved Home, dev-only Anvil wallet, deployable ERC-8244 empty app |
| 2 | Safe module pagination, exact identification/warnings, resumable scan/cache/reorg behavior, role/member/target/function views; incomplete scans cannot look empty |
| 3 | Condition tree and honest words/raw fallback; storage-backed allowance accrual verified at boundaries |
| 4 | Reversible draft/diff, minimal ordered calls, safe.wei link round trip with signatures, sequential direct sends and partial failures |
| 5 | CREATE2 prediction equals factory simulation, fork-tested deploy/enable both ways, collisions and non-Safe owner handling |
| 6 | Actual member call simulation and execution, denied cases, downstream revert, allowances consumed/refilled |
| 7 | ABI-derived condition editor, BFS round trip and contract-equivalent validation with nested/dynamic cases |
| 8 | Phone and empty/error states, guide/size/deploy docs, fork deployment rehearsal and byte-for-byte html() verification; owner performs mainnet deployment/name update |

Each phase is one branch/PR, merged before the next begins. Tests use `node --test` and viem only as a development reference. Fork fixtures clear Anvil accounts' inherited EIP-7702 code, pin the block, and never write mainnet deploy records. Browser checks use the Anvil wallet, actually type in every input and cover disconnected, owner, non-owner, wallet/account/chain changes and phone layout. Phase 0 has no browser UI to exercise. Later phases keep README, docs and the generated size report current.
