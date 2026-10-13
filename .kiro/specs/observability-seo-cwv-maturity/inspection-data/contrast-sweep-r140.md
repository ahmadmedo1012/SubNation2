# r140-i — Comprehensive WCAG Contrast Sweep (SubNation2 frontend)

**Agent:** 140-i · **Round:** r140 · **Type:** AUDIT + REPORT (no source edits; index.css is orchestrator-owned)
**Scope:** every real ink/background pair resolved from `frontend/src/index.css` for BOTH themes (dark `:root` default + `.light` overrides), computed with the WCAG 2.x relative-luminance formula (Python, `/home/z/scratch-140i/contrast_sweep.py`), cross-referenced against actual usage counts (394 source files scanned, `__tests__` excluded). 190 pairs computed; alpha usages composited per-channel in gamma space (`effective = fg·α + bg·(1−α)`), matching browser compositing and the method of the prior in-source audits (R111 F3-06, R116-S1, R124-A3, R128-A1, R129-A2).

**Thresholds applied:** normal text 4.5:1 · large text (≥24px, or ≥18.66px bold) 3:1 · non-text (focus ring, icons-as-controls, markers) 3:1 (WCAG 1.4.11/2.4.11).
**Arabic floor rule (design contract, FINAL_UX_SYSTEM):** 11–12px Arabic is ALWAYS normal text — the `text-2xs`/`text-3xs` badges (both 11px) and every `text-xs` money/label span get the full 4.5:1 floor. Bold ≥20px money spans (`text-xl font-bold tabular-nums`) legitimately ride the 3:1 large-text floor.

---

## 1. Resolved token values (both themes)

| Token | dark `:root` | light `.light` | index.css line (dark / light) |
|---|---|---|---|
| `--background` (=`--surface-base`) | `220 22% 5%` | `220 20% 96%` | 187 / 354 |
| `--foreground` | `210 40% 98%` | `220 20% 10%` | 188 / 355 |
| `--card` (=`--surface-card`) | `220 20% 8%` | `0 0% 100%` | 192 / 358 |
| `--muted` / `--accent` / `--secondary` | `215 20% 13%` / same / `215 20% 15%` | `220 14% 93%` ×3 | 203,206,200 / 374,377,371 |
| `--muted-foreground` | `215 16% 68%` | `220 14% 38%` | 204 / 375 |
| `--primary` | `348 80% 48%` | `348 80% 46%` | 196 / 362 |
| `--primary-text` (ink variant) | `348 80% 65%` | `348 80% 43%` | 197 / 368 |
| `--primary-foreground` | `0 0% 100%` | `0 0% 100%` | 198 / 369 |
| `--destructive` / `--destructive-surface` | `0 80% 58%` / `0 80% 52%` | `0 80% 48%` / same | 209,216 / 380,385 |
| `--status-success` | `152 65% 50%` | `152 60% 28%` | 163 / 347 |
| `--status-warning` | `38 92% 56%` | `38 90% 28%` | 164 / 348 |
| `--status-error` | `0 80% 64%` | `0 75% 42%` | 168 / 349 |
| `--status-info` | `211 90% 58%` | `211 80% 38%` | 169 / 350 |
| `--status-low-stock` | `22 92% 58%` | `22 88% 36%` | 170 / 351 |
| `--status-purple` | `262 83% 70%` | `262 70% 45%` | 179 / 352 |
| `--status-success-surface` | `152 65% 30%` | `152 60% 28%` | 220 / 386 |
| `--ring` | `348 80% 48%` | `348 80% 46%` | 230 / 394 |

Tint wells in live use (grep census): `bg-status-*/10` ×159, `/8` ×41, `/15` ×35, `/5` ×15, `/12` ×9 (StatusBadge uses `/12`); `bg-primary/15` ×69, `/10` ×57, `/8` ×29, `/12` ×7, `/14` ×4.

---

## 2. Verdict table (condensed — full 190-row matrix in §7)

AA floor = 4.5:1 normal / 3:1 large&non-text. **LG** = passes 3:1 only (fails normal-text AA).

### 2.1 Core pairs — ALL PASS, both themes

