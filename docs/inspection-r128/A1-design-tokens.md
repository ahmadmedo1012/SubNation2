# R128-A1 — Design-System & Token Architecture Deep Audit

**Agent:** R128-A1 (design-system & token spine — source-only, no browser) · **Repo:** main @ `7d469d5`, tree clean
**Method:** full read of `frontend/src/index.css` (1,405 lines) + `docs/ux/FINAL_UX_SYSTEM.md`; ripgrep censuses of every token family across `frontend/src` (colors / radii / shadows / type / z-index / motion); WCAG contrast computed from the actual HSL token values via a Node sRGB-luminance script (both themes, alpha-composited tint backgrounds); **empirical** `impeccable@4.1.0` runs against HEAD and against a scratch copy of `frontend/src` with a candidate `DESIGN.md` (the google-labs-code/design.md alpha spec — fetched + read in full) to measure exactly what the Phase-3 drift rules fire on.
**Prior coverage read first:** R127-B3 (impeccable triage + Phase-1/2/3 plan), R126-A13/A9, R124-A3, design-system-css.test.ts. No known item re-reported; B3-K2 status re-verified (it landed — see §5).
**Safety:** READ-ONLY on all source/config. Only this report + the worklog entry were written. `impeccable detect` was run against the repo path (read-only scan) and against `/home/z/r128-a1/dsgate` (a copied `frontend/src`), never mutating the repo. Zero commits, zero pushes, zero production mutations.

---

## 0. Executive summary

The token spine is in **excellent shape and unusually well-policed**: zero raw hex outside brand marks, zero arbitrary `text-[Npx]`/`rounded-[…]` in 380+ source files, a test (`design-system-css.test.ts`) pinning the token contract, and a canon (`FINAL_UX_SYSTEM.md`) that is *almost* truthful. What remains is one big, known, now-quantified debt cluster — **~255 raw Tailwind-palette class hits (232 of them admin)** that fail AA the moment the admin theme toggle flips to light — plus a handful of sharp edges: a marginal AA fail on dark-theme destructive buttons (3.99:1), cross-theme tier-ink fails, a misplaced impeccable waiver that breaks B3's Phase-1 gate on day one, and two off-scale literals in the toast chrome. **DESIGN.md (B3 Phase 3) is empirically ready to author now**: with the draft in §7, the drift rules are advisory-only and fire on just 5 notes (3 test-file false positives, 2 genuine one-line items) — no mass-fire, no gating risk.

**Counts: P0: 0 · P1: 0 · P2: 1 · P3: 4 · P4: 6** (+2 canon-drift doc items folded into P4-6, +1 closed prior item verified).

---

## 1. Token inventory (index.css @ 7d469d5) — the complete spine

### 1.1 Color tokens (HSL channels; hex = computed equivalents, my conversion)

