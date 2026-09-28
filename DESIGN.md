# roles.wei — design

roles.wei must look and behave like safe.wei, as if it were another section of the same product. The simplest way to get there: **start from safe.wei's `src/style.css` and `src/ui.js` verbatim**, then add only what Roles needs, following the patterns below. Screens to study in safe.wei (run its dev server, see its README): Home (first visit and returning), a Safe page with every tab, the review screen for an owner and a non-owner, Backup & sync, the Labels sheet, and the phone layout.

## 1. Character

- **Quiet and dense.** A tool for people handling real funds: no illustrations, no gradients, no marketing. Hierarchy comes from type weight, spacing and one accent (the foreground color), not from color.
- **Monochrome.** Colors carry meaning only: green = done / good, yellow = attention, red = real danger. Never decorate with them.
- **Plain words.** Say what happens and what to do next. "Your approval is needed", "Send this to the owners", "3 of 5 owners". No jargon when a word will do; keep protocol names (DELEGATECALL, EIP-712) for details and warnings.
- **One obvious next step.** Every screen has at most one primary button. Secondary actions are plain buttons or links; rare ones hide behind a caret or "More".

## 2. Tokens

Light and dark follow `prefers-color-scheme`; nothing else is themed.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--fg` | `#111` | `#e8e8e8` | text, primary button background, focus |
| `--bg` | `#fff` | `#111` | page, inputs, hover inside cards |
| `--mut` | `#666` | `#999` | secondary text, labels, icons at rest |
| `--line` | `#ddd` | `#333` | every border and divider (1px) |
| `--card` | `#f6f6f6` | `#1b1b1b` | cards, panels, menus, hovered rows |
| `--ok` | `#0a7d32` | `#4cd07d` | ✓ states, "You're an owner" |
| `--bad` / `--badbg` | `#b00020` / `#fde8ea` | `#ff6b7f` / `#3a1016` | real danger only |
| `--warnbg` | `#fff4d6` | `#3a2e0c` | warnings (yellow background, normal text) |

- **Type**: `15px/1.45 system-ui, sans-serif` for everything; `ui-monospace, Menlo, monospace` at 12–13px for addresses, hashes, calldata and inputs that take them. Titles: page title 22px bold, section `h2` 16px, `h3` 14–16px. Secondary text 13px; hints 12–13px.
- **Radii**: 4px small controls (legacy buttons, inputs), 6–8px buttons and inputs in newer UI, 10–12px list cards and panels, 14–16px dialogs, 999px chips and pills.
- **Spacing**: 8px rhythm (4, 8, 12, 14, 16, 18, 24). Page gutter 16px (12px on phones).
- **Icons**: inline SVG strokes, 24px viewBox, `stroke-width` ~2, drawn at 14–18px, color `currentColor` (muted at rest, fg on hover). Defined as path arrays in `ICONS` in `ui.js`; add new ones there. No icon fonts, no emoji as icons (✓ is text, used for done states).

## 3. Layout

- `body` max-width **820px**, centered; the header and every page share that width, so edges line up. Centered narrow cards (first visit, gates) are the exception.
- **Header**: brand (shield icon + name) left, then a **breadcrumb** on inner pages (`safe.wei / Council ▾`, where the caret opens a switcher); on the right, contextual buttons (the batch counter), then the account button (chain name muted, a divider, short address). Bottom border 1px.
- **Pages**: title row (name + pencil to rename), one quiet meta line (short address with copy · facts separated by `·`), then tabs (`nav.tabs`: text tabs with a 2px underline on the active one), then content.
- **Lists**: one card (`.slist`: 1px border, 12px radius, card background) with rows separated by 1px lines. Rows are 44–48px tall, one line: name bold, short address muted, chips only when informative, grow, hover actions, chevron if it navigates. Nested rows indent their content, not the row, so hover and dividers span the full width.
- **Tables** (balances): header row muted 13px, figures right-aligned with `tabular-nums`, flush right; row actions sit next to the name, not in an empty column.
- **Phones** (< 600px): same structure, bigger touch targets (inputs 16px to avoid zoom), hover actions always visible, dialogs become bottom sheets, the batch becomes a bar fixed to the bottom.

## 4. Components (all in safe.wei's `ui.js` / `style.css`)