| Pair (ink / bg) | dark | light | usage breadth (src, tests excl.) |
|---|---|---|---|
| foreground / background | **18.71** | 16.20 | app shell `bg-background text-foreground` |
| foreground / card | 17.75 | **17.81** | Navbar links, card headings |
| foreground / card(80% over bg) [Navbar] | 17.96 | 17.48 | Navbar `bg-card/80` header |
| muted-foreground / background | **8.45** | 6.08 | hero muted text, secondary copy |
| muted-foreground / card | 8.02 | 6.68 | `text-muted-foreground` ×923 across ~220 files |
| muted-foreground / muted | 7.06 | 5.67 | wells, toasts cancel, ticket bubbles |
| muted-foreground / muted/45 [StatusBadge neutral] | 7.61 | 6.21 | StatusBadge neutral variant |
| primary-text / background | 6.07 | 5.37 | `text-primary-text` ×200 |
| primary-text / card | 5.76 | 5.90 | " |
| primary-text / primary/8–/15 tints (over card) | 5.53–5.25 | 5.18–4.60 | brand chips/CTA wells |
| white (primary-foreground) / primary badge | 4.93 | 5.29 | `bg-primary` ×81 (buttons, cart badge) |
| white / primary/95 [Button gradient] | 5.32 | 5.04 | Button default variant |
| white / destructive-surface | 4.52 | 5.00 | destructive buttons |
| white / status-success-surface | 5.05 | 5.89 | topups approve buttons |
| destructive / card | 4.65 | 5.00 | `text-destructive` ×46 |
| tier-bronze/silver/gold/platinum / card | 10.5 / 9.0 / 9.5 / 8.2 | 5.2 / 6.2 / 6.1 / 6.5 | `text-tier-*` ×10 |
| ::selection fg on primary/40 over bg | 12.69 | 8.24 | global selection |
| caret primary-text / card | 5.76 | 5.90 | global caret |
| whatsapp-ink / brand-whatsapp | **5.67** (both) | — | WhatsAppPhoneSignIn, user-display |
| toast title fg / toast surface | 16.43 | 17.68 | all toasts |
| toast description muted-fg / toast surface | 7.42 | 6.63 | all toasts |

### 2.2 Status inks — ALL PASS on every tint in use, both themes

| ink / bg | card | bg | /8 tint | /10 tint | /12 tint | /15 tint |
|---|---|---|---|---|---|---|
| **dark** success | 9.48 | 9.99 | 8.35 | 8.04 | 7.71 | 7.23 |
| **dark** warning | 9.49 | 10.01 | 8.36 | 8.04 | 7.72 | 7.23 |
| **dark** error | 5.48 | 5.78 | 5.06 | 4.94 | 4.82 | 4.63 |
| **dark** info | 5.74 | 6.05 | 5.24 | 5.10 | 4.96 | 4.74 |
| **dark** low-stock | 6.86 | 7.23 | 6.22 | 6.04 | 5.85 | 5.57 |
| **dark** purple | 5.54 | 5.84 | 5.06 | 4.93 | 4.80 | 4.59 |
| **light** success | 5.89 | 5.35 | 5.26 | 5.11 | 4.96 | 4.75 |
| **light** warning | 6.07 | 5.52 | 5.43 | 5.27 | 5.12 | 4.90 |
| **light** error | 6.38 | 5.80 | 5.57 | 5.38 | 5.20 | 4.93 |
| **light** info | 6.45 | 5.87 | 5.73 | 5.56 | 5.39 | 5.14 |
| **light** low-stock | 5.75 | 5.23 | 5.12 | 4.97 | 4.82 | 4.61 |
| **light** purple | 8.43 | 7.67 | 7.35 | 7.10 | 6.85 | 6.49 |

(`text-status-*` ×421 + `bg-status-*/N` ×262 — the F3-06/R111/R116/R129 hardening holds everywhere; the documented R129 error/purple fixes re-verify exactly: error 4.63 on /15, purple 4.80 on /12.)

### 2.3 Failing / short pairs — the actual findings

