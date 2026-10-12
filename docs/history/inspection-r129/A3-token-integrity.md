> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r129/A3-token-integrity.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R129-A3 — Design-Token Integrity: index.css ↔ DESIGN.md ↔ usage (post-R128)

**Agent:** R129-A3 (design-token integrity — READ-ONLY) · **Repo:** main @ `76017f4`, tree clean
**Method:** full read of `frontend/src/index.css` (1,461 lines) + `frontend/DESIGN.md` (326 lines); a Node HSL→hex script (`/tmp/r129a3/parity.mjs` + `coverage.mjs`) that parses the `:root` and `.light` blocks, resolves `var()` aliases, and computes every token's hex both ways against all 65 DESIGN.md color entries; ripgrep censuses of every new token family (definitions ×3 blocks, all Tailwind consumption forms incl. alpha suffixes, test pins); raw-palette census of all of `frontend/src` (22 hue families **incl. green/pink** — the mission list omitted green, which hides the wallet libyana pair); `git diff 7d469d5..76017f4` hunk censuses for z/radius/shadow/spacing adds; **empirical** `impeccable@4.1.0` runs (the R128-A1 npx cache binary — no install, no network) against the real tree in the exact CI geometry and against scratch copies in `/tmp/r129a3/` for A/B tests.
**Prior coverage respected:** R129-A1's known item (DESIGN.md dark `tier-silver: "#acbac3"` should be `#acb6c3`) is **not re-reported** — it is only restated inside the verified-OK tally as the 1-of-56 known mismatch. Everything else below is new.
**Safety:** zero source/config/test modifications, zero git mutations, zero installs (the impeccable engine was already in `~/.npm/_npx/1ab13af667372dcc/` from R128-A1's session and was only *executed read-only*; all mutation experiments ran on `/tmp` scratch copies). Only this report + the worklog entry were written.

---

## 0. Executive summary

The **token spine itself is in excellent shape**: all 16 new R128 tokens are defined in both theme blocks + `@theme`, all have live consumers, zero dead tokens, zero missing-theme fallback bugs, and the admin migration is complete and test-pinned. My independent recomputation of all 65 DESIGN.md color entries found **no hex error other than the known tier-silver typo** — including the 6 light-theme entries (status-purple, destructive-surface, status-success-surface, tier-bronze/silver/platinum) that R129-A1's 37-dark+13-light script did not reach, and the 9 brand-mark literals.

What R128 actually broke is **the enforcement layer and the published contract's edges**:

1. **The CI impeccable gate is RED at HEAD** — `impeccable@4.1.0 detect frontend/src/` exits **2** (bounce-easing, `index.css:840`): R128's "A1-F4 fix" moved the waiver comment to its own line (841) instead of onto the bezier's line, so the disable-line never associates. The fix is one line-move, empirically verified to produce exit 0.
2. **The `.impeccable/config.json` that shipped is a no-op** — `{"ignoreFiles": […]}` is missing the required `detector` wrapper; the 3 test-file false-positives it was supposed to clear still fire (advisory-only, but the CHANGELOG claim "Adopted by the `.impeccable` config as its token feed" is not real).
3. **DESIGN.md's `error` entry is a two-token chimera** (dark value = `--destructive`, light value = `--status-error`) and `--status-error`'s dark hex `#ec5151` is documented nowhere.
4. The light theme is under-published in DESIGN.md (9 `--cat-*` light values + `tier-gold` have no YAML entries) despite the "every semantic token has a light twin" claim.

**Counts: P0: 0 · P1: 1 · P2: 1 · P3: 3 · P4: 4.**

---

## 1. index.css ↔ DESIGN.md parity, both ways

### 1.1 Method

`/tmp/r129a3/parity.mjs`: parses `:root` (`index.css:125-276`) and `.light` (`:279-403`), resolves `var()` aliases (e.g. `--tier-gold: var(--status-warning)`), computes hex via standard HSL→sRGB (Math.round), and compares against every `colors:` entry in DESIGN.md's YAML frontmatter (`DESIGN.md:10-81`). 65 entries total: **37 dark + 19 light + 9 brand/neutral literals**.

### 1.2 DESIGN.md → index.css (all 65 entries)

| Group | Entries | Verdict |
|---|---|---|
| Dark semantic (background, surface×3, foreground, on-surface, border, primary, primary-text, on-primary, secondary, on-secondary, muted, muted-foreground, input, ring, error, on-error, success, warning, info, low-stock, status-purple, destructive-surface, status-success-surface, tier-bronze/silver/platinum) | 28 | **27 byte-exact**; 1 mismatch = tier-silver `#acbac3` vs computed `#acb6c3` (215 16% 72%) — **KNOWN (R129-A1), not re-reported** |
| Dark cat-* (streaming, music, software, vpn, ai-tools, seo-tools, education, gaming, productivity) | 9 | **9/9 byte-exact** (#ad70eb, #42d791, #6c9ae5, #4cbcf0, #d87de8, #f0784c, #f5c147, #55a3f6, #f7b23b) |
| Light (background, surface-card, foreground, border, primary, primary-text, muted-foreground, secondary, error, success, warning, info, low-stock, status-purple, destructive-surface, status-success-surface, tier-bronze/silver/platinum) | 19 | **19/19 byte-exact** — including the 6 entries R129-A1's 37+13 script did not cover (light-status-purple #5d22c3, light-destructive-surface #dc1818, light-status-success-surface #1d724a, light-tier-bronze #916308, light-tier-silver #586174, light-tier-platinum #135eae) |
| Brand/neutral literals (whatsapp, whatsapp-ink, google-blue/green/yellow/red, telegram, black, white) | 9 | **9/9 match their source sites byte-for-byte** (index.css:98-99; AuthProviders.tsx:40-52,60,84; provider-card.tsx:64-82; TelegramLoginButton.tsx:106; profile.tsx:445; MetaTags.tsx:68-69) |

**Bottom line: 64/65 entries are byte-exact; the single exception is the known tier-silver item.** The "verify the other 49" mandate is satisfied and extended: 65 checked, not 50.

**But one entry is semantically incoherent (A3-3 below):** `error` (DESIGN.md:28) = `#ea3e3e` = **dark `--destructive`** (0 80% 58%, index.css:206), while `light-error` (DESIGN.md:60) = `#bb1b1b` = **light `--status-error`** (0 75% 42%, index.css:346). No single token matches the pair:

| Token | Dark | Light |
|---|---|---|
| `--destructive` (index.css:206/:372) | #ea3e3e | #dc1818 |
| `--status-error` (index.css:165/:346) | **#ec5151 — documented NOWHERE in DESIGN.md** | #bb1b1b |
| DESIGN.md `error`/`light-error` pair | #ea3e3e | #bb1b1b |

Every other two-theme entry in the file documents one token's two values; the error pair documents two different tokens. A designer or tool consuming "error" dark+light gets inks from different families, and `--status-error`'s dark value (the ink actually used by StatusBadge `error` pills, `status-badge.tsx:33`) is unpublished. (`--destructive`'s light ink #dc1818 is reachable only via the `light-destructive-surface` alias, which is the same channel value.)

### 1.3 index.css → DESIGN.md coverage (theme coverage gaps)

Every color token in both blocks was checked for a same-value entry (`/tmp/r129a3/coverage.mjs`). Verdicts:

- **Value-covered (fine):** `--card`/`--card-foreground`/`--card-border`/`--accent`/`--accent-foreground` dark and light, `--primary-foreground` light, `--muted` light, `--input` light, `--ring` light, `--surface-overlay` light (= white) all resolve to hexes that ARE published under another name. The `--primary-border`…`--destructive-border` computed-border derivatives (index.css:256-275) are derived, not palette.
- **Genuine gaps (A3-4):**
  - **9 light `--cat-*` values (index.css:317-325) have no YAML entries at all** — #802dd2, #1e764d, #2362c7, #116d97, #a32eb8, #b83c0f, #886107, #1877dc, #da8e0b. The prose (DESIGN.md:238-240) says "each has a dark-tuned (lighter) and light-tuned (darker) value" — the values themselves are unpublished.
  - **`tier-gold` has no dedicated entry** in either theme — the family is 4 tokens, DESIGN.md ships 3 (DESIGN.md:38-40, :68-70). It is value-covered (gold aliases `--status-warning`, index.css:223/:382, so `warning`/`light-warning` carry the hexes), but a tooling/consumer asking for the tier family gets ¾ of it.
  - **Light ink-on-secondary `#29303d`** (`--secondary-foreground`/`--accent-foreground` light, 220 20% 20%) has no entry (dark `on-secondary` #f8fafc is published).
  - `--status-error` dark #ec5151 (see §1.2).

### 1.4 Non-color claim drift (DESIGN.md prose vs index.css)

Verified TRUE: dark-default mechanics (`:root` + `color-scheme: dark`, `.light` class — DESIGN.md:5-9, 225-228 ✓); type ramp 11→60 + fluid clamps (:115-116, :959-964 ✓); weights 400/600/700 ✓; mono stack (:238 ✓); 320px floor (:458 ✓); 44px `.touch-target` (:1055-1058 ✓); 60px `--mobile-nav-h` (:182 ✓); toast chrome claims (16px panel :1198, 1px strip :1243, 14% bubble :1259, "8–11px inner chips" :1302/:1258/:1338 ✓); button recipe/sizes 32/36/48 (button.tsx:14, 34-40 ✓); `bg-destructive-surface` destructive variant (button.tsx:18-19 ✓); ProductCard 10–12% tints ✓; selection/caret ✓.

**Drift (details in A3-7/A3-8):**
- "dark shadows are heavier: **40–60%** black" (DESIGN.md:281-282) — actual dark stack range is **32–60%** (the two-stop shadows' second stops run 0.32–0.42, index.css:244-248). Light "6–14%" ✓ exact.
- "the only sanctioned colored light is the primary at **20–40%** alpha" (:245-246) / "`shadow-primary/25–40`" (:284-285) — actual live suffixes are **5–45** (`shadow-primary/5` tickets.tsx:589, `/10` dashboard.tsx:773 — **added by R128 itself**, `/20`/`/22`/`/25`/`/30`/`/40` widely, `/45` Logo.tsx:27); and status-colored shadows (`shadow-status-warning/10`, `shadow-status-low-stock/15`, dashboard.tsx:773; `shadow-status-*` ×8 per the R128-A1 census) exist unmentioned.
- Category accents "at low alpha tints (**10–15%**)" (:238-239) — actual suffix set is **{4, 10, 12, 15, 22, 25, 30, 45, 55, 70}** (ProductCard.tsx:80-135 uses /4 /10 /12 /22 /55; category.tsx:58-124 uses /10 /15 /25 /45 /70; product.tsx:67-77 uses /30 /15).
- StatusBadge recipe "border-`/28`" (:303) — the `warning` variant uses `/30` (status-badge.tsx:32); also the admin D1 maps ride a /10 + /20 recipe (system.tsx:181-204, alerts.tsx:67-113 — "alphas preserved byte-for-byte" per the R128 migration note), so two pill recipes coexist.
- **The `rounded:` YAML labels are shifted vs the CSS token names** (DESIGN.md:192-199 vs index.css:118-121): YAML says `sm: 4px, md: 8px, lg: 10px, xl: 12px`, but the stylesheet defines `--radius-sm`=8, `--radius-md`=10, `--radius-lg`=12, `--radius-xl`=16 (bare `rounded` = Tailwind default 4px). The seven *values* are the true effective scale; the *names* tell a designer the wrong class for each value (a tool mapping `rounded.sm`→`--radius-sm` would expect 4px and get 8px). See A3-8.

---

## 2. Orphan/usage census of the NEW R128 tokens (16)

Definitions verified in **all three** places for every token: `:root` block, `.light` block, `@theme` Tailwind exposure (index.css:64-92). Consumption counted across `frontend/src` excluding index.css and tests, in every utility form (bg/text/border/ring/shadow/from/via/to + hover:/group-hover: variants + alpha suffixes).

| Token | :root / .light / @theme | Production consumers (files) | Class-uses | Alpha suffixes seen | Verdict |
|---|---|---|---|---|---|
| `--status-success-surface` | :217 / :378 / :87 | topups.tsx approve buttons | 6 | /90 (hover) | LIVE + pinned (admin-palette-tokens.test.ts:101-108, design-system-css.test.ts:242,244) |
| `--status-purple` | :176 / :349 / :92 | status-badge.tsx:42 (variant `purple`), NotificationBell TYPE_CONFIG, pricing, risk, system, users | 22 | /10 /12 /20 /28 | LIVE (pre-existing token; badge variant since R93-C7) |
| `--tier-bronze` | :221 / :380 / :67 | utils tierColor, profile gradients, loyalty, wallet cards, referrals medals | 8 | /14 /20 /25 | LIVE |
| `--tier-silver` | :222 / :381 / :68 | same | 10 | /14 /20 /25 | LIVE |
| `--tier-gold` | :223 / :382 / :69 | same | 9 | /14 /20 | LIVE (alias of status-warning) |
| `--tier-platinum` | :224 / :383 / :70 | same | 6 | /14 /25 | LIVE |
| `--destructive-surface` | :213 / :377 / :66 | button.tsx:19 (destructive variant; the 3 live sites risk-event.tsx:274, whatsapp.tsx:543, enrichment.tsx:419) | 1 | — | LIVE, single-consumer **by design** (the A1-F2 4.50:1 fix) |
| `--cat-streaming` … `--cat-education` (7 live) | :152-158 / :317-323 / :75-81 | ProductCard CATEGORY_ACCENT, product (gradients + initial colors), category ACCENTS, admin/products CATEGORY_INITIAL_COLOR; flash-sales via `CATEGORY_ACCENT` import | 21 each | 4/10/12/15/22/25/30/45/55/70 | LIVE |
| `--cat-gaming`, `--cat-productivity` (retired cats) | :159-160 / :324-325 / :82-83 | same maps (archived-product previews) | 11 each | same | LIVE by design (retired ≠ removed; categories.ts restock recipe) |

**Orphan census verdict: ZERO dead tokens, ZERO used-but-undefined-in-one-theme (no fallback bugs), ZERO missing-@theme exposures.** The migrated consumers are exactly the ones the R128 plan named: `STATUS_META` (system.tsx:177-204, whatsapp.tsx:72-83), `TYPE_META` (alerts.tsx:63-114), the dashboard KPI map (dashboard.tsx:773), `CATEGORY_META`/`CATEGORY_ICON` consumers (ProductCard.tsx exports, consumed by product/category/flash-sales/cart), plus `STATUS_TONE`/`StatusBadge` (status-badge.tsx:26-141) which remained the canonical recipe throughout.

---

## 3. Legacy residue (replaced constants)

| Constant | Location | Status |
|---|---|---|
| `CATEGORY_INITIAL_COLOR` (admin) | admin/products.tsx:91-101, consumed :321, :333 | **Migrated in place** — values are now `bg-cat-*/10 text-cat-*` (was violet/emerald/sky/cyan/fuchsia/orange/amber/blue at R128-A1 D4); positive-pinned by admin-palette-tokens.test.ts:114-118. Not dead, not raw. |
| `CATEGORY_INITIAL_COLOR` (storefront) | product.tsx:99-110, consumed :941 | Always token-based (`text-cat-*`); the R124-A3 storefront migration. Not residue. |
| `MEDAL_COLORS` | admin/referrals.tsx:69-79, consumed :447 | **Migrated in place** — now `text-tier-gold/silver/bronze bg-tier-*/10 border-tier-*/20` (was slate/amber/yellow raw per D10); positive-pinned (admin-palette-tokens.test.ts:120-125). Not dead, not raw. |
| `tierColor` | lib/utils.ts:134-141 | Migrated to `text-tier-*` (A1-F3); historical comment retained at :127-133 (comment-only, no live class). |
| Old `CATEGORY_GRADIENTS` raw hues | product.tsx:66-78 | Long-migrated to `from-cat-*/30 via-cat-*/15`; the violet-950 history survives only as a comment (:60-65). |
| `STATUS_TONE` / severity-map raw hues | — | None: the admin guard (below) is green and R129-B1 re-ran it 14/14. |

**Verdict: no dead definitions, no orphan imports, no raw-hue survivors in the replaced constants.** The two constants whose *names* suggest legacy are alive with fully token-based values — a rename would be cosmetic, not required for integrity.

---

## 4. Raw-hue residue census — non-admin `frontend/src` (and whole-tree truth)

Full-tree census (22 hue families incl. green/pink; regex = the admin guard's own `RAW_PALETTE_RE` shape, `admin-palette-tokens.test.ts:63-64`), production files vs tests separated:

**Live class-bearing sites in production source — 11 class instances / 2 files, plus 2 dead:**

| Site | Classes | Verdict |
|---|---|---|
| `pages/wallet.tsx:209` | `bg-green-500/10` (libyana chip tint) | **Half-documented debt (D7 still open)** — in-code justification exists (wallet.tsx:196-206: ink/border are tokens, tint is "non-text decoration"), but DESIGN.md's allowance list does not mention payment-network hues at all; R128-A1 D7 proposed `--net-libyana`/`--net-madar` brand tokens (still unimplemented). |
| `pages/wallet.tsx:210` | `activeBg: "bg-green-500"` | **DEAD** — `activeBg` has zero consumers in all of `frontend/src` (the chip renders `n.border n.bg n.color` at wallet.tsx:1471-1474). Raw-hue dead code. |
| `pages/wallet.tsx:217` | `bg-blue-500/10` (madar tint) | same D7 half-drift as :209 |
| `pages/wallet.tsx:218` | `activeBg: "bg-blue-500"` | **DEAD** (same zero-consumer property) |
| `lib/admin/user-display.ts:144-146` | `PROVIDER_TONE_CLASS`: google `text-blue-400 bg-blue-500/10 border-blue-500/20`, telegram sky-400 trio, whatsapp emerald-400 trio (9 classes) | **A3-5** — admin-reachable (renders at users.tsx:188 as `text-3xs font-bold` = 11px bold chips): the same light-theme AA failure class R128-F1 fixed (−400 inks ≈1.5–2.5:1 on their own /10 tint in light). Carved out of the guard's scope *by design* (admin-palette-tokens.test.ts:25-28 documents the carve-out as "D8 auth-provider brand hues"), but (a) DESIGN.md's brand-mark allowance (:241-242) covers the fixed identity *hexes* (#4285f4/#2aabee/#25d366), not these Tailwind hues; (b) the whatsapp row ignores the existing `--color-brand-whatsapp(-ink)` tokens; (c) the "227 → 0" round record holds only for `pages/admin/**` + `components/admin/**`. |

**Comment-only mentions (no live class, harmless):** product.tsx:63 (retired violet gradient history), referrals.tsx:462-463 (storefront comment — outside the admin guard's scope, which is why its raw literals are legal), lib/utils.ts:127, status-badge.tsx:12. **Test files (intentional):** admin-palette-tokens.test.ts:86-88 (regex self-tests), utils.test.ts:158 (`cn()` conflict-resolution sample strings) — both legitimate; the guard's "comments are paraphrased" claim holds for every admin file (suite green at HEAD).

**Zero raw-hue classes anywhere under `pages/admin/**` + `components/admin/**`** (guard green + R129-B1's run), and zero in all other storefront pages/components (ProductCard, category, home, checkout, loyalty, orders… all clean).

---

## 5. Z-index / radius / shadow / spacing drift in the R128 diff (ee294aa, 4edfbe2, 8a21f09)

- **z-index:** the entire code delta added exactly **one** z class: `z-10` on the risk.tsx sticky table header (`sticky top-0 z-10 … bg-card/85 backdrop-blur-md`, 4edfbe2) — canon nav/sticky layer. (My first per-commit census double-counted it through cumulative diffs; direct `7d469d5..ee294aa` and the 8a21f09-only view confirm zero other additions.) No off-scale z, no new z-[N] inline values.
- **Radius:** added classes are only `rounded-2xl` ×15, `rounded-lg` ×14, `rounded-full` ×14, `rounded-xl` ×12, bare `rounded` ×5, `rounded-md` ×1 — all on the effective 7-step scale. **Zero arbitrary `rounded-[…]`** added (the only `text-[8..11px]` and `shadow-[…rgba…]` strings in the diff are documentation quotes in `docs/history/inspection-r128/*` and a test comment). The A1-F6 dual-source hazard (xl and 2xl both = 16px from two different sources) **grew**: R128 added 15 more `rounded-2xl` alongside 12 `rounded-xl` (two spellings of one value).
- **Shadow:** adds are all token-family — `shadow-sm` ×7, `shadow-status-*` ×5, bare `shadow` ×4, `shadow-inner` ×1, `shadow-primary/30` + `shadow-primary/10` (dashboard.tsx:773). **The D5 ad-hoc rgba shadow is confirmed DELETED from live code** (`shadow-[0_0_0_1px_rgba(251,146,60,0.12)]` survives only in a migration comment at dashboard.tsx:770); the D5 card now rides `border-status-low-stock/30 hover:shadow-status-low-stock/15` (dashboard.tsx:773). The one remaining arbitrary shadow in the codebase is the pre-existing, token-composed NavigationProgress glow (D12, justified). Note the new `/10` primary shadow is below DESIGN.md's documented 20–40% band (A3-7).
- **Spacing:** nothing arbitrary added; all spacing rides the 4px grid utilities; `--mobile-nav-h` consumers unchanged.

---

## 6. `.impeccable` truth (empirical — cached 4.1.0 engine, no install)

**Setup under test:** `frontend/.impeccable/config.json` = `{"ignoreFiles": ["src/**/__tests__/**"]}` (the file's entire content); `frontend/DESIGN.md`; CI invocation `npx -y impeccable@4.1.0 detect frontend/src/` from the **repo root** (ci.yml:302-318, no `working-directory`).

| Question | Answer | Evidence |
|---|---|---|
| Does the tool find `frontend/DESIGN.md` when invoked from the repo root (CI geometry)? | **YES** — discovery walks up from the scanned tree, not cwd | Ran the cached binary from `/tmp` with an absolute target: design-system advisories fire; `--no-design-system` makes them vanish. Phase-3 rules ARE live in CI. |
| Does the landed config actually ignore the test false-positives? | **NO — the config is a no-op.** `ignoreFiles` must live under a `detector` wrapper | (a) `impeccable ignores add-file` writes `{"detector": {"ignoreRules": [], "ignoreFiles": […], "ignoreValues": []}}` — canonical shape proven; (b) A/B on a scratch tree: landed shape → test advisories fire; canonical shape → suppressed; (c) on the real tree, the exact 3 false-positives A1's tuning targeted (design-system-css.test.ts:177, flash-sale-banner.test.tsx:163, product-card-touch.test.tsx:129) **still fire**. |
| Does the gate pass at HEAD? | **NO — exit 2** (primary finding) | `detect frontend/src/` from the repo root: `line 840: [bounce-easing] cubic-bezier(0.34, 1.4, 0.64, 1)` → "1 anti-pattern found", exit **2**. The R128 "A1-F4 fix" put the waiver comment on its own line (index.css:841) — `disable-line` must share the finding's line (the other four waivers at :737/:855/:875/:885 are same-line and pass). Scratch A/B: moving the comment onto line 840 → **exit 0**. |
| Would 2-3 rules fire on known idioms? | Yes, exactly as predicted: `design-system-font-size` fires on the 3 test guard-strings (would be cleared by a *working* config); `design-system-radius` fires on the 11px toast bubble (index.css:1258 — documented in DESIGN.md's *prose* "8–11px inner chips" but absent from the YAML `rounded:` scale, so it remains the one genuine advisory even after all fixes); the 13px toast type and the 1.375rem clamp endpoint do **not** fire (documented in `typography:` — A1's tuning works). Advisories never affect exit code (tool's own help text). |

**Net:** the Phase-3 machinery (DESIGN.md discovery, advisory rules, inline waivers) is genuinely wired and CI-live — but the two artifacts R128 landed to steer it (the config, the waiver fix) are both defective, and the gate is red at HEAD. CHANGELOG:74-78's "Adopted by the `.impeccable` config as its token feed" overstates what the config does even when fixed (it only sets ignores; `designSystem` is enabled by default).

---

## 7. Findings (P0-P4)

### A3-1 [P1] The CI impeccable gate exits 2 at HEAD — the R128 waiver "fix" is still on the wrong line
- **Evidence:** §6. `impeccable@4.1.0 detect frontend/src/` (exact CI geometry, ci.yml:318) → 1 primary finding: `bounce-easing` at `index.css:840`. The `impeccable-disable-line` comment sits on **841**, its own line inside the multi-line `transition:` value (index.css:838-845); the fix comment at :833-837 even states the requirement ("associates with the line the finding is reported on") — the implementation contradicts it. R128's local close-out gates (typecheck/lint/vitest/build) never included this detect, so the mis-fix shipped unverified; R128-A1 had measured exit 2 at 7d469d5 (their F4), so **CI has plausibly been red on the last two pushes to main** (R128's gate comment claims "Verified exit 0 on the R127 tree", which predates the multi-line refactor).
- **Fix (S, verified):** put the waiver on the bezier's own line — `transform 0.26s cubic-bezier(0.34, 1.4, 0.64, 1) /* impeccable-disable-line bounce-easing: … */,` (tested in `/tmp/r129a3/fixtest`: exit 0). Then add `detect frontend/src/` to the local pre-push gate list so this class of mis-fix can't ship again, and check the Actions tab for the current red run.

### A3-2 [P2] `.impeccable/config.json` shipped in a shape the tool ignores — the Phase-3 tuning is a no-op
- **Evidence:** §6. Landed `{"ignoreFiles": […]}` vs canonical `{"detector": {"ignoreFiles": […]}}` (proven by `ignores add-file` output + A/B runs). The 3 test-file advisories the config exists to suppress still print on every detect/CI run. CHANGELOG:77-78 ("Adopted by the `.impeccable` config as its token feed") is a claim-vs-reality miss of the same class this round's B1/A1 lanes are hunting.
- **Fix (S):** wrap the key: `{"detector": {"ignoreRules": [], "ignoreFiles": ["src/**/__tests__/**"], "ignoreValues": []}}` (verified to clear all 3). While there, add `"**/node_modules/**"` per R128-A1's original prescription (harmless today — invocations target `src/` — but future-proofs a repo-root scan).

### A3-3 [P3] DESIGN.md's `error` entry conflates two tokens; `--status-error` dark (#ec5151) is unpublished
- **Evidence:** §1.2 table. `error: "#ea3e3e"` = dark `--destructive`; `light-error: "#bb1b1b"` = light `--status-error`. `--status-error` dark #ec5151 (the StatusBadge error ink, status-badge.tsx:33) appears nowhere in the contract; `--destructive` light ink #dc1818 is published only via the surface alias.
- **Fix (S):** split the entry — `destructive: #ea3e3e / light-destructive: #dc1818` and `status-error: #ec5151 / light-status-error: #bb1b1b` (or keep `error` = the status family and fix the dark hex; either way one entry per token, the file's own convention).

### A3-4 [P3] DESIGN.md under-publishes the light theme: 9 `--cat-*` values + `tier-gold` + light secondary-ink missing, while claiming full twin coverage
- **Evidence:** §1.3. `.light` block :317-325 values (e.g. cat-software light #2362c7, cat-education #886107) have no YAML entries; prose claims "every semantic token has a light twin (the light- prefixed values above)" (DESIGN.md:226-228, 373-375) and "each has a … light-tuned (darker) value" (:239-240). `tier-gold` missing from both theme blocks (family ships 3 of 4); light `--secondary-foreground` #29303d unpublished.
- **Fix (S-M):** add 9 `light-cat-*` entries + 2 `tier-gold` entries (+ optionally `light-on-secondary`), or soften the "every semantic token" sentence to "every token the contract enumerates".

### A3-5 [P3] `lib/admin/user-display.ts` provider chips: raw −400 hues, admin-reachable, light-theme AA fail class, outside both the guard and DESIGN.md's allowance
- **Evidence:** §4. 9 raw classes at :144-146 rendering at users.tsx:188 (11px bold). The carve-out is documented only in the guard test's comment (admin-palette-tokens.test.ts:25-28); DESIGN.md's brand-mark allowance covers the identity hexes, not Tailwind hues; the whatsapp row bypasses the existing `--color-brand-whatsapp(-ink)` tokens. Same WCAG 1.4.3 class R128-F1 fixed everywhere else (light-theme −400 inks ≈1.5–2.5:1 on their /10 tints).
- **Fix (S-M):** swap to token pairs — google `text-status-info bg-status-info/10 border-status-info/20` (or introduce `--brand-google/telegram` tokens like WhatsApp's); whatsapp → `text-brand-whatsapp-ink bg-brand-whatsapp/10 border-brand-whatsapp/20`. Then either fold `lib/admin/**` into the guard's scan roots or keep the carve-out but move its documentation into DESIGN.md.

### A3-6 [P4] wallet.tsx: `activeBg` raw-hue pair is dead code; the live network tints remain half-documented (D7)
- **Evidence:** §4. `activeBg: "bg-green-500"` / `"bg-blue-500"` (wallet.tsx:210/:218) have zero consumers (chip renders `n.border n.bg n.color`, :1471-1474) — 2 of the 4 remaining raw classes in the storefront are literally unread. The live `bg-{green,blue}-500/10` tints are in-code-justified but absent from DESIGN.md's allowance list.
- **Fix (S):** delete the two `activeBg` properties (cargo-cult bait); either document the network tints in DESIGN.md's brand-marks section or land the D7 `--net-*` tokens.

### A3-7 [P4] DESIGN.md prose drift: shadow-alpha ranges, cat-tint range, StatusBadge /28-vs-/30
- **Evidence:** §1.4. "40–60%" dark shadows (actual 32–60%); "primary at 20–40% / 25–40" (actual 5–45, and R128 itself added a `/10` at dashboard.tsx:773); status-colored shadows unmentioned; cat tints "10–15%" (actual 4–70); warning badge border is /30 not /28.
- **Fix (S):** one prose pass — "32–60%", "primary/status accents at 5–45% where documented", "tints 10–15% for chips; hero accents up to 70%".

### A3-8 [P4] DESIGN.md `rounded:` labels are name-shifted vs the CSS variables; the xl/2xl 16px dual-source grew in R128
- **Evidence:** §1.4/§5. YAML sm/md/lg/xl = 4/8/10/12 vs `--radius-sm/md/lg/xl` = 8/10/12/16 (bare `rounded` = 4px). R128 added 15 `rounded-2xl` + 12 `rounded-xl` (both 16px, two spellings — A1-F6's retune time-bomb, now bigger).
- **Fix (S):** either re-key the YAML to the CSS names (sm:8, md:10, lg:12, xl:16, "default"/base:4) or add a note that the YAML enumerates the *scale*, not the Tailwind names; land A1-F6's `--radius-2xl: 1rem` token so both spellings share one source.

### A3-9 [P4] Config would also want the node_modules ignore (latent)
- **Evidence:** §6/A3-2 — R128-A1's prescribed `ignoreFiles` had two patterns; the landed file kept one (and in the wrong shape). Only matters if an invocation ever scans the repo root instead of `frontend/src/`.

---

## 8. Verified-OK register (evidence-checked, no action needed)

1. **64/65 DESIGN.md color entries byte-exact** against independently computed HSL→hex (§1.2) — including all 9 dark cat hues, all 19 light entries, and the 6 light entries R129-A1's script didn't reach. The 65th is the known tier-silver typo (not re-reported).
2. **All 9 brand/neutral literals match their source sites byte-for-byte** (index.css:98-99, AuthProviders.tsx, provider-card.tsx:64-82, TelegramLoginButton.tsx:106, profile.tsx:445) — the documented brand-mark allowance holds, and DESIGN.md is honest that these carry no index.css token.
3. **All 16 new tokens: defined in `:root` AND `.light` AND `@theme`** — zero theme-coverage holes, zero fallback bugs, zero dead tokens (§2).
4. **`--status-purple` heavy adoption**: 22 production uses / 7 files (StatusBadge `purple` variant, NotificationBell, pricing/risk/system/users maps) — the D2/D9 migrations landed with the canonical token.
5. **`--status-success-surface` + `--destructive-surface`**: consumed by exactly their intended sites (topups approve buttons; button.tsx destructive variant) and value-pinned by two suites (admin-palette-tokens.test.ts:101-108, design-system-css.test.ts:241-259).
6. **Legacy constants fully migrated, none dead**: CATEGORY_INITIAL_COLOR (admin + storefront), MEDAL_COLORS, tierColor, CATEGORY_GRADIENTS — all token-valued, all consumed, zero raw survivors (§3).
7. **Admin tree raw-palette = 0** (guard green, self-tested regex, positive pins on the flagship migrations; R129-B1 re-ran it 14/14 at HEAD).
8. **STATUS_META/TYPE_META/severity maps fully token-based** (system.tsx:177-204, alerts.tsx:63-114, dashboard.tsx:773, whatsapp.tsx:72-83) with migration-provenance comments at each site.
9. **Storefront non-wallet pages: zero raw-hue classes** (ProductCard/category/home/checkout/loyalty/orders/support… clean — §4 census).
10. **R128 diff hygiene**: one z-10 added (canon), zero arbitrary radius/bg/text values, zero non-token shadows added, D5's ad-hoc rgba shadow deleted (dashboard.tsx:770 comment is the only trace) (§5).
11. **DESIGN.md mechanics claims true**: dark-default/.light, type ramp + weights + mono stack, 4px grid + 44px touch + 60px nav + 320px floor, toast chrome numbers, button recipe/sizes (32/36/48), StatusBadge recipe + 11–12px type floor, primary-text twin rule, fluid clamps, selection/caret tokenization (§1.4).
12. **impeccable DESIGN.md discovery works from the CI geometry** (target-tree walk-up, proven from an unrelated cwd) — Phase 3 is live in CI; drift rules confirmed advisory-only (never block); the 13px toast type + 1.375rem clamp endpoint correctly do not fire (documented in `typography:`); inline waivers work when same-line (4/5 sites).
13. **MetaTags theme-color constants still byte-match the tokens** (#dc1840/#d3173d = my computed `--primary` hexes; seo-theme-color.test.tsx pins them).
14. **The 11px toast bubble is the only genuine advisory** at HEAD after the A3-1/A3-2 fixes — prose-documented ("8–11px inner chips") but not a YAML `rounded:` step; keeping it is a legitimate documented-bespoke choice (A1's D11 verdict stands).

---

## 9. Recommended next actions (ordered)

1. **A3-1** one-line waiver move (verified fix) → `detect frontend/src/` exits 0; check the Actions tab for the standing red run; add the detect to the local pre-push gate list.
2. **A3-2** config reshape to the `detector` wrapper (+ node_modules pattern) — one JSON edit, verified.
3. **A3-3 + A3-4 + A3-7 + A3-8** one DESIGN.md PR: split the error entry, add 9 light-cat entries + tier-gold (+ light-on-secondary), fix the shadow/tint prose ranges, re-key or annotate the `rounded:` labels. (While in there, the known tier-silver `#acbac3`→`#acb6c3` typo from R129-A1 can ride the same PR.)
4. **A3-5** user-display provider chips → token pairs (or brand tokens) + guard-scope/allowance documentation.
5. **A3-6** delete the dead `activeBg` pair; decide D7 (`--net-*` tokens vs documented allowance).
6. **A3-8 second half** land `--radius-2xl: 1rem` (A1-F6) before the next radius retune.

— R129-A3, 2026-10-10, main @ 76017f4
