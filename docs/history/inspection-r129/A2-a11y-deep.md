> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r129/A2-a11y-deep.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R129-A2 — WCAG 2.2 AA Deep Audit of the R128 Delta (a11y lane)

- **Agent:** R129-A2 (accessibility — READ-ONLY; zero source/test/config mutations, no installs, no git ops). Relaunched lane: the first run's partial draft was treated as a *claim set*, not a source — every figure below was re-derived from scratch at HEAD and three of its numbers were corrected (§1.3, §1.5); five findings are new to this pass (A2F13–A2F15, border census §1.2d, icon batch A2F9 widened).
- **Tree:** `main @ 76017f4`. Scope = the R128 appearance delta: the union of `ee294aa` + `4edfbe2` source files (50 non-test .ts/.tsx files; `git show --name-only`) judged against **WCAG 2.2 AA**. Prior a11y passes (R124-A3, R125-A1/A2/A6, R126-A13, R127-B15) are honored — nothing they own is re-reported; sibling R129 lanes A1 (adversarial) / B1 (test-truth) / B4 (security) are cross-referenced, not duplicated (notably A1-F1 = the unwired B-11 cart-stock feature, §2.3).
- **Canon:** `docs/ux/FINAL_UX_SYSTEM.md` — 11px Arabic type floor (§2), ONE focus system (§2), admin edge buttons ≥24px / storefront 44px (§6), icon contract (§5.1).
- **Method:** all contrast **computed by me** from the real HSL channel values in `index.css` (dark `:root` :143-232, light `.light` :292-383) via the WCAG relative-luminance formula, with bottom-up alpha compositing for every tint stack; in-CSS contrast comments were re-derived, never trusted (five of them verify exactly, §1.4). Usage forms censused by grep over `pages/admin` + `components/admin` + storefront delta files: `text-tier-*`, `bg-tier-*`, `border-tier-*`, `tierColor()` (lib/utils.ts:134-142), `text-cat-*`, `bg-cat-*/10`, `text-status-*` incl. `/70` `/80` alpha inks, `bg-status-*/5|8|10|12|15|60`, `bg-status-success-surface(/90)?`, `bg-primary/8|10|12|15`, `border-status-*`, `border-tier-*`, `border-primary/*`; the container class around each hit was read to pick the real surface (card / base / muted / gradient corner). Icon-only-button hunt = scripted scan of every `<button>` in the 50 touched files (tag + body parsed for text / `aria-label` / `title`). Keyboard/SR matrix by close read of the four new surfaces.

## 0. Verdict at a glance

