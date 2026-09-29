# Working rules for agents (roles.wei)

- **Commits**: `git -c commit.gpgsign=false commit`. Never add Claude, a co-author or any attribution trailer to commits or PR descriptions.
- **Flow**: one branch and one PR per feature or phase; merge it (`gh pr merge --merge --delete-branch`) before starting the next. Never push to `main`.
- **Principles**: one self-contained HTML file; no remote resources, no backend, no API keys; reads through the wallet's RPC, with two exceptions, both only through `src/net.js` (the build enforces it): a wallet connected with WalletConnect reads through WalletConnect's RPC, reads go to an RPC endpoint the user added in Settings for that chain, the history continues through WalletConnect's RPC when the wallet's RPC does not keep old logs or state, and, only with a key the user gave, logs come from Etherscan's API; all of it in `src/reads.js` (an indexer, trusted to return every event; said so in the UI); the build must stay under 200 KB raw.
- **Design**: match safe.wei exactly (see [DESIGN.md](DESIGN.md)); start from safe.wei's `src/style.css` and `src/ui.js`.
- **safe.wei links are a contract**: use `#tx=` exactly as documented in safe.wei's `docs/links.md`; do not invent parallel formats. If a new capability is needed, propose it for safe.wei first.
- **Verify** in the browser with the Anvil test wallet, including typing into every input (see [LEARNINGS.md](LEARNINGS.md)).
- **Mainnet deploys and pointing `roles.wei`** are done by the owner. Rehearse on a fork and hand over exact steps.
- Keep `README.md`, `docs/` and the size report current with every PR.