| # | Pair | theme | ratio | floor | real usage sites |
|---|---|---|---|---|---|
| F1 | white on `--toast-accent` = status-success / warning (toast **action button**) | dark | **1.96 / 1.96** | 4.5 | LATENT — `[data-button]` rule (index.css:1378-1389); zero production `action:` call sites (only `toaster-lazy-replay.test.tsx:142`); error/info variants 3.39/3.24 also short |
| F2 | raw `text-primary` small text on card / tints | dark | 3.44–3.77 | 4.5 | ~12 sites (see §3.2): admin/products/ProductCard.tsx:158 (14px bold price), :183 (11px chip), :276 (12px button), BulkActionBar.tsx:31, ReferralRowItem.tsx:114, WhatsappHeader.tsx:16, enrichment.tsx:328 (chip), InventoryUploadDialog.tsx:555 (chip), risk-meta.ts:66 (chip) |
| F2′ | same chips in light | light | 4.13–4.49 | 4.5 | enrichment/InventoryUpload/risk-meta chips (light misses by 0.01–0.37) |
| F3 | `text-muted-foreground/75` on card (11px) | light | **3.71** | 4.5 | order-detail.tsx:649 («كما خُصمت نقاط الشراء…») |
| F4 | `text-muted-foreground/80` on card / on muted/60 | light | 4.14 / 3.88 | 4.5 | enrichment.tsx:165, TransferCodePanel.tsx:110 (code display) |
| F5 | `text-foreground/50` on card (12px labels) | light | **3.39** | 4.5 | account-tab.tsx:265, 283 («المصادقة الثنائية», «تاريخ الإنشاء») |
| F6 | `text-status-success/70` on card (11px) | light | **3.18** | 4.5 | ReferralRowItem.tsx:87 («قُيِّد: …» timestamp) |
| F7 | `text-status-error/75` on `bg-status-error/8` (11px mono `<pre>`) | dark/light | 3.40 / 3.84 | 4.5 | ErrorBoundary.tsx:151 (dev-facing stack trace) |
| F8 | raw `hover:text-primary` on muted links | dark | 3.62–3.77 | 4.5 (hover) | ~10 admin sites (ProductsToolbar:98, admin ProductCard:71, WhatsappHeader:33, DesktopOrderRow:46, MobileOrderCard:42, OrdersTable:56, risk-event:179/214, provider-card:318) — storefront swept this class in r125 (B-2); admin never did |
| F9 | `hover:text-primary-text/80` | dark/light | 4.21 / 4.16 | 4.5 (hover) | GuestHero.tsx:181 (11px bold CTA hover) |
| F10 | photo badge `text-white/85` on `bg-black/55` | worst-case | **3.95** | 4.5 | ProductMediaSection.tsx:121 — only against a PURE-white photo (catalog is 45×450px webp art, none white; typical ≈12:1) |
| F11 | disabled `text-muted-foreground/60` on `bg-muted/40` | light | 2.63 | exempt | TransferCodePanel.tsx:143, ProductCard.tsx:781 — WCAG 1.4.3 inactive-component exemption |
| F12 | not-found art (`text-primary/25` numeral, `/40` compass) | both | 1.21–1.97 | 3 (large/non-text) | not-found.tsx:56, 63 — decorative |
| F13 | `marker:text-primary/50` list bullets | both | 1.72 / 2.35 | 3 (non-text) | terms.tsx:143 — decorative markers |

**Passing-with-thin-margin (watch list, no action):** PDP price raw-primary on muted/20-over-bg dark **3.87** (large-text floor 3.0 — 30px bold `tabular-nums`, PriceStockPanel.tsx:38); CtaBlock money dark 3.77 (20px bold, ×4 sites); NotificationBell:616 `text-foreground/60` light **4.66**; primary-text light on /15 tint 4.60; status-purple dark on /15 4.59; status-error dark on /15 4.63. All clear AA; margin <0.4.

---

## 3. Failing pairs ranked by severity × breadth + fixes

### 3.1 F2 — raw `text-primary` as small text (the historical §2.2 residue) — **TOP FIX**

