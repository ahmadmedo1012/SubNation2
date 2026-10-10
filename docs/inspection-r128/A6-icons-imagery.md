# R128-A6 — Iconography & Imagery Consistency Audit (المظهر — the symbolic layer)

- **Agent:** R128-A6 · **Repo:** `/home/z/my-project/repos/SubNation2` @ `7d469d5` (main)
- **Mandate:** icon census + RTL icon correctness + icon/label pairing + product imagery system + brand asset suite + empty-state/status art + badges/chips/ornament + live guest spot-check. READ-ONLY on source; only this report + worklog.
- **Method:** scripted full-source census (2 passes: JSX usage + map/array references), targeted code reads of every directional-icon site, live GET probes (`/api/products`, HEAD ×45 product images, brand assets), Playwright canvas pixel-analysis of all 6 brand assets + 6 rendered guest screenshots (1280/390px), VLM (glm-5v) visual inspection of pwa-512 / opengraph.jpg / pwa-screenshot / 4 live pages. Evidence artifacts: `/home/z/a6-work/` (census-full.txt, attrs2.txt, shots/, og-vlm*.json).
- **Known-items read first (not re-reported):** `docs/history/ux-audit-icons.md` (the R96 icon audit — 30-row RTL table), `docs/ux/FINAL_UX_SYSTEM.md` (tokens; no icon section exists), R127-B13 (storefront UX + ledger), R127-B3 (impeccable: K1 badge-squeeze P2, K2 micro-contrast P3), R127-B4 D5 (LCP fetchpriority half-live), R126-A13 (a11y), R125-A6/A7, A5-motion (this round).

---

## 1. Icon census (whole frontend/src)

**70 files import from `lucide-react` · 624 imported symbols · 137 distinct icons · 709 JSX usages + 178 map/array references = 887 total usages · 0 dead imports** (ad05d11 chunked lucide — tree-shaking intact; all icons referenced by name are consumed).

### Top of the census (count = JSX + refs)

| Icon | Uses | Primary contexts |
|---|---|---|
| Loader2 | 56 | pending buttons/forms ×29 files (universal spinner) |
| RefreshCw | 34 | refresh/retry — admin-wide idiom + status.tsx + FetchErrorCard retry |
| CheckCircle | 34 | success status rows/badges (storefront orders + admin) |
| AlertTriangle | 33 | warning banners/admin risk surfaces/ErrorBoundary |
| AlertCircle | 30 | error banners + sonner error toast |
| Clock | 28 | pending states, timestamps |
| X | 26 | dialog/drawer close, dismiss |
| XCircle | 24 | failure status |
| Plus | 21 | create/add actions |
| ChevronLeft | 21 | forward links / accordion rotators / breadcrumbs |
| Package | 19 | order/product semantics + orders empty-state |
| WifiOff | 18 | outage tiles (FetchErrorCard default + admin lists) |
| Wallet / ShieldCheck / Sparkles / Tag / Info | 14–18 | money, trust, AI/copilot, price/discount, info |
| CheckCircle2 | 14 | sonner success toast, checkout success, topup modal, copilot |
| CheckSquare/Square | ~14 | admin row-select toggles (aria-pressed pattern) |
| ArrowRight ×8 / ArrowLeft ×7 / ArrowUpLeft ×2 / ChevronRight ×1 / RotateCcw ×2 | 20 | the directional set (§2) |

**(a) Same action, different icons:** `Edit2` (products/users/variants) vs `Pencil` (enrichment) for the same «تعديل» verb (P4-3). `CheckCircle` vs `CheckCircle2` for the same success semantics across adjacent surfaces (P4-1). Otherwise refresh=RefreshCw everywhere (34:1 vs RotateCcw which is exclusively "wizard step-back" in WhatsAppPhoneSignIn — a clean semantic split), send=Send (mirrored ×4), copy=Copy, delete=Trash2 — no drift.

**(b) Same icon, different semantics:** `CheckCircle2` on risk-event's «تصعيد» ACTION button (success glyph on a neutral escalate action — P4-1 rider). `ShieldCheck` triple-duty: vpn category fallback art + trust badges + admin-managers nav — contexts are disjoint enough to pass. `Sparkles` = AI everywhere (copilot/enrichment/ai-tools) — coherent.

