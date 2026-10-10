# R128-A4 — Typography & Arabic Text-Rendering Audit

**Agent:** R128-A4 (lane: typography & Arabic rendering excellence) · **HEAD:** `7d469d5` (= live production, verified via live HTML hash probe) · **Mode:** READ-ONLY on source (only this report + one worklog entry). Live GET probes of https://subnation.ly only (guest); one Playwright Chromium instance at a time (390×844 mobile + 1280×800 desktop + a CDP-throttled 400 kbps/150 ms cold boot).

**Prior coverage read first — not re-reported:** R127 B3-K1 (mobile title clipping by category badge) + B3-K2 (11px muted pixel-density; its three flagged sites' remediation is *verified held* below), R127 B14 (terminology/copy), R126 A8 (Arabic copy), R126 A13 (real-browser a11y contrast method). This lane is rendering & type craft.

---

## 1. Method

Source sweeps (rg over `frontend/src`, tests excluded where noted) for: font-face architecture (`index.css` @imports, `vite.config.ts` preload plugin, `@fontsource/readex-pro/*`), arbitrary sizes, `tracking-*`/`letter-spacing`, `uppercase`, `line-clamp`/`truncate`, `dir="ltr|auto"`, `Intl.*`/`toLocale*`, Arabic-Indic codepoints `٠-٩`, `font-black|medium`, `leading-*` overrides. WCAG relative-luminance math (node) for the real micro-text pairs (alpha-composited tints). Live probes: computed font-family/size/line-height/weight/direction of h1 / card title / price / badge / nav on `/` (mobile) and `/product/chatgpt-plus` (desktop), `document.fonts.check` for all faces + a `fonts.check('900 …')` fallback probe, a fallback-vs-Readex metric-width probe, a fallback metric-width probe, font `Cache-Control` headers, and a throttled-boot CLS measurement with `PerformanceObserver('layout-shift')` injected via `addInitScript`.

---

## 2. Findings (P0–P4)

### A4-F1 [P3 · conf 5] Latin product names truncate from the wrong end in RTL rows — missing `dir="auto"` isolation at the two money-path truncation sites

- **Sites:** `pages/cart.tsx:274` (`it.name` — `font-bold text-sm leading-snug truncate`), `pages/checkout.tsx:1422` (`it.name` — `font-bold truncate`).
- **Mechanism:** the catalog is 100% Latin-named (B14-C: 45/45 products). In an RTL block, `text-overflow: ellipsis` cuts the *inline-end* = the LEFT side — which for a Latin string is its **beginning**. An overflowed «Lifetime Cloud Storage» renders «…oud Storage»: the brand's leading characters vanish and the ellipsis sits mid-name. The codebase already owns the fix idiom — `ProductCard.tsx:491` (card title), `product.tsx:1247` (PDP h1), `home.tsx:1173` (section headers) all carry `dir="auto"` (live-verified: the PDP h1 «ChatGPT Plus» computes `direction: ltr` under it). Cart/checkout order-item names are the same class of content on the money path, minus the isolation.
- **Cousins (user-generated mixed content, same exposure, lower stakes):** `pages/support.tsx:905` (`line-clamp-1` on ticket `last_reply` — WhatsApp replies mix scripts freely), `components/layout/NotificationBell.tsx:618` (`line-clamp-2` on `n.message`).
- **Fix (S):** add `dir="auto"` to the two `it.name` truncation divs (and ideally the two user-content cousins). Zero-layout-risk: dir=auto only changes the element's base direction, which for Latin content is what the reader expects.

### A4-F2 [P3 · conf 5] `text-muted-foreground/70` at 11px/400 fails AA — 3.33:1 on the light card, 4.48:1 (marginal) on dark

- **Sites:** `pages/admin/products.tsx:1206` (`text-3xs font-normal text-muted-foreground/70`), `components/admin/ProductVariantsDialog.tsx:489` (same class string).
- **Measured (WCAG math, alpha-composited):** dark — muted-fg `hsl(215 16% 68%)` at /70 over card `hsl(220 20% 8%)` = **4.48:1** (hairline under 4.5); light — `hsl(220 14% 38%)` /70 over white = **3.33:1 FAIL**. At 11px/400 these are normal-size AA text. For calibration: full-opacity muted passes 8.00:1 (dark) / 6.72:1 (light); /85 passes 6.06 / 4.69.
- **Relation to B3-K2:** the R127 remediation (ProductCard desc, register consent, support note → 12px/600) is **verified held in source** — these two admin cousins are the residue the R127-L7 fix wave didn't reach, and they add a second defect axis B3-K2 didn't have (the /70 alpha), which fails on *token math*, not just pixel density.
- **Fix (S):** /70 → /85 (passes both themes) or drop the alpha. Two lines.

### A4-F3 [P3 · conf 4] Six page h1s override the Arabic-safe 1.3 leading floor with `leading-tight` (1.25)

- **Sites:** `pages/checkout.tsx:1145` «إتمام الطلب», `pages/cart.tsx:152` «سلة المشتريات», `pages/orders.tsx:322` «طلباتي», `pages/support.tsx:415`, `pages/onboarding.tsx:129`, `pages/order-detail.tsx:347` (text-base h1). Cousins: `login.tsx:152`, `register.tsx:115` (`font-bold leading-tight` paragraphs).
- **Mechanism:** the base layer sets `h1–h4 { line-height: 1.3 }` with the documented rationale «1.2 clips and collides [harakat/maddah] given Readex Pro's tall ascender metrics; **1.3 is the Arabic-safe minimum**» (index.css:438-447, R96 A6 #5) — but Tailwind's `leading-tight` utility wins the cascade (utilities layer > base). Live-verified contrast pair: PDP h1 computes 41.6px/32px = **1.30** ✓, home h1 38.48/29.6 = **1.30** ✓ — the flagship pages honor the floor; these six 24px h1s ride 30px (1.25) instead of 31.2px. Readex Pro carries tall vertical metrics and إ/أ hamza-below and ل ascenders; the project's own canon calls 1.25-class leading unsafe for Arabic.
- **Fix (S):** delete `leading-tight` from those h1s (the base 1.3 then applies). No visual redesign needed — 1.2px more leading.

### A4-F4 [P4 · conf 5] UX canon is stale on the micro-type token

- `docs/ux/FINAL_UX_SYSTEM.md:21` says «`--text-3xs` (10px)» — actual value is **11px** since R120-B1 (index.css:108, pinned by `design-system-css.test.ts:173`). One-word doc fix. (The canon's «money is always tabular-nums + Western digits + د.ل suffix; codes/amounts isolate with dir=ltr» line is *accurate* and fully honored — verified.)

### A4-F5 [P4 · conf 3] Fallback stack: phantom «Inter» second + no Arabic-named fallback before generic `sans-serif`

- `index.css:211` — `--app-font-sans: "Readex Pro", "Inter", sans-serif`. Round-3 documented Inter as a phantom, but kept it 2nd: any user who *does* have Inter installed sees every Latin run (product names, codes) in Inter while Arabic stays Readex Pro — a two-class rendering with Inter's narrower metrics. And during the swap window the Arabic fallback is whatever the platform's generic `sans-serif` resolves to (Noto Naskh on many Arabic-market Androids — a naskh serif-ish face, visually far from Readex's sans).
- **Measured mitigation (why P4, not higher):** fallback→Readex metric delta on a mixed Arabic/Latin/digits probe string is only **+4.3%** width at 16px; the throttled 400 kbps cold mobile boot measured **CLS ≈ 0** (one 0.00002 entry) because the 4 preloads land the woff2 during HTML parse, so the swap window is effectively closed before first contentful paint on the LCP text.
- **Fix (S, optional):** `"Readex Pro", "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif` (drop Inter), or accept-and-document as done in Round-3.

### A4-F6 [P4 · conf 3] `leading-none` on runs containing «د.ل» (Arabic lam ascender in a 1.0 line box)

- Sites: `ProductCard.tsx:540` (18px price, live-computed lh 18px/18px), `product.tsx:1326` (3xl price), `wallet.tsx:1246` (3xl balance), `home.tsx:905/960`, admin stat tiles (`system.tsx:389`, `dashboard.tsx:788`). The ل in «د.ل» paints at/above the top of a 1.0 line box on tall-metric Readex Pro. No clip observed live (padding headroom absorbs the ink; B3's pixel probes found none on cards) — hygiene note, same family the 1.3-floor rule guards. Optional: `leading-tight` on these numeric rows, or keep with a comment.

---

## 3. Typography system scorecard

| Dimension | Score | Evidence |
|---|---|---|
| Font loading architecture | **5/5** | 6 @fontsource faces (ar+la × 400/600/700), 9.8–15.1 KB each (~75 KB total), `font-display: swap`, self-hosted same-origin, HTTP/2 + `immutable` 1y + correct `font/woff2`; build-time plugin preloads exactly the 4 above-fold faces (live HTML verified); throttled-boot CLS ≈ 0; zero unused faces (all 6 load across pages — latin-600/700 pull on product/semibold surfaces) |
| Type ramp discipline | **5/5** | 0 arbitrary px sizes in 200+ source files (test-banned); weights locked to loaded 400/600/700 (test gate bans font-medium/black); fluid steps only where justified; 228 `text-3xs` sites all ≥11px floor |
| Digits policy | **5/5** | Western digits end-to-end: en-US Intl for money/counts, `ar-LY-u-nu-latn` pinned on every date/relative-time call (immune to engines lacking ar-LY data), tests assert no `٠-٩` output; input path normalizes Arabic-Indic → Latin (WhatsApp OTP/phone); tabular-nums global on body + explicit at price sites (live-verified computed `font-variant-numeric: tabular-nums`) |
| Bidi & mixed-script craft | **4/5** | 60+ `dir="ltr"` isolations on codes/amounts/phones/URLs (sign-leads-number spans on wallet/loyalty), `dir="auto"` on every product-name heading surface except F1's two stragglers; parens in RTL Arabic runs correct; mono+ltr chips for order/coupon codes |
| Line-height rhythm | **4/5** | Body 1.7 Arabic-tuned, toast 1.4/1.55, clamps ≥1.375 — but 6 h1s at 1.25 (F3) |
| Letter-spacing / casing | **5/5** | Global guard zeroes all 5 tracking utilities (Latin-only escape via `tracking-[0.2em]`, documented at 9 code/OTP sites); uppercase eliminated from Arabic — 6 remaining sites all Latin-only (coupon codes, «2FA», «WhatsApp OTP») |
| Micro-text | **3.5/5** | 11px floor enforced; B3-K2 remediation verified held (ProductCard desc → 12px/600, register + support lifted); residue: 105 weight-400 muted 11px instances (61 storefront / 167 admin total 11px sites) + the /70 AA fail (F2) |
| Weight & heading craft | **5/5** | No phantom weights anywhere (900→700 documented at the one intentional hero site); h1 per page (39 total, none skipped on audited routes); single font family + mono for codes; serif token exists but zero consumers (honest) |

**Overall: 4.6/5** — one of the most disciplined Arabic-first type systems auditable in the wild; defects are stragglers, not system rot.

---

## 4. Verified-OK (live + source evidence)

1. **Preload efficiency:** 4 preloads (arabic 400/600/700 + latin 400) in served HTML, emitted after the stylesheet link but discovered by the preload scanner in parallel — correct; latin-600/700 deliberately unpreloaded (below-fold/on-demand), and `document.fonts` confirms they load when used, so nothing preloaded is wasted and nothing used is missing. Throttled 400 kbps mobile cold boot: `document.fonts.ready` resolves 8–12 ms after `load`; CLS 0.00002 (≈ zero) — **no layout-shifting font swap on throttle** (mandate §8 confirmed).
2. **font-display:** `swap` on every face (@fontsource CSS) — no FOIT; with same-origin + preload the FOUT window is ~closed.
3. **Fallback metric probe:** mixed Arabic/Latin/digits string — Readex 346px vs generic sans-serif 332px at 16px (+4.3%): swap-width risk minimal even when it fires.
4. **Live computed styles:** PDP h1 «ChatGPT Plus» 32px/700/1.3/`direction:ltr` via `dir="auto"` ✓; home h1 (mobile) 29.6px fluid/700/1.3 ✓; card title 14px/700/1.375 with `dir="auto"` resolving LTR for Latin names ✓; card price 18px/700 tabular-nums ✓; category badge 11px/600 ✓; `document.fonts.check` true for all six faces + true for `900` (confirms 900→700 resolution, matching the documented hero fallback).
5. **Digits (live):** prices «980.00 د.ل» / «99.80 د.ل» western + tabular + consistent د.ل suffix; order/coupon codes in `dir="ltr"` mono chips; relative times Latin-digit.
6. **B3-K2 remediation held:** ProductCard description now `text-xs font-semibold` (12px/600) with the R127-L7 comment; register.tsx + support.tsx consent/note lines lifted to `text-xs font-semibold` — all three R127-flagged sites fixed and pinned.
7. **Ramp/letter-spacing/casing guards:** zero `text-[Npx]`, zero `font-medium|font-black`, zero named-tracking on Arabic, zero uppercase on Arabic in source (test-enforced where possible).
8. **Cache/CSP:** woff2 served `public, max-age=31536000, immutable`, `content-type: font/woff2`, `font-src 'self'` — fonts are first-party, immutable, and compressed (arabic-400 = 9,776 B).

---

## 5. Counts summary

- Findings: **P0 0 · P1 0 · P2 0 · P3 3 (F1–F3) · P4 3 (F4–F6)**.
- Micro-text inventory: **228** non-test `text-3xs` (11px) sites — 61 storefront / 167 admin; **105** are weight-400 muted ink; **2** carry `/70` alpha (AA fail, F2).
- `dir="ltr"` isolations: 60+ sites; `dir="auto"`: 10 sites; missing isolation: 2 money-path truncations (F1) + 2 user-content cousins.
- `uppercase` survivors: 6, all Latin-only. Arbitrary px sizes: 0. Named-tracking on Arabic: 0 (guard). Line-clamp sites audited: 10 — all ≥1.375 leading on body text.
- Font faces: 6 shipped / 6 used / 4 preloaded / 0 unused. Total woff2 ≈ 75 KB; preloaded ≈ 45 KB.

## 6. Recommended fix order

1. F2 (two-line AA fix, admin light-mode readers today) → 2. F1 (`dir="auto"` ×2–4 — money-path brand-name truncation) → 3. F3 (delete 6 `leading-tight`s) → 4. F4 (canon one-word) → 5. F5/F6 (optional polish, accept-and-document is legitimate).

All fixes are S-sized; none touch money logic. No test updates strictly required (the design-system gate already covers the classes these fixes *remove*).