**Diagnosis.** `--primary` (348 80% 48% dark) is the SURFACE channel; the design contract ships `--primary-text` (348 80% 65% dark / 43% light) precisely for primary-as-ink (documented at button.tsx:28-31 and index.css:950-952). ~77 raw `text-primary` occurrences are icons/aria-hidden (non-text, 3.77 dark ≥3:1 — pass); ~7 are recharts `color=` configs (non-text lines, pass); ~10 are hover transitions; **~12 are real small text** that fails dark (3.44–3.77) and 3 chip shapes that miss in light by 0.01–0.37.

**Fix — NO index.css change. Token adoption sweep:** `text-primary` → `text-primary-text` at the failing small-text sites only:
`admin/products/ProductCard.tsx:158, 183, 276` · `admin/products/BulkActionBar.tsx:31` · `admin/referrals/ReferralRowItem.tsx:114` · `admin/whatsapp/WhatsappHeader.tsx:16` · `admin/enrichment.tsx:328` · `admin/InventoryUploadDialog.tsx:555` · `admin/risk/risk-meta.ts:66`.
**New ratios:** dark 5.76 (card) / 5.46 (/10) / 5.25 (/15); light 5.90 / 5.01 / 4.60 — all AA. Also fixes F8 as a class (`hover:text-primary` → `hover:text-primary-text`, dark 5.76+) if the orchestrator wants the admin hover sweep in the same pass.
**Leave raw (deliberate):** the six large-text money spans — PriceStockPanel.tsx:38 (30px bold, 3.87 ✓large), CtaBlock.tsx:151/238/270/321 (20px bold, 3.77–3.98 ✓large), profile.tsx:311 (24px bold, 3.98 ✓large) — converting them would visibly brighten the storefront's anchor money surfaces for zero AA gain.
**Blast radius:** confined to ~12 admin surfaces that currently FAIL — brand text brightens from 48%→65% lightness there (dark), 46%→43% (light, nearly invisible). Zero storefront change. This is the same move r138 made on the auth surface (`text-primary` spans → `text-primary-text`, the "Nation" logo span already rides it — Logo.tsx:66).

### 3.2 F3/F4/F5/F6 — light-theme opacity-step micro-fails (5 sites, 4 files)

**Token-level option — considered and REJECTED (with math):** darkening light `--muted-foreground` (index.css:375, `220 14% 38%`):
- → 34%: mf/80 = 4.62 ✓ but mf/75 = **4.09 ✗** (still short) — and ALL 923 muted surfaces darken one visible step.
- → 32%: mf/80 = 4.89 ✓ but mf/75 = 4.31 ✗ — two steps darker, mf/card 8.39:1 (heavy, off-contract "quiet").
No lightness value fixes the /75 site without wrecking the muted register — **the token is the wrong instrument; these are per-site alpha-step corrections inside the existing ramp** (the r139 error-banner step family /80→/85→/90 is documented register vocabulary, not new colors):

| site | current | ratio (light) | minimal step | new ratio |
|---|---|---|---|---|
| order-detail.tsx:649 | `text-muted-foreground/75` | 3.71 | → `/85` | 4.65 ✓ |
| enrichment.tsx:165 | `text-muted-foreground/80` | 4.14 | → `/90` | 5.23 ✓ |
| TransferCodePanel.tsx:110 | `text-muted-foreground/80` on `bg-muted/60` | 3.88 | drop alpha → plain | 6.06 ✓ |
| account-tab.tsx:265, 283 | `text-foreground/50` | 3.39 | drop class → inherit parent `text-muted-foreground` (the label pattern at line 263) | 6.68 ✓ |
| ReferralRowItem.tsx:87 | `text-status-success/70` | 3.18 | drop `/70` → plain | 5.89 ✓ |

**Blast radius:** 5 sites, one class literal each, light theme only (dark already passes all five: 4.99/5.52/5.24/5.12/5.15). Imperceptible elsewhere.

### 3.3 F1 — toast action button on status accents (dark) — **one index.css line**

Dark `--status-success`/`--status-warning` (50/56% lightness) under white ink = 1.96:1; error/info 3.39/3.24. **No production toast passes an `action` today** (only the lazy-replay test) — latent, but `use-toast.ts` documents `action` as a supported option, so the first caller inherits a 1.96:1 button.