**(c) aria-hidden on decorative icons:** only 19/709 JSX icons carry `aria-hidden` (the highest-traffic spots do: ProductCard media/badges, home links, PDP breadcrumb, LinkConsentModal). No icon carries a stray aria-label — naming is done on the interactive parent. Unlabeled SVGs are mostly skipped by AT, so impact is low — filed as hygiene P4-10, not a blocker.

**(d) Icon-only buttons without an accessible name — exhaustive scripted sweep (14 candidates → manually verified):** ONE real cluster: the **collapsed admin sidebar** — all 17 NavItems + the logout button lose their labels with no aria-label/title (`admin/layout.tsx` NavItem `{!collapsed && <span>…}` :194-206, logout :1224-1235) = 18 unnamed links (P3-1). Everything else on the storefront is named: support back (`aria-label="رجوع لقائمة التذاكر"`), PDP quick-add ×2, admin login eye toggle, Navbar cart/bell/menu/theme ×7, MobileNav tabs (count-bearing cart label). Admin icon buttons rely on `title=` (dashboard CSV export, layout refresh) — acceptable fallback, aria-label preferred (P4 note).

**(e) Size discipline:** 683/709 icons carry explicit size classes; de-facto scale = **2–2.5** micro-badges (Tag/Lock in card badges) · **3** inline-with-text · **3.5** dense admin buttons / compact storefront rows · **4** standard (`Button`'s `[&_svg]:size-4` default) · **4.5** card-heading tier ×8 · **5** page headers · **7–10** empty-state/hero art · **12** splash. 13 distinct values but each has a role; the scale is real yet **undocumented** (folds into P3-2). 26 icons inherit sizing from parent (`[&_svg]:size-*`) — intentional, works.

**(f) Stroke-width:** lucide default 2 everywhere EXCEPT five documented, reasoned override families: sonner toast icons `strokeWidth={2.4}` (toast prominence), MobileNav tabs `2.5 active / 1.8 idle` (weight-as-active-state), category-fallback art `1.6` (ProductCard + flash-sales), TopupWaitingModal progress arcs `6`, dashboard/system chart glyphs `1.5/2`. Logo.tsx inline brand SVG 1.5/1.2 (not lucide). **No unexplained drift.**

## 2. RTL directional correctness — VERDICT: PASS (best-in-class discipline, one doc-level contradiction)

The R96 unified decision (RTL-always; **back=points right, forward=points left**, breadcrumb separator=forward, accordion=rotator) still holds at every site, and improved since R96:

- **Back=right:** product.tsx:1142 (`ArrowRight` + `group-hover:translate-x-0.5` — motion matches), order-detail ×3, risk-event ×2, not-found (comment-pinned), support icon-only back button, category.tsx:237 + referrals.tsx:239 (`ChevronLeft rotate-180`), admin tickets:678. ✓×10
- **Forward=left:** home «عرض الكل»/login ArrowLeft ×3, referrals, orders:633 (+ hover `-2px`), profile, loyalty:650, system:1585, Navbar:490, FlashSaleBanner:255, dashboard ArrowUpLeft (KPI go-to, comment-pinned), admin security pagination («السابقة»=ChevronRight / «التالية»=ChevronLeft). ✓×14
- **Breadcrumb separators:** product.tsx:1111/1120, category.tsx:267, terms.tsx:251 — all unrotated `ChevronLeft` per the **R124 (A1-F6) decision change** (separator = traversal forward = left), pinned by `terms-legal-page.test.tsx:45-54`. Live-rendered confirmation: VLM on /category/streaming screenshot — "separators point left toward the current category; back link arrow points right". ✓ — BUT the archived R96 table (`docs/history/ux-audit-icons.md` row: separator = `ChevronLeft rotate-180` يميناً) still documents the **old, now-inverted rule** → P3-2.
- **Accordions/dropdowns:** ChevronDown rotators + `group-open:-rotate-90` ChevronLeft pattern (support FAQ, category FAQ) ✓. StockoutRiskPanel closed=ChevronLeft/open=ChevronDown ✓.
- **Send icons:** all 4 are mirrored (`-scale-x-100` ×3 + `rtl:-scale-x-100` in CopilotPanel) — R96's deferred item #28 is now DONE ✓ (the `rtl:` prefix is redundant in an always-RTL app; cosmetic).
- **ExternalLink** ×11 — neutral, correct per convention. No carousels exist; no sort-direction arrows exist (sort = ChevronDown rotators only).
- Nits: security.tsx pagination chevrons use physical `ml-1`/`mr-1` (works visually; logical `ms/me` is the stated convention — P4-7). loyalty.tsx:685 `ArrowUpLeft` decorates a static informational note (no action) — a "forward" glyph with no destination (P4 rider).

## 3. Icon+label pairing — VERDICT: PASS

Shared `Button` = `gap-2` + `[&_svg]:size-4` → every system button pairs icon+text uniformly; hand-rolled admin buttons follow `gap-2 + w-3.5` faithfully (settings family). Icon-only buttons are 44px+ (support back w-11 h-11, PDP quick-add, CopyButton min-h-11). Tooltips = native `title` in admin only (no tooltip component — fine at this scale). MobileNav: icon+3xs label + active pill, cart badge on the inline-end corner (RTL-correct `-left-2`), count-bearing aria-label. Empty-state icon size/weight: see §6.

## 4. Product imagery system — VERDICT: EXEMPLARY (best surface in this audit)

- **45/45 live products:** `/products/*.webp`, **all exactly 450×450 (1:1), 2.5–34 KB (mean 12 KB)** — zero oversized/undersized; uniform `public,max-age=2592000` + SWR caching; all HEADs 200 `image/webp`.
- **Naming:** 41/45 `slug == filename`; 4 legacy brand names (netflix.webp, disney-plus.webp, prime-video.webp, apple-tv-plus.webp) — all resolve fine; cosmetic only.
- **Card treatment unifies the third-party art:** `aspect-square` box + fixed width/height attrs (CLS 0) + `object-contain` + one top-lit pad gradient behind EVERY image (white-bg and transparent art read as one system — R120-B1), rounded-2xl card chrome, category accent hairline, `max-w-[74%] max-h-[74%]` inner scale + hover `scale-[1.06]` (B3-waived convention).
- **Loading tiers (R127-B4 D5 verified + upgraded):** `loading={index<4 ? eager : lazy}` + `fetchPriority` high(0-1)/auto(2-3)/low(4+) + `decoding=async` — the first-4 warming is fully live, now with first-2 high.
- **Alt text:** descriptive with category context («Grammarly Pro — اشتراك أدوات ذكاء اصطناعي»), dedupes «اشتراك».
- **Sold-out/locked treatment:** `opacity-45 saturate-[0.3]` whole-card dim + black/75 blur «نفد» pill w/ Lock (top-right = inline-start in RTL) + card still navigates (honest PDP) — coherent.
- **Fallbacks:** onError → CATEGORY_ICON glyph tile (accent-tinted) on cards + PDP; thumbs on cart/orders/checkout/home flash-sales all `lazy+async+object-contain`; admin products uses a first-LETTER tile instead of the icon idiom (P4-9 divergence); cart thumb's letter-fallback is a documented deliberate deferral (needs `category` on LocalCartItem — B-11 family).

## 5. Brand asset suite — VERDICT: FRAGMENTED (the round's real appearance debt)

Four surfaces, four different marks:

| Asset | Actual content (pixel + VLM verified) | vs in-app brand |
|---|---|---|
| **In-app Logo.tsx** | crimson gradient rounded tile + white shield w/ play triangle + orbit dot | — (the reference mark; also AppSplashScreen) |
| **favicon.svg** (163 B) | **blank solid-orange (#FF3C00) rounded rect — NO mark, wrong hue** (96% of pixels uniform orange) | ❌ no mark, off-brand hue |
| **pwa-96/192/512.png + apple-touch-icon** | pale-pink/white **horizontal banner lockup**: shopping-bag glyph + "SubNation" wordmark + shield, full-bleed | ⚠️ same shield family, wrong format (banner-in-square) |
| **opengraph.jpg** (1280×720, 39.6 KB — matches og meta ✓) | dark **full-page product screenshot** w/ hero copy that no longer exists, a **circular red logo badge**, and service pills **Netflix, Spotify, Disney+, PlayStation, Canva, Adobe, Office 365** | ❌ stale content (PlayStation = retired category; Canva/Adobe/Office 365 = not in the 45-product catalog) |
| subnation-logo.png (JSON-LD `logo`) | white 1200×800 lockup of the banner family | ⚠️ consistent with PWA, not with favicon/og |
| pwa-screenshot-narrow/wide | **current live UI, on-brand, defect-free (VLM)** | ✓ |

Manifest itself is solid: hand-written single source (vite `manifest:false` ✓), RTL `dir`, Arabic metadata, theme_color #dc1840 matches, shortcuts + labeled screenshots ✓. The **maskable** declaration reuses the banner pwa-512 — VLM confirms the circular crop cuts the shopping-bag end of the lockup → launcher-mangled icon. No favicon.ico/PNG fallback: Safari desktop (no SVG favicon support) falls back to a generic letter tile.

## 6. Empty-state & status art — VERDICT: coherent ingredients, non-tokenized scale

- **Storefront:** muted rounded-2xl tile + faded semantic icon + bold line + hint + CTA — the recipe is consistent, the **sizes are ad-hoc per page**: orders w-20 tile/w-9 icon, flash-sales w-16/w-8, wallet w-16/w-7, referrals w-16/w-7 @opacity-20, loyalty w-14/w-6; category + home empties are text-only (no icon art). P4-5.
- **Admin:** canonical `EmptyState` (w-12 tile, w-5 icon @opacity-30, role="status" — R125-A6 B-8) + two documented exceptions. Loading = shape-matching RouteSkeletons (A5 verified); outage = FetchErrorCard (WifiOff tile + RefreshCw retry) — outage ≠ empty discipline holds everywhere (B13 §6 re-confirmed).
- **ErrorBoundary** crash screen: w-20 tile + AlertTriangle w-9 — warning glyph on a fatal-error surface (P4-2).

## 7. Badges / chips / ornament

- Category chips: 9-hue `--cat-*` tint system (B3-waived, documented) + `min-h-11` targets; active = solid primary. Consistent home↔category↔admin previews.
- Discount badge: bg-primary pill + Tag w-2 + % (text-3xs, tabular) — top-right (inline-start) ✓. Sold-out: black/75 blur pill. Popular: StatusBadge Star (≥20, warning tint) / Zap (5-19, success tint) — shape/color/typography consistent trio. (B3-K1 badge-squeeze + A13-F12 sale-badge contrast = known, not re-reported.)
- **Emoji-as-icon residue:** CopilotPanel tool-progress labels use 🔍📋📦📜✏️⚙️🔧 emoji + ✓/✗ glyphs (:680-692); three status lines use the **✓ text glyph** instead of lucide Check (product.tsx:1959 «رصيد كافٍ ✓», account-tab.tsx:258, alerts.tsx:642) (P4-4). R124 already swept support's category emojis — that fix verified intact. referrals.tsx:159 🎬 is WhatsApp message copy (idiomatic, not UI — fine).
- Auth provider marks: Telegram = real brand glyph (CSP-safe inline SVG, aria-hidden ✓); WhatsApp = generic `MessageCircle` (text-brand-whatsapp) — asymmetric brand fidelity on the same screen (P4 rider).

## 8. Live spot-check (guest, Playwright + VLM)

`/` 1280+390, `/category/streaming`, `/product/lifetime-cloud-storage`, `/flash-sales`, `/support` — zero page errors; breadcrumb/back arrows render per rule (§2); guest MobileNav tabs (Home grid/cart/login) render correctly; card badges (نفد/Lock pills) visible on the 44/45 sold-out catalog; PDP media = padded contain + «موثوق ومضمون»-style trust pills; category chips active/inactive correct; favicon link = the orange tile (§5). No misaligned or wrongly-pointing arrow found in any screenshot.

---

## Findings

### P2-1. favicon.svg is a blank, off-hue orange tile — the brand mark is missing from every browser tab
**Where:** `frontend/public/favicon.svg` (163 B: `<rect fill="#FF3C00" rx="36"/>` — nothing else); referenced `index.html:87` `<link rel="icon" type="image/svg+xml">`.
**Why it matters:** brand primary is **#dc1840** (theme-color, manifest, Logo.tsx gradient tile); the tab/bookmark/history icon is a *different hue* with *no mark at all*. Plus: no PNG/ICO fallback → Safari desktop (no SVG-favicon support) shows a generic letter tile. The most-seen brand surface on the least-branded asset.
**Fix (S):** export Logo.tsx's tile (crimson gradient + white shield+play) as the new favicon.svg (180×180, rounded); add `pwa-192` or a 32px PNG `<link rel="icon" sizes="32x32">` fallback. Confidence 5 (asset read + pixel-verified).

### P2-2. PWA icons are a horizontal banner lockup — reused as `maskable`
**Where:** `public/pwa-512x512.png` declared `purpose:"maskable"` in `manifest.json:41-46`; same banner as `pwa-192` = `apple-touch-icon` (`index.html:89`).
**Why it matters:** VLM inspection: the asset is a wide lockup (shopping-bag glyph + "SubNation" wordmark + shield) on pale pink — a *banner*, not an app icon. Android's circular maskable crop **cuts the bag end** (VLM: "would likely be cut off"); launcher `any` usage letterboxes the wordmark tiny; iOS home screen shows the same banner. Pale-pink square also clashes with the dark default theme + `background_color:#0a0a0a` splash.
**Fix (M):** generate a dedicated square icon — full-bleed crimson tile + centered white shield (the in-app mark), mark centered in the 80% safe zone; keep the lockup only for og/JSON-LD contexts. Confidence 5 (pixel + VLM + manifest cross-read).

### P2-3. opengraph.jpg is a stale product screenshot advertising retired/absent catalog items
**Where:** `public/opengraph.jpg` (1280×720 — dimensions meta correct ✓, 39.6 KB ✓).
**Why it matters:** two independent VLM passes: full-page screenshot of a hero that no longer exists («جديد» badge, service-pills row: **PlayStation** — a *retired* category (r120-B3), **Canva / Adobe / Office 365** — not in the 45-product catalog), plus a **circular red logo badge** that matches neither the in-app shield tile nor the PWA banner. This is the WhatsApp/Telegram share card — the market's #1 social surface — telling users the store sells what it doesn't.
**Fix (S-M):** regenerate as a purpose-built dark card: shield tile + «SubNation — سوق الاشتراكات الرقمية» + a row of REAL catalog logos (Netflix/Spotify/ChatGPT/Windows) + د.ل promise. Confidence 4 (VLM ×2 consistent; catalog verified via live API).

### P3-1. Collapsed admin sidebar: 18 icon-only links with no accessible name
**Where:** `pages/admin/layout.tsx` — NavItem renders `{!collapsed && <span>{item.label}</span>}` (:194-206) and logout `!collapsed && <span>خروج</span>` (:1224-1235); no `aria-label`/`title` in either collapsed branch.
**Why it matters:** with the rail collapsed, every section (17 items) + logout is an unnamed icon link — a screen-reader admin gets "link, link, link…". The expanded state names everything; storefront icon buttons all carry aria-labels — this is the one systemic gap left.
**Fix (S):** `aria-label={item.label}` on the collapsed `<Link>` + `title={item.label}` (hover affordance); same for logout. Confidence 5.

### P3-2. The icon-direction contract lives only in an archived doc that now contradicts the code
**Where:** `docs/history/ux-audit-icons.md` (R96 table: breadcrumb separator = `ChevronLeft rotate-180` يشير يميناً) vs the R124-A1-F6 rule in code (separator = **unrotated**, forward=left) pinned at `product.tsx:1106-1110`, `category.tsx:262-266`, `terms-legal-page.test.tsx:45-54`. `docs/ux/FINAL_UX_SYSTEM.md` §5 covers RTL text but has **no icon section at all** (no back/forward rule, no size tiers §1e, no stroke-width policy §1f).
**Why it matters:** the only human-readable spec of the app's most-audited visual rule states the *inverse* of what the pin tests enforce. Any contributor (or future audit agent) reading the archived doc will "fix" breadcrumbs backwards — exactly the drift R96→R124 already paid for once.
**Fix (S):** add an "Iconography" section to FINAL_UX_SYSTEM.md (back=right / forward=left / separator=left / rotator rules, size tiers 2–12, stroke policy, Send-mirroring) and a one-line "superseded by" banner on the archived R96 table. Confidence 5.

### P4 findings (S cost each)

- **P4-1. Success-glyph split:** `CheckCircle` (34) vs `CheckCircle2` (14) render the same success semantics across adjacent surfaces (inline order rows CheckCircle vs sonner toast CheckCircle2 in the same flow). Rider: `risk-event.tsx:298` puts `CheckCircle2` on the **«تصعيد» action button** — a success glyph on a neutral action. → standardize on one glyph; give تصعيد an action glyph (ArrowUpLeft/Flag).
- **P4-2.** `ErrorBoundary.tsx:112` crash art = AlertTriangle (warning family) for a fatal error — error=AlertCircle everywhere else (sonner, banners).
- **P4-3.** `Edit2` vs `Pencil` for the same «تعديل» verb (products/users/variants vs enrichment.tsx:355).
- **P4-4.** Emoji-as-icon residue: CopilotPanel.tsx:680-692 tool labels (🔍📋📦📜✏️⚙️🔧, ✓/✗); ✓ text glyphs at product.tsx:1959, account-tab.tsx:258, alerts.tsx:642 — swap to lucide Check/Search/etc.
- **P4-5.** Storefront empty-state art scale is ad-hoc (tile w-14/16/20, icon w-6/7/8/9, opacity .20/.25; category/home empties text-only) — tokenize one storefront recipe like admin's EmptyState.
- **P4-6.** Admin sidebar carries three near-identical shield glyphs side by side (ShieldCheck=إدارة المسؤولين, Shield=مراقبة المخاطر, ShieldAlert=سجل الأمان) — distinctiveness relies on labels.
- **P4-7.** `security.tsx:664/674` pagination chevrons use physical `ml-1`/`mr-1` (logical `ms/me` is the convention; renders fine).
- **P4-8.** `order-detail.tsx:359` copy button's accessible name is the order code itself — append «نسخ» to the aria-label.
- **P4-9.** Admin products fallback = first-LETTER tile (products.tsx:312-322) vs storefront's CATEGORY_ICON glyph idiom — converge when convenient.
- **P4-10.** Decorative `aria-hidden` hygiene: 19/709 icons carry it; harmless today (unlabeled SVGs skipped by AT, parents named) but the pattern should ride the Button/nav primitives, not per-site.

## Imagery system verdict

**Product imagery: exemplary** — one format, one aspect (450²), one weight class (≤34 KB), one naming scheme (41/45 slug-tied), tiered eager/lazy + fetchpriority, CLS-proof attrs, honest sold-out overlay, category-icon fallback, descriptive Arabic alt. **Brand asset suite: fragmented** — four surfaces show four different marks (in-app shield tile / blank orange favicon / banner lockup PWA / stale screenshot og), with the favicon blank+off-hue and the og advertising retired products. The symbolic layer inside the app is world-class; the layer *around* the app (tabs, launchers, share cards) is the appearance debt of R128.

## Verified-OK (spot list)

RTL direction table §2 (all 24 directional sites + live-rendered breadcrumb/back) · Send mirroring (R96 #28 closed) · Eye/EyeOff toggle idiom ×3 · RefreshCw 34:1 refresh monopoly · admin RefreshCw retry idiom · ExternalLink neutrality · MobileNav icon+label+badge+aria · Navbar aria-label discipline · ProductCard image pipeline (§4) · PDP media + onError fallback · admin EmptyState canonical component + role="status" · FetchErrorCard outage≠empty · manifest metadata (RTL/name/theme/shortcuts/screenshots) · og dimension meta honesty (1280×720) · Telegram brand glyph CSP-safe + named · zero dead icon imports · no emoji in storefront UI copy (post-R124) · PWA screenshots = current UI.

## Counts

**P0:0 · P1:0 · P2:3 (favicon, PWA-maskable, og) · P3:2 (collapsed-sidebar names, icon-contract doc) · P4:10 · verified-OK: 21 clusters.**

## Next actions (ordered)

1. **One brand-asset commit (M):** favicon.svg = Logo tile + PNG fallback (P2-1) + dedicated square maskable icon (P2-2) + regenerated og card from the live catalog (P2-3). This single commit closes all P2s.
2. **One S-commit:** P3-1 (aria-labels ×18) + P3-2 (FINAL_UX_SYSTEM icon section + archived-doc banner).
3. **One P4 sweep:** P4-1/2/3/4 (glyph unification + emoji/✓ removal) — ~15 lines.
4. Optional: P4-5 empty-state tokenization when the design pass runs (folds into B-12's batched commit).