| Grade | Count | Items |
|---|---|---|
| **P0 / P1** | 0 | — (the a11y half of the A1-F1 cart-stock P1 is "no UI exists", §2.3) |
| **P2** | 1 | A2F1 — login gate-banner subline fails AA in BOTH themes (3.65 D / 3.45 L); pre-existing on the buy variant, **replicated onto the new account variant by R128** — the fail now ships ×2 |
| **P3** | 5 | A2F2 topups bulk-reject 4.00 D (A1-F2's fix missed its 4th site) · A2F3 products letter avatar @opacity-70 (dark regressed below AA on 5/7 live hues; light fails 9/9) · A2F4 primary-text on primary/15 = 4.13 L (first-ever census of this family) · A2F5 CopilotPanel copy chip 20×20px (2.5.8) · **A2F13 orders discount label `success/80` 3.70 L — NEW in R128, missed by every prior pass** |
| **P4** | 9 | A2F6 risk error chip 4.41 D (dark-for-light trade) · A2F7 light micro-batch (bronze medal 4.44, success/70 3.18, chip-count /70 3.33) · A2F8 title-only icon buttons ×2 · A2F9 decorative icons without aria-hidden (login banners ×2 + the error/70 WifiOff family, dark 2.98) · A2F10 account-tab h1→h3 skip · A2F11 live-region parity (bell/copilot/notifications) · A2F12 sonner close 22px (documented) · **A2F14 orders coupon progress fill 2.46 L vs track (NEW in R128)** · **A2F15 dashboard legend dot 2.63 L (R128-changed, improved 1.77→2.63 but still <3:1)** |

**The migration's headline pairs all verify** — approve-button surface, the tier family at its real positions, the purple family (comment-exact), the warning /15 pills, and the 7 live cat hues on the chip idiom pass AA in both themes; five in-CSS contrast claims re-derive exactly (§1.4). What the full census found that nobody had computed lives at the *edges*: a dimmed subline copied onto a new banner, one destructive button the A1-F2 fix didn't reach, an opacity-70 letter avatar, the never-censused primary-chip family, and three `/60`-`/80` soft-success usages the R128 orders/dashboard craft batch introduced. `/notifications` is the best-keyboarded surface in the repo (§2.1). Reduced motion: **CLEAN** (§4).

---

## 1. Contrast census of the palette migration (WCAG 1.4.3 / 1.4.11)

### 1.1 Method + thresholds

- Text threshold **4.5:1** for everything in scope — the largest text pair here is 16px/700 (`text-base font-bold`) and 18px/700 money, both below the 18.66px-bold large-text line; 11px/400, 11px/600-700, 12px, 14px all take 4.5:1 (the repo's own convention — index.css:170-175 computes 4.5 for 11px-bold badge text; `--text-2xs`/`--text-3xs` = 11px, index.css:115-116).
- Icons / dots / rings / progress fills (non-text) take **3:1** (1.4.11) — applied only where the graphic is not redundant with adjacent text (stated per-case).
- Every tint stack composited bottom-up, e.g. the referrals medal = `--card` → `muted/0.20` (referrals.tsx:445) → `tier/0.10` (:76-78) → tier ink. Dark surfaces from `:root` (`--surface-card 220 20% 8%` :144, base :143, muted :200); light from `.light` (card `0 0% 100%` :293, base :292, muted :366). All ratios D=dark / L=light.

### 1.2 The census (every usage form grep finds in the delta's admin + storefront files)

**(a) Solid button surfaces**

| Pair (site, size) | D | L | Verdict |
|---|---|---|---|
| white on `--status-success-surface` (topups approve, 14px/700, topups.tsx:328; confirm-modal approve :538) | **5.05** | **5.89** | AA ✓ — the in-CSS claim verifies (§1.4) |
| white on success-surface**/90** over card (approve hover, topups.tsx:328/:538) | 5.80 | 4.77 | AA ✓ |
| white on `--destructive` (topups **bulk-reject hand-roll**, 14px/600, topups.tsx:540) | **4.00** | 5.00 | **AA ✗ dark** → A2F2 |
| white on `--destructive-surface` (Button destructive variant, button.tsx:32) | 4.52 | 5.00 | AA ✓ — A1-F2's fix verified |
| white on `--primary` (layout active badge 11px/700, layout.tsx:209) | 4.93 | 5.29 | AA ✓ |

**(b) Tier family — every composition the migration produced** (ink = `tierColor()`/`text-tier-*`)

| Composition (sites) | D range | L range | Verdict |
|---|---|---|---|
| tier ink on card (users.tsx:291 12px/400 · :1110 14px/700 · loyalty.tsx:529 12px/700 · storefront cards) | 8.20–10.53 | 5.23–6.45 | AA ✓ all 4 tiers |
| tier ink on `muted/30` (users.tsx:1298 read-only tier box, 14px/700) | 7.93–10.18 | 4.98–6.15 | AA ✓ |
| tier ink on `background/30` (wallet.tsx:1273 badge, 11px/700) | 8.34–10.71 | 5.23–6.45 | AA ✓ |
| **medals**: card → `muted/20` → `tier/10` → ink (referrals.tsx:445-448 + :76-78, 11px/700) | 6.81–8.55 | 5.11–5.39 (**bronze 4.44**) | AA ✓ except bronze-light 0.06 under → A2F7 |
| **profile badge** at its real position: card → `tier/8` (`bg-current/8`, profile.tsx:279) — see §1.3 for the geometry | 7.26–9.18 | 4.71–5.56 (bronze 4.71, gold 5.43) | AA ✓ at the position the badge occupies |
| profile badge at the gradient's from-corner (`tier/14`+`tier/8`, profile.tsx:35-38) — **unoccupied** (§1.3) | 5.59–6.75 | 3.94–4.68 | theoretical; no text renders there |
| tier icon on `tier/10` tile (loyalty.tsx:409-410) · solid tier dot on card (wallet.tsx:1253) · gold Trophy on card (referrals.tsx:437) [3:1] | 7.00–9.49 | 4.58–6.45 | AA ✓ |

**(c) Status family on its own tints** (the exact forms grep finds: `/10` system/pricing/alerts/topups…, `/12` StatusBadge, `/15` warning pills + risk chips; lower alphas `/5` `/8` are strictly closer-to-card and all pass — computed 4.80–8.82 D / 5.43–5.86 L)

| Ink (token value D / L) | on card | on own /10 | on own /12 | on own /15 |
|---|---|---|---|---|
| success (152 65% 50 / 152 60% 28) | 9.48 / 5.89 ✓ | 8.04 / 5.11 ✓ | 7.71 / 4.96 ✓ | 7.23 / 4.75 ✓ |
| warning (38 92% 56 / 38 90% 28) | 9.49 / 6.07 ✓ | 8.04 / 5.27 ✓ | 7.72 / 5.12 ✓ | **7.23 / 4.90 ✓** (mission pair) |
| error (0 80% 62 / 0 75% 42) | 5.17 / 6.38 ✓ | 4.70 / 5.38 ✓ | 4.59 / 5.20 ✓ | **4.41** / 4.93 — dark 0.09 under → A2F6 |
| info (211 90% 58 / 211 80% 38) | 5.74 / 6.45 ✓ | 5.10 / 5.56 ✓ | 4.96 / 5.39 ✓ | 4.74 / 5.14 ✓ |
| low-stock (22 92% 58 / 22 88% 36) | 6.86 / 5.75 ✓ | 6.04 / 4.97 ✓ | 5.85 / 4.82 ✓ | 5.57 / 4.61 ✓ |
| purple (262 83% 70 / 262 70% 45) | 5.54 / 8.43 ✓ | 4.93 / 7.10 ✓ | **4.80 / 6.85 ✓ (comment-exact)** | 4.59 / 6.49 ✓ |

The mission's priority pairs: **`bg-status-warning/15 + text-status-warning`** (layout.tsx:209/221/1163/1326, topups.tsx:1221, tickets.tsx:420, products.tsx:378/409, promotions.tsx:529, risk.tsx:87) = **7.23 D / 4.90 L — AA ✓ both themes**. **`text-status-purple`** (users.tsx:1023-1027 on `/10`, pricing.tsx:1207/1397 on `/10`, risk.tsx:91 on `/15`, system.tsx:1662+/1685+ icon tiles on `/10`) = **all pass both themes** (tightest 4.59 D on /15). **`bg-status-success-surface`** = §1.2a. `warning` on `warning/8` (dashboard CTA, dashboard.tsx:830, 12px/600) = 8.36 / 5.43 ✓.

**(d) Border family (`border-status-*`, `border-tier-*`, `border-primary/*`) — 1.4.11 census, all informational**: every tinted border in the delta computes **1.17–2.47:1 against card** (e.g. `border-status-warning/25` 1.67 D/1.44 L, `border-status-error/28` 1.42/1.64, `border-tier-gold/20` 1.48/1.34, `border-primary/22` 1.17/1.45, `border-primary/40` 1.47/2.01). None is a 1.4.11 failure because **none is the sole visual indicator**: every bordered pill in the tree pairs the border with a tinted bg + same-hue ink (status-badge.tsx:31-42, risk.tsx:87-94, referrals.tsx:76-78, wallet.tsx:738-741, login.tsx:183), so state is carried redundantly by ink+fill. Registered as compliant-by-design; the only border that IS a sole indicator — the keyboard focus ring — clears 3:1 everywhere (§1.2f).

**(e) Primary-tinted chips (never censused before — A1's §6 table skipped this family)**

| Pair (sites, size) | D | L | Verdict |
|---|---|---|---|
| `text-primary-text` on `bg-primary/15` (risk.tsx:308 «الكل» chip 12px/700 · alerts.tsx:571 active severity count · layout.tsx:193 active nav 14px/700) | 5.25 | **4.13** | **AA ✗ light** → A2F4 |
| `text-primary-text` on `bg-primary/10` (users.tsx:872, tickets.tsx:472, admins.tsx:256/302, settings.tsx:317, account-tab.tsx:250, two-factor-setup.tsx:274/325 — 9 sites, 11–14px/700) | 5.46 | **4.49** | 0.01 under — folds into A2F4 |
| `text-primary-text` on `bg-primary/12` (StatusBadge `primary` variant, status-badge.tsx:40) | 5.38 | 4.34 | dormant — zero `variant="primary"` consumers (grep); A2F4's fix clears it too |
| login banner headline on `bg-primary/8` (login.tsx:183/205, 14px/700) | 5.53 | 4.64 | AA ✓ |
| login banner **subline `text-primary-text/75`** (login.tsx:198/:212, 11px/400) | **3.65** | **3.45** | **AA ✗ both** → **A2F1** |

**(f) Focus ring (1.4.11 sole-indicator):** `--ring` vs card **3.77 / 5.29**, vs base **3.98 / 4.81**, vs muted **3.32 / 4.49**, vs overlay **3.44 / 5.29** — clears 3:1 on every surface-ladder step in both themes; the index.css:888-892 claim verifies.

**(g) Category hues (`text-cat-*` on own `/10` over card — the storefront chip idiom at 11px/600, ProductCard.tsx:509; admin letter tile at 16px/700, products.tsx:91-100)**

| Hue | chip ink D / L | letter @opacity-70 (products.tsx:338) D / L |
|---|---|---|
| streaming | 4.97 / 5.58 ✓ | 3.13 / 3.28 ✗✗ |
| music | 8.44 / 4.86 ✓ | 4.87 / 2.84 ✗L |
| software | 5.72 / 4.99 ✓ | 3.52 / 2.92 ✗✗ |
| vpn | 7.38 / 4.99 ✓ | 4.35 / 2.91 ✗L |
| ai-tools | 6.18 / 4.97 ✓ | 3.74 / 3.05 ✗✗ |
| seo-tools | 5.85 / 4.90 ✓ | 3.56 / 3.01 ✗✗ |
| education | 9.25 / 4.88 ✓ | 5.28 / 2.82 ✗L |
| gaming (preview-only) | 6.13 / **3.91** ✗L | 3.72 / 2.53 ✗L |
| productivity (preview-only) | 8.47 / **2.43** ✗L | 4.89 / 1.85 ✗L |

→ All **7 live hues pass AA on the chip idiom in both themes** (4.86–9.25); gaming/productivity light = the documented A1-F11 retired pair (admin-preview-only, carried §10). The **letter avatar at opacity-70 fails: dark 3.13–5.28 (5/7 live hues < 4.5), light 1.85–3.28 (9/9 fail)** → **A2F3**.

### 1.3 The fails/marginals, with the math (WCAG relative luminance, alpha-composited)

**A2F1 [P2] — login gate-banner subline fails AA in both themes; R128 replicated the pre-existing fail onto a brand-new surface.**
`login.tsx:198` and `:212`: `<p className="text-2xs text-primary-text/75 mt-0.5">ثوانٍ معدودة بدون كلمة مرور</p>` — 11px/400 → 4.5:1 required — on the banner `bg-primary/8` (login.tsx:183/:205) over the login card (`bg-card`, login.tsx:169).
- Dark: bg = primary(348 80% 48%) @0.08 over card(220 20% 8%) → L=0.00881; ink = primary-text(348 80% 65%) @0.75 over that bg → L=0.16463; C = 0.21463/0.05881 = **3.65**.
- Light: bg = primary(348 80% 46%) @0.08 over white → L=0.87127; ink @0.75 → L=0.21708; C = 0.92127/0.26708 = **3.45**.
History (`git show ee294aa -- login.tsx`): the `/75` subline pre-existed on the **buy** banner (unchanged context line, diff :159); the R128 F-4 work added the **account** variant and copied the subline verbatim (diff :198-212 `+`). Net effect of the delta: the failing pair now renders on two banners where it rendered on one. Fix (XS): drop the `/75` — full `text-primary-text` on the same bg measures 5.53 / 4.64 (both pass); or `text-muted-foreground` (8.02 / 6.68, §1.2c context row).

**A2F2 [P3] — topups bulk-reject rides raw `--destructive` at 4.00:1 dark: the A1-F2 fix reached button.tsx but not this hand-rolled sibling.**
`topups.tsx:533-541`: the bulk-confirm modal's reject branch styles a **default**-variant Button with `bg-destructive hover:bg-destructive/90 text-destructive-foreground` (14px/600). White on `--destructive` (0 80% 58%): L(ink)=1.0, L(surface)=0.21241 → C = 1.05/0.26241 = **4.00** < 4.5. R128's own A1-F2 fix added `--destructive-surface` (0 80% 52% → **4.52** ✓) and wired it into the Button `destructive` variant (button.tsx:30-33) — this site bypasses the variant, so it kept the raw token; the approve branch directly above it gained `bg-status-success-surface` in the same 4edfbe2 hunk (@@ -514,11 +535,11), which is exactly why the census re-checks delta-adjacent lines. Pre-existing text, delta-adjacent miss, money-path confirm button. Fix (XS): `bg-destructive` → `bg-destructive-surface` (one class, same shape as the approve sibling).

**A2F3 [P3] — the admin products category letter avatar renders cat ink at opacity-70: dark regressed below AA on 5/7 live hues; light fails 9/9 (though improved ~2.3× vs the raw palette).**
`products.tsx:321-338`: the no-image tile applies `CATEGORY_INITIAL_COLOR` (`bg-cat-*/10 text-cat-*`, :91-100) and renders the product's initial as `text-base font-bold opacity-70` (16px/700 → 4.5:1). Stack: card → cat/10 → cat ink @0.70.
- Dark (live hues): streaming 3.13, software 3.52, seo-tools 3.56, ai-tools 3.74, vpn 4.35 — **five under 4.5**; music 4.87, education 5.28 pass.
- Light: 1.85 (productivity) – 3.28 (streaming) — **all nine under**.
History (`git show 4edfbe2^:products.tsx:82-92`): the old recipe was `bg-*-500/20 text-*-300` + the same opacity-70 — computed old pairs: **dark 4.75–5.36 (all 7 live hues passed)**, light 1.15–1.28 (catastrophic). So R128 fixed light (≈+2) but **dropped dark below AA on five hues** — a genuine dark-theme regression introduced by the token swap. The letter duplicates the adjacent product name (products.tsx:342, 14px/700 foreground) — a defensible decorative argument, but nothing marks it `aria-hidden` and it is real text. Fix (S): `opacity-70` → full-opacity ink (all 7 live hues then measure 4.86–9.25 both themes, §1.2g) or `aria-hidden` + a stronger tint if the soft look is the point.

**A2F4 [P3] — `text-primary-text` on `bg-primary/15` fails light (4.13); the /10 family sits at 4.49 (0.01 under). First census of this family.**
Light math: bg = primary(348 80% 46%) @0.15 over white → L=0.76847; ink = primary-text (same channels) L=0.14838 → C = 0.81847/0.19838 = **4.13**. Sites: risk.tsx:308 (active «الكل» filter chip, 12px/700), alerts.tsx:571 (active severity-tab count badge, 11px/700), layout.tsx:193 (active sidebar nav item, 14px/700) — pre-existing classes, never computed before (A1 §6 has no primary-chip row; the index.css purple comment's method was never applied to primary). The /10 form (9 sites, §1.2e) at 4.49 and the dormant /12 badge variant at 4.34 are the same seam. Fix (S, one place): nudge light `--primary-text` 46%→**43%** lightness — re-derives **4.60 on /15 and 5.01 on /10** (clears all 12+ live sites at once; note 44% is NOT enough: 4.44 on /15 — computed) — or switch the three /15 sites to the segmented-raised idiom (`bg-card text-foreground`) that orders/users/tickets/topups/products already use for value-neutral active chips.

**A2F13 [P3] — NEW in R128: the order-detail discount label renders `text-status-success/80` at 3.70:1 light.**
`orders.tsx:1153-1156` (added in 4edfbe2, diff `+`): `<div className="bg-status-success/5 rounded-2xl p-3 border border-status-success/15"><div className="flex items-center gap-1.5 text-2xs text-status-success/80 mb-1.5">…إجمالي الخصومات` — 11px/400 on success @0.80 over success/5 over card. Light: bg (success 152 60% 28% @0.05 over white) L=0.92875; ink @0.80 over that → L=0.23534; C = 0.97875/0.28534 = **3.70** < 4.5. Dark passes (6.07). The bold value directly below it (`font-bold text-base text-status-success`, orders.tsx:1158) measures 8.80 D / 5.49 L ✓ — only the small label fails. Fix (XS): drop the `/80` (full ink on the same /5 box = 5.49 L ✓).

**A2F6 [P4] — risk's active error chip dropped to 4.41:1 dark (0.09 under) — the migration's one dark-for-light trade on the status family.**
`risk.tsx:88` TONE_CHIP error = `bg-status-error/15 text-status-error`, rendered at risk.tsx:305-312 (12px/700). Dark: bg = error(0 80% 62%) @0.15 over card → L=0.01611; ink L=0.24178 → C = 0.29178/0.06611 = **4.41**. Pre-R128 (`red-400 on red-500/15`, `git show 4edfbe2^:risk.tsx`): computed **5.82 D / 2.27 L** — the swap fixed light (2.27→4.93) and regressed dark (5.82→4.41). One chip, 0.09 under. Fix (XS): dark `--status-error` 62→64% lightness re-derives **4.63 on /15** and 5.48 on card (both computed) — or accept and document as the error family's known marginal.

**A2F7 [P4] — light-theme micro-fails batch (one commit):**
- referrals bronze **medal** light **4.44** (11px/700 rank digit; referrals.tsx:76-78 pills on the `bg-muted/20` row :445-448): bg L=0.84202, bronze(40 90% 30%) L=0.15078 → 4.44 — 0.06 under (old amber-600 medal measured 2.78 — the migration nearly cleared it).
- referrals credited-at timestamp `text-status-success/70` light **3.18** (referrals.tsx:190, 11px/400): success(152 60% 28%) @0.70 over card → ink L=0.28019 vs card L=0.95374… C=3.18. Dark passes (5.15).
- risk chip-count suffix `opacity-70` light **3.33** (risk.tsx:313, 12px/600 «(N)»): muted-foreground @0.70 → 3.33 (dark 4.50 — passes with 0.003 margin).
Fix (XS each): drop the opacity modifiers or pin at /85.

**A2F14 [P4] — NEW in R128: the order-detail coupon usage progress fill fails 1.4.11 light.**
`orders.tsx:1213-1217` (added in 4edfbe2, diff `+`): fill `bg-status-success/60` inside a `bg-muted/40` track (both over card). Fill vs track: dark **3.90** ✓, light **2.46** ✗ (<3:1). The usage count is duplicated as adjacent text («N×», orders.tsx:1218-1220), so the graphic is not the sole encoding — light-only, non-text. Fix (XS): `/60` → `/80` (light fill vs track re-derives ≈3.9) or a solid success fill.

**A2F15 [P4] — dashboard legend dot `bg-status-success/60` at 2.63:1 light (R128-changed, improved but still under).**
`dashboard.tsx:1077`: the «طلبات بكوبون» legend swatch on the chart card. R128 changed it from `bg-emerald-500/60` (computed old: **3.35 D / 1.77 L**) to the token (**4.08 D / 2.63 L**) — dark now passes, light remains under 3:1. The chart's coupon bars share the value: `fill={chart.success}` at `fillOpacity={0.6}` (dashboard.tsx:1131-1137, pre-existing) = success @0.6 over the white card = the same **2.63 L**. Each legend entry carries its Arabic label adjacent (dashboard.tsx:1073-1078), and the bar lengths are the data — color is not the sole encoding — so P4, not higher. Fix (XS): legend dot + `fillOpacity` 0.6→0.8, or `chart.success`-solid legend matching the warning sibling's solid `bg-status-warning` (:1073).

**A2F9 (icon-contrast half) — the error-state `WifiOff` icons at `text-status-error/70` on `bg-status-error/8` tiles compute 2.98:1 dark** (security.tsx:569, :860; promotions.tsx:482; dashboard.tsx:1282) — 0.02 under the 3:1 non-text bar (light 3.51 passes). They are decorative (the adjacent bold «تعذّر تحميل…» carries the meaning) but carry no `aria-hidden` — folded into the A2F9 hygiene batch; dropping the `/70` also clears the icon contrast (full error ink on error/8 = 4.80 D, §1.2c).

### 1.4 Verified-claims register (in-CSS/in-code contrast claims, re-derived)

1. `--status-success-surface` white-ink **5.05 D / 5.89 L** — topups.tsx:323-327's "5.05:1 with white in BOTH themes" is honest (light better than claimed).
2. `--status-purple` "4.80:1 on the /12 tint, 4.93:1 on the /10" (index.css:170-175) — **re-derived 4.80 and 4.93, exact**; light 6.85 on /12 also exact.
3. `--destructive-surface` "white on 52% = 4.50:1" (index.css:207-212) — **4.52**; A1-F2's "3.99" for the raw token re-derives **4.00**.
4. `--tier-*` "AA by construction" (index.css:219-220, A1-F3) — the comment's raw-pair fail figures verify **exactly** (slate-500 on dark card **3.91**, amber-600 on light card **3.19**, cyan-600 on light card **3.68** — all re-derived), and the new tokens are AA at every position text actually renders (§1.2b) except the two P4 marginals (bronze medal 4.44 L; error chip 4.41 D is the status family, not tier).
5. Focus-ring claim (index.css:888-892) — **3.32–4.81 across card/base/muted (+overlay 3.44/5.29), both themes** — holds.
6. Light cat-token block (index.css:296-316) — the five documented darkened hues re-derive ≥4.5 on /10, /12, /15 (e.g. education 42 90% 28%: 4.88/4.74/4.54 claimed → 4.88/4.74/4.54 computed ✓); the 7 live hues all pass on the /10 chip idiom (§1.2g).

### 1.5 Corrections to the first-run draft (superseded figures)

- Profile badge: the draft's "mid-gradient /11 → bronze 4.52" is wrong — card→tier/11→tier/8→ink computes **4.09** light. The badge nonetheless passes at its real position: the gradient is `from-tier-X/14 via-card to-card` (profile.tsx:35-38), and since **both `via` and `to` are card, every point past the gradient-line midpoint is pure card**; the badge is inline-start-aligned (RTL = right edge) at the top of the card, i.e. at ≈54–88% along the axis (projection onto the diagonal for a ~600×220 card) — firmly in the card half. Real-position worst tier = bronze on card→tier/8 = **4.71 L** (gold 5.43); the from-corner 3.94 is where no text sits.
- A2F4 fix: the draft's "46→44% clears 4.5" does not — 44% computes **4.44** on /15; **43%** is the nudge that clears (4.60 /15, 5.01 /10).
- A2F1 framing: the draft called the subline "new in R128"; the buy-banner subline pre-existed (ee294aa diff context :159) — R128 replicated it onto the new account banner (§1.3 history).
- A2F6 fix estimate: error 62→64% gives **4.63** on /15 (draft said "≈4.7"); still clears.
- Touched-file count: **50** non-test source files in the two commits' union (draft said 41); the icon-only scan below covers all 50.

---

## 2. Keyboard / focus matrix on the new surfaces

### 2.1 `/notifications` (notifications.tsx) — the cleanest surface audited this round ✓

- **Focus order = DOM order**; no roving tabindex (no composite widget); no traps; every interactive element is a real `<button>` — row :309-348, action chip :353-362, mark-read :365-372, «تحديد الكل» :244-251 (min-h-11), LoadMoreButton :384-391 (min-h-11).
- **Visible focus everywhere:** global `:focus-visible` 2px solid `--ring` outline + 2px offset (index.css:896-899) on all controls; the row button adds its own `focus-visible:ring-2 focus-visible:ring-ring rounded-xl` (:312) — ring color clears 3:1 on card (§1.2f). Note (no action): this is the button.tsx ring idiom rather than the canon's "ONE focus system" outline (FINAL_UX_SYSTEM §2); both are 2px `--ring`, only offset differs (1px vs 2px); the deviation originates in button.tsx (pre-existing), R128 inherited it.
- **Screen readers:** row button carries `aria-label={n.title + " — افتح"}` (:313); icons aria-hidden (:249, :318, :360, :370); message line `dir="auto"` (:338); counts pluralized via Arabic forms (:43-49). Gaps → A2F11: the unread dot (:329-331, `badge-pulse` span) and the «عرض X من Y» pill (:231-238) are visual-only; the read-state flip (border/tint/dot removal + mark-read unmount) announces nothing; notifications-page.test.tsx pins none of it (7 behavior tests, 0 aria assertions).
- **Targets:** all ≥44px (`min-h-11` ×4) — no bare text links on the page, so the 24px floor never comes into play.
- **2.4.11 focus-not-obscured:** no page-local sticky chrome; storefront Navbar covered by the global `scroll-padding-top: 4.25rem` (index.css:416-431) + MobileNav bottom reservation (:433-437).

### 2.2 Login gate banners (login.tsx:179-229) — semantics right; icons not hidden

- Both variants: `role="status" aria-live="polite"` on the banner container (:181-182, :203-204) ✓; **no focusable elements inside** ✓ (div + icon + text only — no trap possible); headline 14px/700 on `bg-primary/8` passes AA (5.53/4.64, §1.2e); the subline does not (A2F1).
- The banner icons (`ShoppingBag` :186, `intent.surface.icon` :208) are decorative but carry **no `aria-hidden`** — the app's own convention hides every decorative lucide elsewhere in the delta (notifications ×4, ValueChip, CopilotPanel trace ×3). Most SRs ignore unlabelled inline SVGs, so this is convention-inconsistency, not an announcement bug → A2F9 [P4].
- The inner icon tile `bg-primary/15` (:184, :206) is decoration, not a text surface — no threshold applies.
- Tabs: a real `<button aria-current="page">` + a Link, both `min-h-11` (:143-164) ✓; sr-only h1 (:135) is the page's only h1 ✓; guests → skeleton + redirect guard.

### 2.3 Cart stock verdicts + checkout block — the a11y question is moot: no UI exists

Owned by **R129-A1 F1** (P1 there; independently re-verified this pass): `lineStockNotice` / `lineStockStatus` / `lineStockBlocksCheckout` / `cartHasBlockingStock` (lib/cart.tsx) have **zero production consumers** (grep: lib/cart.tsx + cart-stock-snapshot.test.tsx only); no `addItem` caller passes `stockCount`; the checkout re-quote patches price only. a11y consequences for this lane's register:
- **3.3.1/3.3.2 (error identification/description):** there is no client-side checkout block to announce — «إتمام الطلب» (cart.tsx:418-431) is unconditionally enabled and a sold-out line proceeds to the charge-time 409. The verdict UI never renders, so the buyer still meets the failure exactly where B-11's record claims they no longer do.
- The only live B-11 behavior is `stockAwareCeiling` inside `capRaise` (lib/cart.tsx): the day a caller passes `stockCount`, the cart "+" button (aria-label «زيادة كمية…», cart.tsx:370) becomes a **silently-dead control** at the snapshot ceiling — no disable, no notice. Wire-creators must pair it with the verdict row (copy already exists: «متبقٍ N فقط — عدّل الكمية», lib/cart.tsx:172) and announce it (`role="status"`).
- What IS shipped on this surface is clean: steppers/trash are native `<button type="button">` ×3 per line, all `min-h-11 min-w-11` (44px) with per-item Arabic aria-labels (cart.tsx:347-380 — decrement doubles as remove at qty 1 :350-352), CTAs h-12/min-h-11 (:419-445); **press-spring is a CSS `transition` on transform (index.css:854-858) — keyboard operability is unaffected** (native activation; the `:active` scale is pointer-state cosmetics, and the reduced-motion guard kills even that transition, §4).

### 2.4 CopilotPanel progress trace — per-line silence is CORRECT; completion silence is the gap

- `ProgressTraceLine` (CopilotPanel.tsx:357-392): `✓`/`✗`/emoji prefixes strip to lucide `Check`/`X`/tool icons, **all `aria-hidden`**, with the Arabic label in a sibling `<span>` — AT reads the label only, exactly as the :349-356 comment claims. Transport strings keep the glyphs by design (:361-393); no stray `✓`/`✗` renders anywhere in src (grep: comments + this documented transport only).
- **No aria-live on the streaming trace — correct**: a live region would re-announce every SSE line; the trace is a visual progress feed (and the loading row's `animate-spin` Loader2, :1291, is guard-killed).
- But the **loading→answer transition is also silent** (:1284-1293 «جارٍ المعالجة…» unmounts, the answer mounts with no announcement) and `turn.error` (:1295-1300) renders without `role="alert"` — an SR operator gets no completion/failure cue in a panel whose whole job is waiting on an agent. → A2F11.

---

## 3. Screen-reader truth of the glyph swaps + the inverse hunt

### 3.1 The four ✓→Check swap sites — all correct ✓

| Site | Evidence |
|---|---|
| product.tsx:2028-2031 («رصيد كافٍ») | `<Check className="w-3 h-3" aria-hidden="true" />` after the Arabic text, inline-flex on the reading line ✓ |
| settings/account-tab.tsx:259-266 («مفعّلة») | `aria-hidden` + Arabic label ✓ |
| alerts.tsx:643-651 («أنت على اطلاع كامل بكل شيء») | `aria-hidden` + Arabic label ✓ |
| CopilotPanel.tsx:370-392 (trace lines) | `aria-hidden` + `<span>` label ✓ (§2.4) |

Render-layer grep for remaining `✓`/`✗`: comments + CopilotPanel's documented transport only — clean.

### 3.2 Inverse hunt — icon-only controls without accessible names in the 50 touched files

Scripted scan (every `<button>`, tag+body parsed for text/aria-label/title):

- **A2F8 [P4] — exactly two icon-only buttons carry `title` but no `aria-label`** (title-as-name fallback): `dashboard.tsx:170-177` (CSV export, `title="تصدير بيانات المخطط CSV"`, p-1.5 + w-3.5 = 26×26px) and `layout.tsx:1428-1435` (data refresh, `title="تحديث البيانات"`, p-2 + w-5 = 36×36px). Both pre-existing buttons in R128-touched files; every sibling icon-button in the delta is properly labeled (alerts.tsx:746-767, coupons.tsx:743-775, provider-card.tsx:214-222, products.tsx:1155-1161, layout hamburger :1308-1318 w/ aria-expanded + aria-controls, sidebar collapse :1172-1178). Fix (XS): add `aria-label` mirroring the title.
- Everything else the scan surfaced is labeled ✓ — including the R125-A6 fixes that still hold at HEAD (collapsed sidebar links layout.tsx:184, bell button + panel NotificationBell.tsx:352-368/:517-518/:549-553, notifications rows, cart steppers).
- One labeled-but-tiny control: **A2F5 [P3] — CopilotPanel's answer-copy chip is a 20×20px target** (CopilotPanel.tsx:1377-1390: `p-1` + `w-3 h-3` icons; aria-label present and state-aware «نسخ/تم النسخ/تعذّر النسخ»): WCAG **2.5.8 AA requires ≥24×24**; the admin dialect's own floor (FINAL_UX_SYSTEM §6 "admin edge buttons ≥24px AA") is also broken. It is a *local* reimplementation of the shared CopyButton (44px, aria-live lifecycle feedback, components/CopyButton.tsx) on a control whose glyphs R128 itself swapped (copied/failed now render Check/X). Fix (XS): `p-1`→`p-2` (28px) or adopt the shared CopyButton.

---

## 4. Reduced motion — CLEAN, with the guard cited

- The global kill-switch (index.css:1147-1166): `@media (prefers-reduced-motion: reduce)` sets `animation-duration: 0.01ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; scroll-behavior: auto !important` on `*, ::before, ::after` — one wildcard, no per-animation maintenance; the `!important` beats inline styles. Sonner chrome has a second block (index.css:1453-1460). Recharts is canvas, not CSS animation — outside the guard's scope by nature.
- **R128's new motion surface, checked one by one:** `press-spring` additions (cart steppers/trash cart.tsx:349/:369/:378, dashboard CTA :830, layout nav items :1234/:1249, bell actions NotificationBell.tsx:536/:548, MobileNav tabs :159) — a *transition* → killed by `transition-duration` ✓ (the `:active` transform state itself is an instant, non-animated change). `num-pop` additions (MobileNav.tsx:212, NotificationBell.tsx:378 — key-remounted badges) — an *animation* → 0.01ms + 1 iteration, lands at the final frame instantly ✓ (`num-pop` keeps fill-mode `both` but its end state is identity, index.css:874-876). `badge-pulse` (notifications.tsx:330, NotificationBell.tsx:373) and `animate-pulse` (topups.tsx:1221) — infinite loops → pinned to one 0.01ms iteration ✓. The RTL shimmer reverse (index.css:688-690) is a direction flip, still killed ✓. The fill-mode `both→backwards` change (index.css:723-744, R128-A5-1) is motion-*correctness*, not new motion — the guard comment's 0.01ms-finish landing strategy (:1147-1154) still applies to all four backwards-filled entrances ✓.
- **No new keyframes were added in R128** (index.css diff: token values, shimmer direction, fill-mode strings only) — nothing to re-cage. **Section verdict: CLEAN, zero exceptions.**

## 5. Target sizes on new interactive elements (2.5.8 census, touched files)

- **/notifications:** every control ≥44px (§2.1) — exceeds both the 24px AA floor and the storefront 44px standard.
- **Cart:** steppers/trash 44px (`min-h-11 min-w-11`, cart.tsx:347-380), CTAs h-12 / min-h-11 (:419-445) ✓.
- **Login:** tabs + submit ≥44px (min-h-11, :143-164) ✓.
- **Admin small controls (census of `p-1*` buttons in the touched files):** `p-1.5 + w-3.5` = 26px (alerts :445/:751/:763, coupons :748/:767, dashboard :173, provider-card :216, products :1158 — all labeled ✓); `p-1.5 + w-4`/`h-7` = 28px (products :1100); sidebar collapse `p-1 + w-3.5` = 26px (layout.tsx:1175) — **all ≥24px, 2.5.8 AA pass** (below the storefront 44px standard, which the canon's admin dialect explicitly allows).
- **Fails:** CopilotPanel copy chip **20px** (A2F5, §3.2) and the Sonner toast close **22×22** (index.css:1296-1301 — the 96-F7 comment documents the size trade; the `@media (hover:none)` block :1315-1327 makes it visible on touch, but 2.5.8 counts pixels) → A2F12 [P4], known/documented, library chrome.

## 6. Heading structure

- **/notifications: exactly one h1** (notifications.tsx:224, `text-2xl font-bold`) — and it is the page's only heading, so no skip is possible ✓.
- **Admin h1 unification holds** (census at HEAD, all 21 `pages/admin/*.tsx`): **19 pages render exactly one h1 each; dashboard renders 0 by design** (rides the shell's top-bar h1, layout.tsx:1332 `font-bold text-sm`); whatsapp's promoted h1 present (whatsapp.tsx:359, `text-xl font-bold`). The size family is pinned by `admin-h1-unification.test.ts:31-53`. Known-open (not re-reported): the shell top bar renders its own h1, so every admin *document* carries two h1s (A3-r128 §9, documented inside the pinning test).
- **h1→h3 skip:** **A2F10 [P4]** — the settings **account tab** renders `h3` «بيانات الحساب»/«تغيير كلمة المرور» (account-tab.tsx:296, :368) with **no h2 anywhere in that tab** (settings.tsx's four h2s live in other tabs/sections :389/:601/:640/:661) — document order h1→h3 when the account tab is active. Best-practice break, not an AA failure (the tablist carries the sectioning). two-factor-setup's h3s (:140/:162/:174 region) live inside a dialog (own a11y tree — fine). All other multi-level admin pages step h1→h2→h3 correctly (pricing :663→:1275, system :756→:1399, promotions :344→:522, security :543) ✓.
- **Footer h3→h2 (R128 item): verified** — Footer.tsx:60 + :85 are the file's only two headings, both h2, inside two `nav[aria-label]` landmarks; every storefront page owns an h1 before the footer (only the transient auth/telegram callback screens lack one), so the worst case is h1(page)→h2(footer) — correct, **no new skips** ✓. (The change fixed the old 1→3 skip on pages whose only content was the h1 + footer.)

## 7. WCAG 2.2-specific criteria (first-pass checks + the 3.3.x mission item)

- **2.5.8 target size minimum:** census in §5 — AA fails only at CopilotPanel copy (20px) + Sonner close (22px, documented); the p-1.5 admin family (26-28px) passes; notifications/cart/login are 44px+. The admin dialect's ≥24px floor is broken only by the copy chip.
- **2.4.11 focus not obscured (Minimum):** the R111 fix holds (index.css:416-437: `scroll-padding-top: 4.25rem` against the sticky Navbar/admin bar; bottom MobileNav reservation; the sticky-buy-bar `:has()` extension :437-443). New-surface check: /notifications adds no sticky chrome of its own ✓.
- **Focus appearance (2.4.13 AAA / 1.4.11 AA, informational):** global indicator = 2px solid `--ring` outline, 2px offset (index.css:896-899) — thickness ✓, area ✓, and `--ring` clears 3:1 against every surface-ladder step in both themes (§1.2f). Button-family ring variant (2px `ring-ring` + 1px offset, button.tsx:8) also ✓. Two focus idioms coexist (outline vs ring) — pre-existing canon deviation noted in §2.1, no action this round.
- **2.4.7 focus visible / reachable:** zero `tabIndex={-1}` on any control in the touched files — the three hits are dialog containers for programmatic focus, the correct pattern (layout.tsx:1287, Navbar.tsx:460, NotificationBell.tsx:505); no `aria-hidden` on focusable elements found; the alerts row-button cluster keeps its `sm:group-focus-within:opacity-100` reveal (alerts.tsx:741-744, the R125-A6 B-2 fix) ✓.
- **3.3.1 / 3.3.2 on the cart-stock checkout block:** no block exists (§2.3, R129-A1 F1) — the error the block would identify is still surfaced only at charge time by the server path (409). For the surfaces that DO ship error identification in the delta: banners carry text + icon + `role="status"` (login banners, login.tsx:181/:203), error cards carry bold Arabic titles + retry (FetchErrorCard; security.tsx:565-575, dashboard/promotions WifiOff cards) — the pattern is sound where it renders. The wiring decision (A1-F1) should ship the verdict row WITH `role="status"` + the Arabic reason text, satisfying 3.3.1/3.3.2 at the moment it gains a UI.

---

## 8. P-graded findings (full list, ranked)

| # | Grade | Finding | Fix (effort) |
|---|---|---|---|
| A2F1 | **P2** | Login gate-banner subline `text-primary-text/75` 11px/400 = **3.65 D / 3.45 L** (login.tsx:198, :212) — pre-existing on the buy banner, replicated onto the NEW account banner by ee294aa; fails AA both themes ×2 | drop `/75` (→5.53/4.64) — XS |
| A2F2 | **P3** | topups bulk-reject `bg-destructive` + white = **4.00 D** (topups.tsx:540) — A1-F2's `--destructive-surface` fix missed this hand-rolled 4th site, one branch below the R128-edited approve sibling; money-path confirm button | `bg-destructive-surface` (4.52) — XS |
| A2F3 | **P3** | products category letter `opacity-70` on cat/10 tile: dark **3.13–5.28** (5/7 live hues < 4.5 — regressed from all-pass 4.75–5.36), light **1.85–3.28** (9/9 fail; improved from 1.15–1.28) (products.tsx:338) | full-opacity ink (all live hues ≥4.86 both themes), or `aria-hidden` + stronger tint — S |
| A2F4 | **P3** | `text-primary-text` on `bg-primary/15` = **4.13 L** (risk.tsx:308, alerts.tsx:571, layout.tsx:193); the /10 family (9 sites) at **4.49 L**; dormant /12 badge variant 4.34 — first census of this family | light `--primary-text` 46→**43%** (→4.60 /15, 5.01 /10 — computed; 44% is NOT enough), or chip-idiom switch — S |
| A2F5 | **P3** | CopilotPanel answer-copy chip **20×20px** (CopilotPanel.tsx:1377-1390) — 2.5.8 AA fail + local reimplementation of the 44px shared CopyButton | `p-2` or shared CopyButton — XS |
| A2F13 | **P3] (NEW in R128)** | orders discount label `text-status-success/80` 11px/400 = **3.70 L** (orders.tsx:1155, added in 4edfbe2) — the bold value below it passes; only the label fails | drop `/80` (→5.49 L) — XS |
| A2F6 | **P4** | risk active error chip **4.41 D** (risk.tsx:88/:305-312) — migration traded old dark 5.82 for light 2.27→4.93 | dark error 62→64% (→4.63 /15, 5.48 card — computed), or document — XS |
| A2F7 | **P4** | light micro-batch: bronze medal **4.44** (referrals.tsx:447), success/70 timestamp **3.18** (referrals.tsx:190), chip-count /70 **3.33** (risk.tsx:313) | drop the opacity modifiers — XS |
| A2F8 | **P4** | icon-only, title-only buttons: dashboard.tsx:171 CSV export (26px), layout.tsx:1429 refresh (36px) — the only two unlabeled icon buttons in the 50 touched files | add `aria-label` mirroring title — XS |
| A2F9 | **P4** | decorative icons missing `aria-hidden`: login banner icons ×2 (login.tsx:186, :208) + the error-state `WifiOff` family at `error/70` (security.tsx:569/:860, promotions.tsx:482, dashboard.tsx:1282 — also 2.98 D icon contrast, 0.02 under 3:1) | add `aria-hidden`; drop `/70` — XS |
| A2F10 | **P4** | settings account-tab h1→h3 skip (account-tab.tsx:296, :368 — no h2 in that tab) | h3→h2 or add a tab-level h2 — XS |
| A2F11 | **P4** | live-region parity: bell unread count silent (NotificationBell.tsx:373-379) while the cart badge got `aria-live` in R128 (Navbar.tsx:421); notifications «عرض X من Y» pill + read-state flip silent (notifications.tsx:231-238); CopilotPanel loading→answer + `turn.error` unannounced, error box lacks `role="alert"` (:1284-1300) | one wrapper each, following the Navbar.tsx:421 pattern — S |
| A2F12 | **P4** | Sonner toast close 22×22 (index.css:1296-1301) — 2.5.8 fail by 2px, documented 96-F7 trade | accept + note in DESIGN.md, or 24px — XS |
| A2F14 | **P4] (NEW in R128)** | orders coupon progress fill `success/60` vs `muted/40` track = **2.46 L** (orders.tsx:1213-1217, added in 4edfbe2; dark 3.90 ✓) — 1.4.11, adjacent «N×» text exists | `/60`→`/80` or solid fill — XS |
| A2F15 | **P4] (R128-changed)** | dashboard legend dot `success/60` = **2.63 L** (dashboard.tsx:1077; was emerald-500/60 = 1.77 L — improved but still <3:1); the coupon bars share the value via `fillOpacity 0.6` (dashboard.tsx:1131-1137, pre-existing) | legend + fillOpacity → 0.8, or solid — XS |

**Counts: P0 0 · P1 0 · P2 1 · P3 5 · P4 9.** Cross-referenced (owned elsewhere, not counted): cart-stock dead UI → R129-A1 F1 (P1 there); bell↔page read-state coherence → R129-A1 F5 (A2F11 is the SR-announcement half of the same seam); DESIGN.md tier-silver hex → R129-A1 F4.

## 9. Verified-OK register (evidence-checked, no action)

| # | Item | Evidence |
|---|---|---|
| 1 | `--status-success-surface` approve buttons AA both themes + /90 hover | topups.tsx:328, :538; §1.2a (5.05/5.89; hover 5.80/4.77) |
| 2 | `--status-purple` family AA in every admin composition (card, /10, /12, /15, icon tiles) — index.css:170-175 comment re-derives exactly | users.tsx:1023-1027, pricing.tsx:1207/1397, risk.tsx:91, system.tsx:1662+/1685+; §1.2c |
| 3 | Tier tokens AA at every position text renders (card, muted/30, background/30, medals, profile-badge real position, icon tiles, dots) | §1.2b + §1.5 geometry; users/loyalty/wallet/profile/referrals sites listed |
| 4 | `bg-status-warning/15 + text-status-warning` pills AA both themes (mission's named pair) | layout.tsx:209/221/1163/1326, topups.tsx:1221, tickets.tsx:420, products.tsx:378/409, promotions.tsx:529, risk.tsx:87 — 7.23/4.90 |
| 5 | 7 live `cat-*` hues AA at 11px/600 on the /10 chip idiom, both themes (4.86–9.25); gaming/productivity light = known-open A1-F11 | §1.2g; ProductCard.tsx:509, products.tsx:91-100 |
| 6 | StatusBadge /10, /12, /15 tint idioms AA both themes for success/warning/info/low-stock/purple; error within 0.09 of AA on /15 dark only | §1.2c; status-badge.tsx:31-42 |
| 7 | All tinted borders (<3:1) are never the sole state indicator — 1.4.11 compliant-by-design; the sole-indicator focus ring passes everywhere | §1.2d/f; index.css:896-899, :416-443 |
| 8 | /notifications keyboard/focus/h1/targets — the model surface | §2.1 |
| 9 | All four ✓→Check swaps read correctly (aria-hidden + Arabic label); no stray glyphs render | §3.1 |
| 10 | Icon-button labeling across the 50 touched files: only the two title-only buttons fail (A2F8); collapsed-nav/hamburger/bell/alerts-row fixes hold | §3.2; layout.tsx:184/:1313-1315/:1173, NotificationBell.tsx:352-368, alerts.tsx:741-767 |
| 11 | Cart badge live region on the stable wrapper (key-remount-safe contract, comment-pinned) | Navbar.tsx:414-439 |
| 12 | Footer h3→h2 landed; no h2-only ordering regressions; both column h2s inside nav landmarks | Footer.tsx:60, :85; §6 |
| 13 | Admin h1 unification (19× exactly-one + dashboard 0-by-design, one size family) + whatsapp h1 | §6; admin-h1-unification.test.ts:31-53 |
| 14 | Reduced motion: every R128 animation inside the global guard; no new keyframes; fill-mode change guard-neutral; zero exceptions | §4; index.css:1147-1166, :1453-1460 |
| 15 | Cart steppers/trash: native buttons, 44px, per-item Arabic aria-labels, press-spring keyboard-neutral | §2.3; cart.tsx:347-380 |
| 16 | CopilotPanel trace render: decorative icons hidden, Arabic-only labels, transport strings untouched; per-line silence correct | §2.4; CopilotPanel.tsx:349-392 |
| 17 | Login banners: role+aria-live, no focusables, 44px tabs, sr-only h1 | §2.2; login.tsx:135/:143-164/:181-212 |
| 18 | Sonner: reduced-motion second guard + touch-visible close | index.css:1315-1327, :1453-1460 |
| 19 | Five in-CSS/in-code contrast claims re-derive exactly (success-surface, purple, destructive-surface, tier raw-pair figures, focus ring) | §1.4 |

## 10. Known-open carried (re-verified at HEAD, NOT re-reported)

Doubled admin document-h1 (layout.tsx:1332 + page h1s — A3-r128 §9, test-documented) · mobile drawer malformed width class `w-in(18rem,85vw)]` **still present at layout.tsx:1286** (A3-r128 F4's one-char fix did not land in the R128 fleet) · light `--cat-gaming`/`--cat-productivity` values (A1-r128 F11, admin-preview-only) · admin focus traps for search/drawer (canon §7) · CopilotPanel local copy button vs shared CopyButton (A3-r128 #8 scoped its census to `pages/admin`; this is the components/ sibling — A2F5 sizes it).

## 11. Ordered next actions (effort-ranked for the fix lane)

1. **A2F1** (one class, ×2 sites, both-theme AA fail on a conversion-critical surface) — XS.
2. **A2F2** (one class, money-path confirm button) — XS.
3. **A2F13 + A2F14** (two classes in orders.tsx, both NEW-in-R128) — XS.
4. **A2F4** (light `--primary-text` 46→43% — clears 12+ live sites + the dormant badge variant at once; verify the PDP price pair at landing) — S.
5. **A2F3** (letter opacity) + **A2F5** (copy chip size) + **A2F15** (legend/fillOpacity) — XS each.
6. **A2F6/A2F7** (two token/marker tweaks; batch) — XS.
7. **A2F8/A2F9/A2F10** (aria-labels ×2, aria-hidden ×6, one heading) — one XS commit.
8. **A2F11** (three live-region wrappers + `role="alert"` on the copilot error box) — S; pair with the R129-A1 F1 wiring so the stock verdict row ships WITH its announcement semantics (`role="status"` + the Arabic reason text per 3.3.1/3.3.2).

*Source tree untouched; no tests run; no git mutations. All 100+ contrast figures computed at HEAD from index.css token values via the WCAG relative-luminance formula with bottom-up alpha compositing (scratch: /tmp/r129a2) — reproducible from §1.1.*