- **`h(tag, attrs, ...children)`**: the only DOM helper. `tag` is `'div.class.other'`; `class` in attrs is additive; `false`, `null` and `undefined` children are skipped (use `cond && node`). Event handler return values are ignored on purpose (see LEARNINGS.md). `put(el, ...children)` replaces an element's content.
- **Buttons**: default (bordered, card background), `.primary` (fg background, bg text; one per screen), `.link` (underlined muted text for tertiary actions), `.ib` icon buttons (30px square, borderless, muted → fg on hover). A **split button** (`+ New | ▾`) joins a main action and a caret menu in one bordered control, with a straight divider.
- **Menus** (`.hmenu`): small card under their trigger, 4px padding, rows of icon + label, close on any click outside and on choosing an item.
- **Dialogs** (`sheet(icon, title)`): header with an icon in a circle, title, close ×; body padding 20px; bottom sheet on phones; backdrop blur. Used for Labels, Backup & sync, label editing.
- **Cards and panels**: `.panel` (14px radius, 16–18px padding) for forms, `.step` (12px radius, 18px padding) for the "next step" card, `.opt` for side-by-side choices (two columns, stacked on phones).
- **Chips** (`.chip`): pill, 1px border, 12px muted text; `.ok` / `.warn` / `.bad` variants. Use sparingly: facts that change what you do (chain differs, queued, payable).
- **Notes**: `p.warn` (yellow background) for attention, `p.bad` (red background, bold) for danger, `p.danger` (2px red border, 16px) for "DANGEROUS: ..." banners, `p.onote` (bordered muted note) for role explanations like "This wallet isn't an owner…".
- **Details**: `<details>` with a custom rotating chevron, a top border, and a medium-weight summary, for "Advanced" and "Transaction details".
- **Hover actions**: `.acts` / `.racts` at `opacity: 0`, shown on row hover or focus-within, always shown on touch (`@media (hover: none)`).
- **Empty states**: one centered muted sentence that says what will appear and how ("Safes you open will be listed here.").
- **Gates** (`gateCard`): a centered card with a shield mark, a title that says what is needed ("Connect a wallet to open Council"), one line of why, and the action. Used for no wallet, not connected, wrong chain. Never a red error for an expected state.

## 5. Addresses, names and copy

These rules are the same everywhere; reuse `addr()` from `ui.js`:

- An address shows **one** name: the viewer's label, else its ENS / `.wei` name, else the address. Never "name → address".
- Addresses show **short** (`0xabcd…ffff`) with the full address on hover (`title`). Clicking the address copies it and animates the copy button (icon → ✓ for 1.2s). Every address has a copy button and a tag button (label it).
- **Where something gets signed or approved, addresses show in full** (wrap the area in `.fulladdr`): look-alike addresses share their first and last characters. In roles.wei that means the diff before applying, and anything that becomes calldata.
- Hashes and calldata show in full, monospace, wrapping anywhere, with a copy button.
- Amounts: `fmtShort` (two decimals, thousands separators) in lists, exact on hover; exact everywhere a user confirms.

## 6. Interaction patterns to reuse

- **First visit vs returning**: explain the product and offer the ways in when nothing is saved; once there is data, the page is the data, with one search-or-open field on top.
- **Say what is needed before the click**: if an action needs a wallet, a connection or another chain, say so near it, and make the action do it (connect, switch chain) and then continue to what was asked.
- **Pending changes**: like safe.wei's batch, collect edits and show a counter; one place to review, then one hand-off. For roles.wei, the change set is a diff: "+ allow `transfer` on USDC for role *treasurer* with `amount` within *weekly-usdc*", "− remove member 0xabcd…".
- **Role-based next step**: after building something, show the one thing to do next for whoever is looking (owner of the modifier is the Safe → "Open in safe.wei to approve" / "Copy link for the signers"; owner is you → "Apply").
- **Undo over confirm** for local, reversible actions (remove from list → "Removed. Undo"); **confirm** only for destructive, irreversible ones (replace all data from a backup).
- **Inline rename**: the title becomes an input of the same font and size, sized to its text, so nothing moves; Enter saves, Escape cancels, blur saves.
- **Drag and drop** (if used): pointer events, a 6px threshold on mouse, 350ms long-press on touch, `draggable = false` on rows that are links (the browser's link drag cancels pointer drags), drop targets before / after / onto.

## 7. Voice

- Sentence case everywhere (buttons, titles, menu items).
- Titles say the state or the task: "Your approval is needed", "Ready to execute", "Connect a wallet to open Council".
- Explanations are one or two short sentences, second person, present tense: "Your wallet signs the transaction hash. The signature is added to the link you share; nothing goes onchain."
- Costs are stated plainly next to the choice: "free", "costs gas".
- Numbers in words where they are the point: "3 of 5 owners", "1 more needed".
- Red text only for danger that should stop the user. Information a user chose themselves (a token they added, an unknown token) is muted, not red.