**Fix (index.css:1378-1380, the `[data-button]` rule):** pin the button surface to brand primary instead of the accent:
```css
[data-sonner-toast][data-styled="true"].premium-toast [data-button] {
  background: hsl(var(--primary));            /* was: hsl(var(--toast-accent, var(--primary))) */
```
The severity hue stays carried by the accent strip + icon bubble (already the design's accent language); the button reads as the standard brand CTA. **New ratios:** white on primary 4.93 dark / 5.29 light — AA both themes, all five variants.
**Blast radius:** zero production pixels (no live action buttons); the one test toast's button turns brand-red instead of green. Alternative (more literal): success variant → `hsl(var(--status-success-surface))` (5.05 dark) — but warning/error/info have no surface tokens, so the brand-pin is the only one-line fix that clears all variants without inventing tokens.

### 3.4 F7 — ErrorBoundary dev `<pre>`

`text-status-error/75` on `bg-status-error/8` (11px mono, behind a «للمطورين» disclosure). Drop `/75` → plain `text-status-error`: 5.06 dark / 5.57 light on the /8 wash. One class literal; dev-facing surface; lowest priority of the real fails.

---

## 4. Borderline-deliberate — recommend KEEP (justified)

| Site | Pair | Ratio | Justification |
|---|---|---|---|
| not-found.tsx:63 «404» numeral | primary/25 on bg | 1.21–1.51 | decorative ghost art at 36px bold; the h1 «الصفحة غير موجودة» carries the meaning (r138 pinned this register) |
| not-found.tsx:56 Compass icon | primary/40 on bg | 1.47–1.97 | aria-hidden decorative icon |
| terms.tsx:143 list markers | marker:primary/50 | 1.72–2.35 | bullet glyphs; list semantics come from the list role, not the marker color |
| TransferCodePanel.tsx:143, ProductCard.tsx:781 (disabled) | mf/60 on muted/40 | 2.63–3.57 | inactive controls — WCAG 1.4.3 exempts inactive UI components; `cursor-not-allowed` + aria |
| RecentOrdersStrip.tsx:55 WifiOff icon | status-error/60 | ~3.2 | aria-hidden icon, redundant with the bold text label beside it |
| PromotionsList.tsx:72 Zap icon | mf/30 | ~2 | empty-state decorative art |
| Placeholder text (×3, `placeholder:text-muted-foreground`) | mf on card/bg | 8.02/6.68 | passes AA outright anyway |
| GuestHero.tsx:181 hover dim | primary-text/80 | 4.21/4.16 | transient hover-only state on an 11px bold CTA; resting state passes; the dim is the press feedback |
| ProductMediaSection.tsx:121 photo badge | white/85 on black/55 | 3.95 worst-case | only against a pure-white photo — the 45-image catalog has none (typical ≈12:1); backdrop-blur further separates |
| Photo badges white/70 on black/75 (ProductCard.tsx:418) | — | 6.07 worst-case | passes even worst-case |
| Skeleton shimmer | 8% wash over muted | 1.11–1.15 delta | decorative loading affordance, exempt from text contrast (see §5) |

---

## 5. Focus-visible + skeleton (requested extras)

- **Focus ring:** `:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px }` (index.css:939-942) — solid, no alpha. `--ring` = `--primary`: vs background **3.98 dark / 4.81 light**, vs card 3.77 / 5.29 — passes the 3:1 non-text bar both themes (dark margin 0.77). On primary-bg buttons the ring is same-hue vs the button itself (1:1) but the 2px offset lands the ring on the surrounding page surface (3.98 dark / 4.81 light) — distinguishable; Button's `focus-visible:ring-2 ring-offset-1` composition is equivalent. No action.
- **Skeleton:** `.skeleton-shimmer` = `--muted` base + 8% `--muted-foreground`/`--primary` sweep — 1.11–1.15:1 vs base, i.e. a deliberately sub-perceptible brand-tinted shimmer. Decorative (no text), exempt; the motion (not color) carries the loading signal. No action.

---

## 6. Historical PageSpeed §2.2 closure status (2026-05 report)

| Failing element then | Current pair | Now |
|---|---|---|
| `Nation` (Logo span) | `text-primary-text` on bg (Logo.tsx:66) | **6.07 / 5.90 PASS** |
| `<span class="text-primary">` | mostly converted; residue = §3.1 (12 admin small-text sites + 6 large-text money spans that pass 3:1) | 90% closed; §3.1 finishes it |
| Navbar «الكتالوج / دخول / حساب مجاني» | foreground on bg-card/80 | **17.96 / 17.48 PASS** |
| muted hero text | muted-foreground on background | **8.45 / 6.08 PASS** |
| `bg-card/80` header, `bg-background text-foreground` shell | 17.96 / 18.71 dark | **PASS** |

The one failed Lighthouse audit is now substantively closed on the storefront/auth surface; what remains is the admin raw-primary class (§3.1), five light-theme alpha micro-sites (§3.2), and the latent toast button (§3.3).

---

## 7. Appendix — full computed matrix (190 pairs)

Dark theme: body fg/bg 18.71, fg/card 17.75, fg/muted 15.63, fg/secondary 14.74, fg/card80 17.96 · mf/bg 8.45, mf/card 8.02, mf/muted 7.06, mf/muted45 7.61, mf/90 6.69, mf/85 6.09, mf/80 5.52, mf/75 4.99, mf/60 3.63(LG), mf80-on-muted60 5.24, mf60-on-muted40 3.57(LG,disabled) · fg-steps on card: /90 14.42, /85 12.92, /80 11.51, /75 10.21, /70 9.01, /60 6.88, /50 5.12 · primary-text: bg 6.07, card 5.76, muted 5.07, /8 5.53, /10 5.46, /12 5.38, /14 5.30, /15 5.25, hover/80 4.21(LG) · raw primary: bg 3.98(LG), card 3.77(LG), /10 3.57(LG), /15 3.44(LG) · white/primary 4.93, white/primary95 5.32 · status table in §2.2 · success/70 5.15, error75-on-/8 3.40(LG) · destructive/card 4.65, white/dsurf 4.52, white/ssurf 5.05 · tiers 10.53/9.04/9.49/8.20 · ring bg 3.98, card 3.77 (non-text ✓) · toast: title 16.43, desc 7.42, action-on-primary 4.93, on-success 1.96 ✗, on-warning 1.96 ✗, on-error 3.39(LG), on-info 3.24(LG) · selection 12.69, caret 5.76 · whatsapp-ink 5.67, white-on-whatsapp 1.98 (unused).

Light theme: fg/bg 16.20, fg/card 17.81, fg/muted 15.11, fg/secondary 15.11, fg/card80 17.48 · mf/bg 6.08, mf/card 6.68, mf/muted 5.67, mf/muted45 6.21, mf/90 5.23, mf/85 4.65, mf/80 4.14(LG), mf/75 3.71(LG), mf/60 2.71 ✗, mf80-on-muted60 3.88(LG,disabled), mf60-on-muted40 2.63 ✗(disabled) · fg-steps: /90 13.43, /85 11.32, /80 9.46, /75 7.88, /70 6.58, /60 4.66, /50 3.39(LG) · primary-text: bg 5.37, card 5.90, muted 5.01, /8 5.18, /10 5.01, /12 4.84, /14 4.68, /15 4.60, hover/80 4.16(LG) · raw primary: bg 4.81, card 5.29, /10 4.49(LG), /15 4.13(LG) · white/primary 5.29, white/primary95 5.04 · status table §2.2 · success/70 3.18(LG), error75-on-/8 3.84(LG) · destructive/card 5.00, white/dsurf 5.00, white/ssurf 5.89 · tiers 5.23/6.20/6.07/6.45 · ring bg 4.81, card 5.29 ✓ · toast: title 17.68, desc 6.63, action-on-primary 5.29, on-status accents 5.89/6.07/6.38/6.45 ✓ · selection 8.24, caret 5.90.

**Data files:** `/home/z/scratch-140i/contrast_rows.json` (190 rows), `contrast_counts.json` (per-pattern counts + top files), `contrast_sweep.py`, `addendum.py`, `refine.py` (comment-stripping classifier for raw `text-primary`).