| Family | Tokens (dark → light hex) | Lines |
|---|---|---|
| Surfaces | `--surface-base` #0a0c10 → #f3f4f7 · `--surface-card` #101318 → #ffffff · `--surface-overlay` #181d25 → #ffffff | :135-137 / :267-269 |
| Semantic | `--background/--foreground` · `--card/--card-foreground` · `--border/--card-border` · `--secondary` · `--muted/--muted-foreground` (#a0abba → #535c6e) · `--accent` · `--input` · `--ring` | :176-202 / :326-351 |
| Primary | `--primary` **#dc1840** → **#d3173d** · `--primary-text` #ed5e7b → #d3173d · `--primary-foreground` #ffffff | :185-187 / :334-336 |
| Destructive | `--destructive` #ea3e3e → #dc1818 · `--destructive-foreground` #ffffff | :198-199 / :347-348 |
| Category (9) | `--cat-streaming` #ad70eb → #802dd2 · `--cat-music` #42d791 → #1e764d · `--cat-software` #6c9ae5 → #2362c7 · `--cat-vpn` #4cbcf0 → #116d97 · `--cat-ai-tools` #d87de8 → #a32eb8 · `--cat-seo-tools` #f0784c → #b83c0f · `--cat-education` #f5c147 → #886107 · `--cat-gaming` #55a3f6 → #1877dc (retired cat) · `--cat-productivity` #f7b23b → #da8e0b (retired cat) | :144-152 / :292-300 |
| Status (6) | `--status-success` #2dd285 → #1d724a · `-warning` #f6aa28 → #885907 · `-error` #ec5151 → #bb1b1b · `-info` #3491f4 → #135eae · `-low-stock` #f67a31 → #ad460b · `-purple` #a273f2 → #5d22c3 | :155-168 / :319-324 |
| Brand | `--color-brand-whatsapp` #25d366 + `-ink` #054339 (theme-independent) | :90-91 |
| Elevation | `--elevate-1/2` (white 4/9% dark; black 3/6% light) + `--button-outline` | :126-127 / :257-259 |

Cross-validation: my computed `--primary` hexes (#dc1840 / #d3173d) match `MetaTags.tsx:67-68`'s theme-color constants byte-for-byte — the meta layer and the CSS layer agree.

### 1.2 Radii, shadows, spacing, type, z-index, motion

- **Radius** (:110-113, :214): `--radius: 0.75rem` (12px) with `sm`=8, `md`=10, `lg`=12, `xl`=16. **Effective app scale** (utility census): 4 (`rounded` ×126) / 8 (`sm` ×2 corner) / 10 (`md` ×14) / 12 (`lg` ×211) / 16 (`xl` ×353 **and** `2xl` ×279 — see F6) / 24 (`3xl` ×7) / `full` ×155. `rounded-3xl` and bare `rounded` ride Tailwind defaults (not overridden in `@theme`) — a latent hazard, not live drift.
- **Shadows** (:216-224 dark / :353-367 light): 2xs→2xl, two-stop shape language, theme-tuned (dark 32–60% black; light 6–14%). Census: sm 61 / md 38 / lg 35 / xl 13 / 2xl 12 / xs 1 / inner 4. Colored shadows: `shadow-primary/*` ×62 (sanctioned brand lighting per B3 waiver), `shadow-status-*` ×8, `shadow-black/*` ×20 (neutral, fine), `shadow-destructive` ×2, raw-palette shadows ×4 (part of F1).
- **Spacing**: `--spacing: 0.25rem` (4px grid, :227); 12px breathing unit; `--mobile-nav-h: 60px` single-source (:174, consumed by 5 clearance utilities + asserted equal by `mobile-nav-clearance.test.tsx`).
- **Type ramp** (utility census): 11px (`2xs` 145 + `3xs` 228 — both emit 11px, :107-108) → 12 `xs` 554 → 14 `sm` 407 → 16 `base` 54 → 18 `lg` 24 → 20 `xl` 34 → 24 `2xl` 30 → 30 `3xl` 6 → 36 `4xl` 2 → 48 `5xl` 1 → 60 `6xl` 1, plus `text-fluid-2xl/3xl` clamp utilities (:903-908). Weights: 400/600/700 only (test-banned `font-medium`/`font-black`). Fonts: Readex Pro self-hosted (6 @fontsource subsets, :18-23) with documented fallbacks (:211-213).
- **z-index** (convention, not tokens): nav 10 / sticky 20-30 / overlay 40-45 / modal 50 / drawer 60 / toast+progress 100 — matches the canon §2 scale; intra-card layers `z-[1..3]` (ProductCard/product/flash-sales) and the `::after` z-999 elevation overlays are scoped inside `z-index: 0` stacking contexts (:961, :971) — **no collisions** (census: z-10 ×13, z-50 ×12, z-30 ×4, z-40 ×2, z-20 ×1, z-[45]/[60]/[100] ×1 each).
- **Motion**: 15 keyframe families + spring vocabulary, all covered by the global reduced-motion kill-switch (:1099-1110). Durations 0.16–0.42s interactions / 0.7–0.8s one-shots / 1.6–13s ambient loops. Five inline `impeccable-disable-line bounce-easing` waivers — **one is misplaced (F4)**.

### 1.3 Defined-but-unused / canon-documented-but-missing

- **`--color-card-border`** (`@theme` :42 + `--card-border` both themes): **0 consumers** anywhere (`border-card-border` never appears). shadcn-scaffold heritage. → P4-5.
- Everything else defined has consumers: `--status-low-stock` ×2, `--radius-sm` ×2 (corner variants), `--text-fluid-3xl` ×1, `brand-whatsapp` ×3, `--elevate-*` (hover-elevate system), `--button-outline` (button outline variant), `--toast-radius` (toast). `cat-gaming/productivity` are consumed by ProductCard/product.tsx but the categories are retired (all products archived 2026-09-19, `categories.ts:5-12`) — the in-CSS "zero live consumers" comment (:288-291) is accurate *for the light retune note*.
- Canon §2 documents a z-index scale but there are **no z-index custom properties** — it's a classname convention. Acceptable (documented), but unenforceable; noted as an option in §7, not filed.
- Canon-documented and present: focus system (:837-843), selection/caret theming (:854-862), status-token toasts (:1302-1358) — all verified.

---

## 2. Drift inventory (the core census)

### 2.1 Method + totals

Full-tree ripgrep for raw Tailwind palette classes (`text|bg|border|shadow|ring|from|to|via|fill|stroke|divide-(emerald|orange|amber|red|green|blue|sky|rose|violet|purple|cyan|yellow|teal|slate|gray|zinc|neutral|stone)-\d+`), raw hex literals, arbitrary values (`text-[…]`, `rounded-[…]`, `shadow-[…]`, `bg-[…]`), off-ramp font-size literals, and non-scale radius literals, all excluding `__tests__`. Headline results:

- **Raw hex in TSX/TS: 8 sites, ALL justified** — Google logo fills ×8 (`AuthProviders.tsx:40-52,84`, `provider-card.tsx:64-76`), Telegram `#2AABEE` ×3, WhatsApp ink comment, and `MetaTags.tsx:67-68` (token-derived theme-color constants, documented). **No #dc1840-family or gray raw hex anywhere.**
- **Arbitrary `text-[Npx]`: 0. Arbitrary `rounded-[…]`: 0. Arbitrary `bg-[…]`: 0.** (The R115-A6 #4 tokenization did its job and `design-system-css.test.ts:177-186` keeps it that way.)
- **Arbitrary `shadow-[…]`: 2** — see D12/D13.
- **Raw Tailwind palette classes: 255 line-hits across 28 files (232 admin / 23 storefront+lib)** — the drift table below.

### 2.2 Drift inventory table (clusters; counts = matching lines)

| # | Cluster (sites) | Current | Proposed token | Class |
|---|---|---|---|---|
| D1 | **Admin status/severity maps** — `system.tsx:174-201` (STATUS_META ok/failing), `alerts.tsx:68-110` (severity map), `dashboard.tsx:644-695` (KPI hue maps), `users.tsx:102+` (role tints), `orders.tsx:382,1059-1208` (coupon/discount emerald), `pricing.tsx:186-188,278-279` (SAFE/WATCH/THIN), `risk.tsx:518-524` (warn/danger), `tickets.tsx` (emerald/blue action buttons), `whatsapp.tsx` (amber cluster), `coupons.tsx`, `enrichment.tsx`, `risk-event.tsx`, `promotions.tsx:329-529`, `settings.tsx:385-386`, `admins.tsx:232,286-287` — **~170 lines** | `text-emerald-400/red-400/blue-400/cyan-400/orange-400/amber-400/…` on `*/10` tints | `text-status-success/-error/-info/-info/-low-stock/-warning` + StatusBadge variants (the tokens exist; emerald-400 ≈ dark `--status-success` byte-near: #34d399 vs hsl(152 65% 50%)) | **Drift (tracked debt, canon §7)** — see F1: AA-fails in light theme |
| D2 | `admin/topups.tsx:71-86` MethodBadge/NetworkBadge | `bg-purple-500/10 text-purple-400 border-purple-500/20`, `blue-500/10 + blue-400`, `green-500/10 + green-400` | `StatusBadge variant="purple"/"info"` (`bg-status-purple/12 text-status-purple border-status-purple/28`) — the exact recipe these hand-roll | **Drift** — highest-value single fix; purple-400 on its tint = 2.34:1 light |
| D3 | `admin/layout.tsx:204,1144,1301` (alert count chips), `:1360` (live dot) | `bg-yellow-400 text-black`, `bg-emerald-400` | `bg-status-warning text-foreground` / `bg-status-success` | **Drift** — yellow-400 text-black is off-token on both axes |
| D4 | `admin/products.tsx:82-92` `CATEGORY_INITIAL_COLOR` | `violet/emerald/sky/cyan/fuchsia/orange/amber/blue` at /20 + -300 text | `bg-cat-*/10 text-cat-*` (the canonical 9-hue family the storefront uses) | **Drift** — same category shows *different* hues in admin vs storefront (software: sky ~199° vs token 217°; vpn cyan vs 199°) |
| D5 | `admin/dashboard.tsx:768` low-stock card | `border-orange-400/30 … shadow-[0_0_0_1px_rgba(251,146,60,0.12)] hover:shadow-orange-400/15` | `border-status-low-stock/30 hover:shadow-status-low-stock/15` + drop the ad-hoc rgba shadow | **Drift** — the only raw-rgba ad-hoc shadow in the codebase (canon §7's "orange KPI border") |
| D6 | Tier colors — `lib/utils.ts:131-139` tierColor, `profile.tsx:34-37` gradients, `wallet.tsx:731-740` tier cards, `loyalty.tsx:409-411` | `text-amber-600/slate-500/cyan-600` (+ gold already `text-status-warning`) | new `--tier-bronze/silver/gold/platinum` family, theme-aware | **Justified-documented** (R94-A1 #5 WCAG audit) **but cross-theme fails — see F3** |
| D7 | Payment-network brand hues — `wallet.tsx:207-218` (color/border already tokens; `bg-green-500/10`, `activeBg:bg-green-500`, `bg-blue-500/10`, `bg-blue-500`), `topups.tsx:85-86` | raw green/blue for libyana/madar | `--net-libyana` / `--net-madar` brand pair (like `--brand-whatsapp`) | **Half-drift** — ink already tokenized; the surface/active pairs are raw |
| D8 | Auth-provider hues — `lib/admin/user-display.ts:144-146`, `AuthProviders.tsx:84` | `text-blue-400 bg-blue-500/10 …`, `color:"#4285F4"` | brand tokens or leave (see §4) | **Justified** (brand marks) — candidate for `--brand-google/telegram` tokens like WhatsApp's |
| D9 | `admin/pricing.tsx` violet KPI (`text-violet-500`, `border-violet-500/40 bg-violet-500/10`) + `system.tsx` violet/purple icon tiles | raw violet/purple-400 | `--status-purple` (exists for exactly this) | **Drift** |
| D10 | `admin/referrals.tsx:75-76` tier pills `text-slate-400 bg-slate-400/10`, `text-amber-600 …` | raw slate/amber | tier tokens (D6) | **Drift** (slate-400 on white = 2.56:1) |
| D11 | Toast chrome literals — `index.css:1202` (icon bubble `border-radius: 11px`), `:1233` + `:1284` (`font-size: 13px` description/action) | 11px radius, 13px type | radius `md`(10px) or document; 13px → document as ramp step or move to 12/14 | **Bespoke-value drift** (the only off-scale radius + only off-ramp font-size literals in the CSS) |
| D12 | `NavigationProgress.tsx:87` | `shadow-[0_0_8px_hsl(var(--primary)/0.6)]` | — (token-composed arbitrary; no token exists for "glow bar") | **Justified** — token-based value in arbitrary syntax |
| D13 | `admin/topups.tsx:303-317,516` approve/reject buttons | `bg-emerald-700 … text-white`, `border-red-500/30 text-red-400` | (none — token gap, see F2) | **Justified-documented** (5.48:1 both themes, comment :303-306) — reveals the missing solid-status-surface token |
| D14 | `system.tsx` sparkline/status dots (`bg-emerald-400/yellow-400/red-400` pulse dots), `dashboard.tsx` legend swatches | raw -400/-500 fills | status tokens | **Drift** (subsumed by D1; non-text 3:1 applies — dark passes, light fails for most) |

**Totals: 255 raw-palette lines (232 admin / 23 storefront), 1 ad-hoc rgba shadow, 1 off-scale radius, 1 off-ramp size family, 0 hex, 0 arbitrary text/radius/bg classes.** Justified subset: D6/D7 (partly)/D8/D12/D13 ≈ 45 lines; true drift ≈ 210 lines, of which D1+D2+D3+D4+D5+D9+D10 (~180 lines) have a *named token answer that already exists*.

---

## 3. Storefront ↔ admin unification

**Verdict: one token spine, two dialects — the structure is unified; the drift is one-way (admin → raw palette).**

Shared (verified by census in sampled admin pages dashboard/products/orders/topups/security/settings): `bg-card`/`border-border`/`text-foreground`/`text-muted-foreground` surfaces, `rounded-xl/2xl` radii, `shadow-sm…2xl` elevations, the `text-xs/sm` type ramp, StatusBadge/`STATUS_TONE` for canonical statuses, the same ThemeProvider (both surfaces default dark, both ship a toggle — storefront `Navbar.tsx:263`, admin `layout.tsx:1392`). `security.tsx` and `settings.tsx` are nearly drift-free (61/58 scale-class hits; 0 and 2 raw-palette lines respectively, both documented). Chart surfaces ride `chart-theme.ts` (verified token-driven, `getComputedStyle`-read, theme-flip reactive — the canon's "zero hardcoded hex in recharts" claim is TRUE at HEAD).

Divergence (all admin-side): (1) the D1–D5/D9/D10 raw-palette maps above; (2) documented relaxations — 44px→≥24px edge-button targets and density (canon §6, fine); (3) admin owns its shell chrome (canon-documented since R116-S1); (4) **D4 is the only case where admin shows a *different hue for the same concept* than the storefront** (category colors) — the one true semantic split, not just an untokenized duplicate.

---

## 4. Dark / light mode

- **Dark is the default** (`:root`, `color-scheme: dark`), light is opt-in via `.light` class — applied by `lib/theme.tsx` ThemeProvider, persisted in `localStorage.sn_theme`, toggles shipped on **both** surfaces. This IS the canon's documented strategy (FINAL_UX_SYSTEM §2). The prompt's question ("is there any dark mode?") inverts: light is the opt-in, and it is *not* RTL/brand-forced dark — a real, user-reachable second theme everywhere.
- **Historical-comments note:** ~10 admin files still say "the shipped LIGHT admin theme" (e.g. `orders.tsx:84`, `topups.tsx:1196`, `referrals.tsx:71`, `users.tsx:19`) — accurate for the R115 era, misleading today (admin defaults dark). The *fixes* those comments justify are both-theme-correct, so no visual bug — folded into F7 (docs truth).
- **Dark-context surfaces verified by computation** (script, alpha-composited): toast description `--muted-foreground` on the overlay/92 glass = **7.36:1**; product.tsx image badges (`text-white/85` on `bg-black/55` over card) = **14.13:1**; `primary-text` on surface-base = **6.05:1**; MobileNav/Footer ride the standard surface ladder with muted-foreground ink ≥8:1 equivalent (base is darker than card). **No dark-context contrast debt found.**

---

## 5. B3-K2 follow-up (11px micro-text) — CLOSED at HEAD + waiver set documented

**Status: FIXED.** B3-K2's three fine-print families all render `text-xs font-semibold` (12px/600) at HEAD:
- ProductCard description: `ProductCard.tsx:520` (`hidden sm:block text-muted-foreground text-xs font-semibold line-clamp-2`) — was `text-2xs` 11px/400. Landed in `adbf91c` (same commit as B3-K1).
- Register terms fine print: `register.tsx:198` — landed in `9e65bab`.
- Support login-note: `support.tsx:800` — same family, same fix.

**Remaining 11px surface (the waiver set, censused):** `text-3xs` 228 + `text-2xs` 145 line-hits; of these, the B3-K2-relevant *muted-foreground* × 11px intersection = **~250 lines / 43 files** (storefront: Footer links/headings, Navbar category label, WhatsAppPhoneSignIn helper text, orders/wallet/loyalty/home/cart/checkout fine rows, SessionManager, NotificationBell timestamps; admin: system/users/orders/pricing/dashboard/copilot/inventory/variants/etc. internals). Token math for the actual pairs (computed): **dark card 8.00:1 · light card 6.72:1 · dark secondary chip 6.63:1 · light chip 5.69:1 — every instance passes AA 4.5:1 by WCAG methodology** (consistent with R126-A13 J7's 437/437 computed-style pass; B3-K2's 3.2–4.1:1 pixel-median was anti-alias ink density, not a spec violation).

**Recommendation (decision):** keep the 11px floor and **formalize the waiver** — it is already triple-documented (index.css:97-106 rationale, status-badge.tsx:18-24 "padding/icon scale, not type scale", design-system-css.test.ts:167-175 pin) and a 12px 2xs would reflow ~150+ badge/chip surfaces. I recommend folding that waiver paragraph into DESIGN.md (§7 draft carries it) so impeccable's font-size rule sees 11px as documented. **Do not** re-open the 11px→12px migration for these secondary surfaces; B3-K2's specific high-traffic sites are already at 12px.

---

## 6. Computed contrast table (all pairs from the actual token values)

| Pair (context) | Dark | Light | Verdict |
|---|---|---|---|
| muted-foreground on card (11px micro) | 8.00 | 6.72 | AA ✓ |
| muted-foreground on secondary chip | 6.63 | 5.69 | AA ✓ |
| white on `--primary` (primary buttons, 14px semibold) | 4.94 | 5.30 | AA ✓ |
| **white on `--destructive` (destructive buttons, 14px semibold)** | **3.99** | 5.02 | **AA ✗ dark (F2)** |
| white on `--status-success` (hypothetical solid) | 1.97 | 5.90 | token gap (F2b) |
| StatusBadge inks on own /12 tint (success/info/purple) | 7.70 / 4.98 / 4.79 | 4.98 / 5.43 / 6.86 | AA ✓ (matches the in-CSS comments' own figures) |
| cat-* inks on card | 5.59–11.17 | 5.30–5.77 | AA ✓ (R124 darkening holds) |
| **tier inks** — silver (`slate-500`), bronze (`amber-600`), platinum (`cyan-600`), gold (`status-warning`) on card | 3.91 / 5.84 / 5.05 / 9.48 | 4.76 / **3.19** / **3.68** / 6.04 | **AA ✗ silver-dark, bronze-light, platinum-light (F3)** |
| Raw admin `-400` hues on own /10 tint over card (the D1 cluster) | 3.56–9.96 | **1.47–2.51** | dark mostly ✓ / **light ALL ✗ (F1)** |
| toast desc on glass; badge white/85 on black/55; primary-text on base | 7.36 / 14.13 / 6.05 | — | ✓ |

---

## 7. DESIGN.md draft (impeccable Phase 3) — **empirically validated**

**What I did:** fetched + read the DESIGN.md spec (google-labs-code/design.md `docs/spec.md`, alpha — YAML frontmatter tokens + 8 ordered markdown sections), authored a full SubNation DESIGN.md from the §1 inventory, dropped it beside a scratch copy of `frontend/src`, and ran `impeccable@4.1.0 detect` to measure the real fire surface.

**Empirical results (v4.1.0, source mode):**

| Run | Result |
|---|---|
| HEAD, no DESIGN.md | exit **2** — 1 warning: bounce-easing `index.css:784` (F4) |
| Scratch + DESIGN.md draft | exit 2 (same 1 warning) + **5 advisories, all `design-system-*`, none blocking**: 3 are test-file *negative-guard* regex strings (`design-system-css.test.ts:177`, `flash-sale-banner.test.tsx:163`, `product-card-touch.test.tsx:129` — e.g. `not.toContain("text-[7px]")`), 1 is the clamp endpoint `1.375rem` (`index.css:904`), 1 is the genuine 11px toast-bubble radius (`index.css:1202`) |
| + tuning (document `fluid-2xl-min: 1.375rem`) | clamp advisory **clears** — 4 advisories remain |
| + `ignoreFiles: ["src/**/__tests__/**"]` (config) | 3 test false-positives clear → **1 genuine advisory total** |

**Key discoveries that change B3's Phase-3 calculus:**
1. The drift rules (`design-system-color/font-size/radius`) are **advisory-severity in v4.1.0 — they never affect exit code.** B3's "expect a tuning pass before it can gate" concern is moot: DESIGN.md can land *today* with zero gate risk; the rules become a review radar, not a gate.
2. The rules scan **literal CSS values** (`.css` files + inline style literals), **not Tailwind classnames** — the 255 raw-palette *class* hits (§2) are invisible to them. DESIGN.md is not a substitute for the D1–D5 migration; the two tools are complementary.
3. Documenting `black`/`white` in `colors:` automatically covers the entire rgba shadow stack ("sidecar tonal ramps" = alpha variants of documented colors) — verified empirically. This is the single tuning lever that prevents the feared mass-fire.
4. B3's proposed Phase-1 config ignores `"src/test/**"` — the actual test dirs are `src/**/__tests__/**`; the pattern must be that or the 3 guard-string false positives survive.

**Migration order (recommendation):** (a) land the one-line F4 waiver fix → source gate exits 0; (b) commit DESIGN.md + `.impeccable/config.json` (with the `__tests__` ignore) together — advisory-only, no pre-cleanup needed; (c) fix D11's two literals (or leave documented — they're in the draft as documented steps); (d) schedule the D1/D2/D4 migration as normal engineering debt with the drift table in §2 as the work list. **No waive-first-vs-fix-first dilemma exists** because nothing blocks.

**The draft (ready to commit as `frontend/DESIGN.md` after review — validated verbatim by the runs above):**

```markdown
---
version: alpha
name: SubNation
description: >-
  Dual-theme (dark-default) Arabic RTL e-commerce design system. Dark theme is
  the default (:root); light theme rides the .light class. Every value below is
  the computed equivalent of the HSL channel tokens in frontend/src/index.css —
  that file remains the single source of truth; DESIGN.md is the published
  contract for humans and design-aware tooling.
colors:
  # ── dark theme (default) ──
  background: "#0a0c10"
  surface: "#0a0c10"
  surface-card: "#101318"
  surface-overlay: "#181d25"
  foreground: "#f8fafc"
  on-surface: "#a0abba"
  border: "#232a34"
  primary: "#dc1840"
  primary-text: "#ed5e7b"
  on-primary: "#ffffff"
  secondary: "#1f252e"
  on-secondary: "#f8fafc"
  muted: "#1b2028"
  muted-foreground: "#a0abba"
  input: "#212731"
  ring: "#dc1840"
  error: "#ea3e3e"
  on-error: "#ffffff"
  success: "#2dd285"
  warning: "#f6aa28"
  info: "#3491f4"
  low-stock: "#f67a31"
  status-purple: "#a273f2"
  # ── category accents (dark) ──
  cat-streaming: "#ad70eb"
  cat-music: "#42d791"
  cat-software: "#6c9ae5"
  cat-vpn: "#4cbcf0"
  cat-ai-tools: "#d87de8"
  cat-seo-tools: "#f0784c"
  cat-education: "#f5c147"
  cat-gaming: "#55a3f6"
  cat-productivity: "#f7b23b"
  # ── light theme overrides (.light) ──
  light-background: "#f3f4f7"
  light-surface-card: "#ffffff"
  light-foreground: "#14181f"
  light-border: "#dadce2"
  light-primary: "#d3173d"
  light-primary-text: "#d3173d"
  light-muted-foreground: "#535c6e"
  light-secondary: "#ebecf0"
  light-error: "#bb1b1b"
  light-success: "#1d724a"
  light-warning: "#885907"
  light-info: "#135eae"
  light-low-stock: "#ad460b"
  light-status-purple: "#5d22c3"
  # ── brand marks (theme-independent) ──
  whatsapp: "#25d366"
  whatsapp-ink: "#054339"
  google-blue: "#4285f4"
  google-green: "#34a853"
  google-yellow: "#fbbc05"
  google-red: "#ea4335"
  telegram: "#2aabee"
  # ── neutrals used by the elevation/shadow stacks ──
  black: "#000000"
  white: "#ffffff"
typography:
  # 11px is the Arabic readability floor (both micro tokens emit 11px);
  # nothing smaller ships. Weights are 400 / 600 / 700 only.
  micro-xs:
    fontFamily: Readex Pro
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: Readex Pro
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
  caption-bold:
    fontFamily: Readex Pro
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
  toast-description:
    fontFamily: Readex Pro
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  body-sm-semibold:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.5
  body-sm-bold:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.45
  body-md:
    fontFamily: Readex Pro
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
  body-md-bold:
    fontFamily: Readex Pro
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.4
  headline-sm:
    fontFamily: Readex Pro
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
  headline-md:
    fontFamily: Readex Pro
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
  headline-lg:
    fontFamily: Readex Pro
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
  headline-xl:
    fontFamily: Readex Pro
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.3
  display-sm:
    fontFamily: Readex Pro
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.2
  display-md:
    fontFamily: Readex Pro
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.2
  display-lg:
    fontFamily: Readex Pro
    fontSize: 60px
    fontWeight: 700
    lineHeight: 1.1
  # fluid heroes (clamp, rem bounds)
  fluid-2xl:
    fontFamily: Readex Pro
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.3
  fluid-2xl-min:
    fontFamily: Readex Pro
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.3
  fluid-3xl:
    fontFamily: Readex Pro
    fontSize: 2.9rem
    fontWeight: 700
    lineHeight: 1.25
  # technical / mono
  mono-sm:
    fontFamily: SFMono-Regular
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-md:
    fontFamily: SFMono-Regular
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 4px
  md: 8px
  lg: 10px
  xl: 12px
  2xl: 16px
  3xl: 24px
  full: 9999px
spacing:
  unit: 4px
  base: 12px
  card-padding: 16px
  section-gap: 24px
  touch-target: 44px
  mobile-nav-height: 60px
---

# SubNation Design System

## Overview

Quiet, coherent, trustworthy, fast — the SubNation look. Arabic-first RTL
e-commerce for the Libyan market (subnation.ly): dark theme by default, an
optional light theme, one brand accent (crimson `#dc1840`), nine category
accent hues, and a dense-but-calm data UI for the admin console. Nothing
decorative moves on its own; every animation answers "why does the user
benefit", and `prefers-reduced-motion` is a global kill-switch. The design
density is deliberately higher than a typical marketing site: money surfaces
(prices, balances, order codes) are always `tabular-nums` with Western digits
and a «د.ل» suffix, isolated with `dir="ltr"` where codes mix with Arabic.

## Colors

Two themes over one token spine. The **dark theme is the default** (`:root`);
the **light theme** applies via a `.light` class and every semantic token has
a light twin (the `light-` prefixed values above). Token authority lives in
`frontend/src/index.css`; the values here are their computed hex equivalents.

- **Primary (#dc1840 dark / #d3173d light):** the single interaction accent —
  primary buttons, links, focus ring, selection. As *text on dark surfaces*,
  always use the lighter `primary-text` twin (#ed5e7b / #d3173d): the surface
  value is for fills, not ink.
- **Status family (success/warning/error/info/low-stock/purple):** one token
  per state, consumed as `bg-<token>/12 text-<token> border-<token>/28` pill
  recipes (StatusBadge). Never hand-roll raw palette hues for status UI.
- **Category accents (9 hues):** per-product-category coding used by product
  cards and category heroes at low alpha tints (10–15%); each has a
  dark-tuned (lighter) and light-tuned (darker) value. gaming and
  productivity are currently retired categories.
- **Brand marks:** WhatsApp (#25d366 + its AA ink #054339), Google four-color
  logo, Telegram (#2aabee) are fixed identity colors — they do not theme.
- **Elevation:** depth comes from a surface ladder
  (base → card → overlay) plus neutral black shadows, never from colored
  glows — the only sanctioned colored light is the primary at 20–40% alpha on
  interactive elements (button/discount-badge glow).

## Typography

One family: **Readex Pro** (self-hosted, Arabic + Latin subsets), with
fallbacks `"Readex Pro", "Inter", sans-serif`. Exactly three weights ship —
400, 600, 700; `font-medium`/`font-black` are banned (they CSS-fallback to
the wrong weights). Line heights are Arabic-safe: 1.3 for headlines (Readex
Pro's tall ascenders clip harakat below that), 1.7 for running text.
Letter-spacing on Arabic script is always 0 — the global stylesheet collapses
all `tracking-*` utilities because tracking severs Arabic letter joins.

The type ramp is intentionally compact and dense: **11 → 12 → 14 → 16 →
18 → 20 → 24 → 30 → 36 → 48 → 60px** plus two fluid clamp steps for heroes
(`text-fluid-2xl` / `text-fluid-3xl`) and a single 13px step used only inside
the toast system's description/action-button chrome. 11px is the absolute
floor (both micro tokens emit it); the micro scale is a padding/icon scale,
not a type scale. Money and codes use the mono stack
(`SFMono-Regular, Menlo, Consolas, "Readex Pro", monospace`).

## Layout

RTL-first (`dir="rtl"` app-wide); logical properties (`ms/me/ps/pe`) for
anything new. A **4px spacing grid** (0.25rem Tailwind unit) with 12px as the
breathing unit; cards pad 16–20px; sections separate by 24px. Storefront
touch targets are ≥44px (`.touch-target`); the admin dialect allows ≥24px
edge buttons but keeps 44px money-path controls. The fixed mobile bottom nav
is 60px (the `--mobile-nav-h` token) and every clearance that must reserve
room for it reads that variable. `max-width: 320px` is the supported floor.

## Elevation & Depth

Tonal first: the surface ladder (#0a0c10 base → #101318 card → #181d25
overlay) does most of the hierarchy work, reinforced by 1px borders at
`--border`. Shadows are neutral black with a two-stop shape language
(shadow-sm … shadow-2xl), tuned per theme (dark shadows are heavier: 40–60%
black; light: 6–14%). Overlays (dialogs, toasts, drawer scrims) sit on a
backdrop blur + translucent surface. Colored shadow is reserved for the
primary accent at low alpha on interactive elements
(`shadow-primary/25–40`).

## Shapes

A seven-step radius scale: **4 / 8 / 10 / 12 / 16 / 24 / 9999px (full)**.
12px is the default card radius (`--radius`); 16px for large cards and
dialogs; `full` for pills, badges, and avatars. The toast system uses 16px
panels with 8–11px inner chips. No sharp corners except data-table cells and
full-bleed media.

## Components

- **Buttons:** primary = filled crimson (gradient `from-primary` →
  `primary/95`), white label, crimson glow `shadow-primary/25`; destructive =
  filled error red, white label; outline/ghost/secondary ride the neutral
  surface tokens. Sizes: 32 (sm) / 36 (default) / 48px (lg, the canonical
  money CTA). Press feedback is the spring scale-down (`press-spring`).
- **StatusBadge:** the single status-pill recipe (`bg-/12`, `text-`,
  `border-/28`), three padding sizes (xs/sm/md) whose *type* stays at 11–12px.
- **ProductCard:** category-tinted media tile (accent at 10–12% alpha),
  12px-above-title rhythm, 16px radius, hover = spring lift 3px + shine sweep
  (desktop only).
- **Toasts (sonner, custom skin):** 16px glass panels, 1px leading accent
  strip in the status token, translucent icon bubble at 14% alpha.

## Do's and Don'ts

- Do use `primary-text` (not `primary`) for crimson text on dark surfaces.
- Do compose status UI from the `--status-*` tokens only — no raw
  `emerald/red/blue/…` Tailwind hues in status maps.
- Don't use font weights other than 400/600/700.
- Don't use letter-spacing on Arabic text (the global sheet collapses it).
- Don't size text below 11px; don't add type steps outside the ramp without
  updating `frontend/src/index.css` and this file together.
- Don't use `transition: height/layout` properties or animate `blur`;
  transforms and opacity only. All motion must be covered by the global
  reduced-motion kill-switch.
- Do keep dark-context surfaces (scrims, footer, mobile nav) on the surface
  ladder so the AA-tuned foreground tokens stay valid.
- Don't introduce a second focus system — the global `:focus-visible`
  2px crimson outline is the only one.
```

---

## 8. Findings

### F1 [P2] Admin raw-palette status maps fail AA across the board in the light theme — 232 hits, quantified, with a named token answer for ~180 of them
- **Evidence:** §2.2 D1–D5, D9, D10. The admin theme toggle ships (`admin/layout.tsx:1392-1400`); flipping to light renders every `-400`-ink badge at **1.47–2.51:1** on its own tint (computed, §6) — e.g. `topups.tsx:71` purple chip 2.34:1, `referrals.tsx:75` slate 2.56:1-on-white, `orders.tsx:1153` emerald 1.80:1. Dark theme passes (3.56–9.96:1, only slate-500 sub-4.5), which is why this has survived as "tracked debt" (canon §7 "admin severity maps must migrate to these"). It is the *same WCAG 1.4.3 class* R124-A3/R116-S1 already fixed on the storefront, on a user-reachable configuration.
- **Fix (M, mechanical):** migrate the maps to `--status-*` / StatusBadge variants row-by-row using the §2.2 table; `emerald-400`→`status-success` is visually near-identical in dark (#34d399 ≈ hsl(152 65% 50%)) and AA-correct in light. Start with D2 (topups badges — direct StatusBadge swap), D3 (layout count chips), D4 (CATEGORY_INITIAL_COLOR → cat tokens), then the D1 severity maps (system/alerts/dashboard/users/orders/pricing/risk). ~180 lines, all with an existing token answer; no new tokens required.

### F2 [P3] White-on-destructive is 3.99:1 in dark theme (AA marginal fail on the Button destructive variant) + no AA-safe solid success surface exists anywhere in the palette
- **Evidence:** `--destructive: 0 80% 58%` (index.css:198) → #ea3e3e; white 14px-semibold text (`button.tsx:8,16`) = **3.99:1** (computed; light 5.02:1 passes). 3 live sites: `risk-event.tsx:274`, `whatsapp.tsx:543`, `enrichment.tsx:419` (all admin, default size). Companion gap: white on `--status-success` dark = 1.97:1 — which is exactly why `topups.tsx:307` hand-rolls `bg-emerald-700` for the approve button (documented 5.48:1). The status family has ink+tint forms but **no solid-surface form**.
- **Fix (S-M):** split the destructive pair like primary/primary-text: keep `--destructive` for ink (darkening it to 52% for the button would drop ink-on-card to 4.13:1 — worse trade), add `--destructive-surface: 0 80% 52%` (white = 4.50:1, computed) consumed by the button variant. Optionally add `--status-success-surface: 152 65% 30%`-class (≈4.8:1, verify at landing) so the topups approve button can retire emerald-700. Verify with the R116-S1 measurement method before landing.

### F3 [P3] Tier ink colors fail AA cross-theme: silver 3.91:1 (dark), bronze 3.19:1 / platinum 3.68:1 (light)
- **Evidence:** `lib/utils.ts:131-139` tierColor (R94-A1 #5 claimed "hold on BOTH card colors" — the gold fix holds; the others don't at HEAD's token values, computed §6). Consumers render tier names at 11px bold (`profile.tsx:279` tier chip `text-2xs font-bold`), `text-2xl` bold (`loyalty.tsx:504`) — small text needs 4.5:1; `referrals.tsx:75-76` admin pills fail light too (2.56:1).
- **Fix (M):** introduce a theme-aware `--tier-bronze/silver/gold/platinum` family (gold = alias `--status-warning`); e.g. silver dark 215 16% 72% (9.07:1) / light 220 14% 40%; bronze dark 40 92% 60% (10.52:1) / light 40 90% 30%; platinum dark 211 80% 70%-class / light 211 80% 38% (info-family). Migrates D6+D10 together and gives the tier system the same both-theme-AA guarantee the rest of the palette got in R124.

### F4 [P3] The `.card-spring` impeccable waiver is misplaced → `detect src/` exits 2 at HEAD; B3's Phase-1 CI gate fails on day one as specced
- **Evidence:** `impeccable@4.1.0 detect src/` at HEAD: exit **2**, 1 finding — `bounce-easing index.css:784`. The waiver comment sits on line **785** (a CSS comment *inside* the multi-line `transition:` value, after the bezier line), so it waives the wrong line; the other four sites (686/799/819/829) carry same-line waivers and pass. R127-B3 §6 claimed "after which `detect src/` exits 0" — false at HEAD for this one site.
- **Fix (S):** move the comment to the bezier's own line (`transform 0.26s cubic-bezier(0.34, 1.4, 0.64, 1) /* impeccable-disable-line bounce-easing: … */`) or flatten the transition to one line. Verified shape: the other four same-line waivers pass.

### F5 [P3] Canon drift: FINAL_UX_SYSTEM.md is stale on three points the code has moved past
- **Evidence:** §2 says "`--text-3xs` (10px)" and "no sub-10px text" — the token has been 11px since R120-B1 (index.css:108, test-pinned); §7 says "`.card-enter` (0 consumers, kept)" — deleted in R118-B2 and its deletion is itself test-pinned (`design-system-css.test.ts:109-118`); §7's debt line under-states the admin raw-palette scale (232 hits/23 files, AA-quantified in F1). Bonus wording bug: §2 "Inline zIndex values must not exceed the modal layer" contradicts its own toast-100 layer (and the shipped z-[100] NavigationProgress).
- **Fix (S):** refresh the three lines (10px→11px, drop .card-enter, point the debt line at this report's §2 table + F1); reword the z-index sentence to "inline zIndex must map to the documented layers".

### F6 [P4] `rounded-xl` and `rounded-2xl` are the same 16px from two different sources — a retune time-bomb
- **Evidence:** `--radius-xl = calc(0.75rem + 4px)` = 16px (index.css:113) vs Tailwind default `rounded-2xl` = 1rem = 16px (not overridden). Census: xl ×353 / 2xl ×279 — one visual size, two spellings. If `--radius` is ever retuned, the two split.
- **Fix (S):** define `--radius-2xl: 1rem` (and optionally `--radius-3xl`) in the `@theme` block so the whole scale is token-owned; no class changes needed.

### F7 [P4] Stale "shipped LIGHT admin theme" comments (~10 files) mislead future readers
- **Evidence:** `orders.tsx:84`, `topups.tsx:1196`, `referrals.tsx:71,177,198,417`, `system.tsx:183`, `users.tsx:19`, `settings.tsx:267` — accurate for the R115 era; admin now defaults dark with a shipped toggle (both-theme-safe migrations they justify remain correct).
- **Fix (S):** one-line comment pass: "the light theme" instead of "the shipped light admin theme" (docs-truth class, same as R127-B14's lane).

### F8 [P4] Toast chrome carries the only off-scale radius (11px) and only off-ramp font size (13px) literals in the stylesheet
- **Evidence:** `index.css:1202` (icon bubble `border-radius: 11px`), `:1233` + `:1284` (`font-size: 13px`). The DESIGN.md draft documents both (toast-description step; "8–11px inner chips") so they are sanctioned — but they are the two values a future token sweep will trip over.
- **Fix (S, optional):** bubble → 10px (`md`); description/action → 12px or 14px. Or keep documented (zero visual change either way is not guaranteed — 13→12/14 changes toast density slightly; documenting is the zero-risk option).

### F9 [P4] Dead opt-out classes: the `no-default-*-elevate` / `no-*-interaction-elevate` family has zero consumers
- **Evidence:** `index.css:957-985` selectors reference four opt-out classes (`no-default-hover-elevate`, `no-default-active-elevate`, `no-hover-interaction-elevate`, `no-active-interaction-elevate`) — 0 hits in all of pages/components/hooks/lib (exhaustive census). Same cargo-cult-bait class R118-B2 kept deleting (pb-safe/pt-safe/card-enter).
- **Fix (S):** delete the four `:not()` guards (keep the base classes), or keep ONE documented escape hatch and reference it — as-is it's ~6 lines of dead selector weight in the hottest utility block.

### F10 [P4] `--color-card-border` / `--card-border` token pair defined but unused (both themes)
- **Evidence:** index.css:42 (:42, :183, :332) — zero `border-card-border` consumers. shadcn scaffold heritage.
- **Fix (S):** delete (with the R116-S1 dead-token precedent) or adopt in card components (`border-card-border` ≡ `border-border` today — deleting is the honest move).

### F11 [P4] Light-mode cat-gaming (3.91:1) / cat-productivity (2.44:1) will ship sub-AA if those categories are restocked
- **Evidence:** index.css:299-300 left these two light pairs un-darkened in the R124 sweep with an accurate-at-the-time "zero live consumers" note (all products archived, `categories.ts:6-12`). The restock recipe (`categories.ts:10-12`) says re-adding "a cat-* token in index.css … is all it takes" but doesn't mention the AA retune. Computed: gaming 211 80% 48% → 3.91:1 on its /10 tint; productivity 38 90% 45% → 2.44:1 (worse than three of the five values R124 fixed). Proposed + verified values: gaming 211 80% 36% → 5.99/5.82:1 (/10, /12); productivity 38 90% 30% → 4.77/4.65:1.
- **Fix (S):** darken both light values now (zero live consumers = zero visual risk) and/or add the AA check to the restock recipe in categories.ts's comment.

---

## 9. VERIFIED-OK (evidence-checked, no action)

1. **Zero raw hex outside brand marks** in 380+ source files (§2.1) — the WhatsApp/Google/Telegram/MetaTags 8 sites are the documented brand-mark set.
2. **Zero arbitrary `text-[Npx]` / `rounded-[…]` / `bg-[…]` classes** — enforced by `design-system-css.test.ts:177-186`.
3. **Weight vocabulary clean** — `font-medium`/`font-black` absent (same test :152-165); ramp rides 400/600/700 exclusively.
4. **B3-K1 + B3-K2 both landed** — title-clipping fix + 12px fine-print fixes verified at HEAD (`adbf91c`, `9e65bab`; §5).
5. **`--primary` hexes match the meta theme-color layer byte-for-byte** (MetaTags.tsx:67-68).
6. **StatusBadge/STATUS_TONE system** — single source, 8 variants, per-theme AA (in-CSS measured figures reproduce in my computation: success/12 = 7.70 dark, 4.98 light).
7. **Toast system** — status accents ride `--status-*` (test-pinned :136-150); light tuning present; description contrast 7.36:1; reduced-motion honored (:1399-1404).
8. **Charts token-driven** — chart-theme.ts reads CSS vars via getComputedStyle, MutationObserver theme reactivity; zero hex in recharts surfaces (canon claim TRUE).
9. **z-index layers** — no collisions; the ::after z-999 elevation overlays are correctly caged in z-index:0 stacking contexts; every fixed/sticky surface maps to a documented layer.
10. **!important discipline** — 7 occurrences, all in the reduced-motion kill-switch (legit override semantics); none elsewhere in src.
11. **No duplicate selectors** after the R118–R127 waves (only the intentional fallback+relative-color double declarations for computed borders, :231-250, and the deliberate desktop/mobile rule pairs).
12. **CSS layer hygiene** — `@layer base`/`utilities` correctly ordered; the un-layered Sonner override block is deliberate (specificity rationale documented :1135-1139); every one of the 40+ custom utility classes has ≥1 consumer except the F9 family.
13. **Arabic typography guards** — tracking collapse (:920-926), 1.3/1.7 line-heights, tabular-nums body, LTR isolation convention — all present and consumed.
14. **Focus system single-source** — global `:focus-visible` outline only (test-pinned); no competing ring styles found.
15. **Micro-type floor** — 11px is the smallest size anywhere; no sub-11px literal in production source (only in negative-guard test strings).

---

## 10. Recommended next actions (ordered)

1. **F4** one-line waiver fix → `impeccable detect src/` exits 0 (unblocks B3 Phase-1 gate).
2. **DESIGN.md + `.impeccable/config.json`** land together (§7 draft verbatim; config `ignoreFiles: ["**/node_modules/**", "src/**/__tests__/**"]`) — advisory-only, zero gate risk, turns Phase 3 on.
3. **F1 migration wave** (D2 → D3 → D4 → D1 severity maps) — mechanical, token answers exist; clears the light-theme AA hole and ~180 of the 232 admin raw-palette lines.
4. **F2 + F3 token additions** (destructive-surface, optional success-surface, tier family) — one index.css PR + the three destructive buttons + tierColor/profile/wallet/referrals call sites.
5. **F5/F7 docs truth pass** on FINAL_UX_SYSTEM.md + the ten admin comments.
6. **F6/F9/F10 hygiene PR** (radius-2xl token, dead opt-out classes, dead card-border token) + **F11** preemptive cat-value darkening.

— R128-A1, 2026-10-10, main @ 7d469d5
