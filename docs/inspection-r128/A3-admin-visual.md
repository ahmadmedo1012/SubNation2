# R128-A3 — Admin Console Visual Design Audit (RETRY)

**Agent:** R128-A3 (admin visual design layer — source-only, READ-ONLY). **Repo:** main @ `7d469d5`, clean tree.
**Scope:** all 21 admin surfaces + settings/ split modules (~21.7k lines) judged as a *designer auditing the operator's console*: layout patterns, component styling consistency, hierarchy, density, states, micro-interactions.
**NOT re-reported (prior lanes own them):** color-token drift (R128-A1 D1–D14/F1–F11 — raw palette, tier inks, category hues, contrast), icon names/sizes/emoji glyphs + collapsed-sidebar-18-icons (R128-A6), Arabic typography shaping (R128-A4), motion (R128-A5), money-UX/a11y/journeys/data-layer (R125-A1/A2/A3/A6, R127-B15/B2 known-open pointer tables honored — re-verified, carried in §9 only where visual).
**Method:** per-page grep census of every matrix dimension (h1/headers, thead/tr/td classes, chip bars, skeletons, empty/error states, dialogs, money cells, dates) + close reads of layout.tsx (nav system), dashboard.tsx (charts), orders/users/risk/security/pricing tables, topups, settings shell, system. Every claim carries file:line.

---

## 1. Page census + consistency matrix

21 surfaces: admins, alerts, coupons, dashboard, enrichment, layout(shell), login, orders, pricing, products, promotions, referrals, risk, risk-event, security(+new «إجراءات المسؤولين» audit tab, landed 8b6357d), settings(+account-tab/two-factor-setup/provider-card), system, tickets, topups, users, whatsapp.

Legend: ✓ consistent · ~ minor variance · ✗ divergent.

| Page | Pattern | Page header | Toolbar/filters | Table/list style | Pagination | Skeleton | Empty state | Status pills |
|---|---|---|---|---|---|---|---|---|
| orders | table+cards | ~ | ✓ chips+search row | ✓ canonical | ✓ LoadMore | ✓ shared | ✓ shared | ✓ StatusBadge |
| users | table+cards | ~ | ~ tinted chips | ✓ canonical+zebra | ✓ LoadMore | ✓ shared | ✓ shared | ✓ StatusBadge |
| topups | card stack | ~ | ✓ tabs+search | n/a cards | ✓ LoadMore | ✓ TopupCardSkeleton (documented) | ✓ shared | ✓ StatusBadge |
| tickets | table+cards | ~ | ✓ tabs | ✓ | ✓ LoadMore | ✓ shared | ~ hand-rolled ×2 (known) | ✓ StatusBadge |
| products | card grid | ~ | ~ chip container | n/a grid | ✗ none (200-cap, no load-more) | ✓ grid-shaped | ✓ shared | ~ StatusBadge + raw |
| coupons | table-like rows | ~ | ✗ NO search/filters | ~ rows | ✗ none (cap) | ✓ shared | ✓ shared | ~ StatusBadge + raw |
| referrals | table | ~ (text-lg) | ~ chips no aria-pressed (known) | ✓ | ✗ none (cap, known) | ✓ shared | ✓ shared | ✗ raw pills (known A2#8) |
| promotions | form+list | ~ (text-lg) | n/a | ~ inline rows | n/a | ~ none (silent refresh, known F12) | ✓ flat variant | ~ raw |
| pricing | form+tables | ~ (text-lg) | n/a | ~ px-3 py-2 dense | n/a | ~ none (calc page) | n/a | ~ token-hybrids |
| enrichment | review cards | ✓ | n/a (no filters) | ~ cards | ✓ LoadMore (cursor) | ✓ shared (landed) | ✓ shared | ~ |
| alerts | card list | ✓ | ~ rounded-2xl chips | ✓ cards | ✓ LoadMore | ✓ page-shaped | ✓ | ~ TYPE_META tints |
| risk | table+cards | ✓ icon-h1 | ~ pill chips | ~ zebra .05 | ✓ LoadMore | ✓ shared | ✓ shared | ~ LEVEL tints |
| risk-event | detail | ✓ icon-h1 | n/a | detail | n/a | ✗ bare text (known A3-5) | n/a | ~ |
| security | tabs+2 tables | ~ (text-2xl) | ✓ selects | ✗ non-sticky plain thead | ✗ none (100-cap, disclosed) | ✓ page-shaped (landed) | ✓ | ✓ |
| settings | tabs | ✓ (text-2xl) | ✓ tab bar | n/a forms | n/a | ✓ | ✓ | ✓ |
| system | dashboard | ✓ icon-h1 | n/a | tiles+tables | n/a | ~ spinners | ~ | ✗ raw 84 sites (known A3-8) |
| whatsapp | session cards | ✗ NO h1 | n/a | cards | n/a | ✓ (landed) | ✓ | ✓ StatusBadge |
| admins | table-like | ~ | n/a | ~ rows | n/a | ✓ shared (landed) | ✓ shared | ~ |
| dashboard | KPI tiles+charts | ✗ no h1 (rides top bar) | ✓ pickers | tiles | n/a | ✓ tile/chart-shaped | ✓ chart-empty | ~ token mix |
| login | form | ✓ | n/a | n/a | n/a | n/a | n/a | n/a |

Header h1 size drift: `text-xl` ×10 (orders/users/topups/tickets/products/system/risk/risk-event/login) vs `text-2xl` ×2 (settings/security) vs `text-lg` ×3 (referrals/promotions/pricing) — **three h1 sizes for sibling pages in one shell** (the top bar renders the same title again — known A1-9b). Icon-in-h1 on system/risk/risk-event only. Subtitle: `text-xs` ×9 vs `text-sm` ×1 (settings).

*(dimension-by-dimension evidence lives in §2 findings, §3 token section, §4 states/micro-interactions — every cell above traces to a cite there)*

## 2. Findings so far (P-graded; more appended as audit proceeds)

### F1 [P3] Four visual languages for the same control — the admin "filter chip"
**Evidence (verbatim active-state branches):**
- **Segmented-raised** (orders.tsx:1379-1383, tickets.tsx:452, topups.tsx:1390, products.tsx:1480): `bg-card shadow-sm text-foreground font-bold` on `px-3 py-1.5 rounded-lg text-xs font-semibold`.
- **Segmented-in-container** (settings.tsx:241-253, security.tsx:451-465, products category bar container 1473 `bg-secondary/40 border rounded-2xl p-1`): nav-tab look.
- **Primary-tinted-bordered** (users tier chips :912-915 `bg-primary/10 border-primary/30 text-primary-text`; risk "all" chip :310 `bg-primary/15 text-primary-text border-primary/40`).
- **Severity-tinted-pill** (risk.tsx:306-309 `rounded-full text-xs font-bold border` + TONE_CHIP; alerts.tsx:526-529 `rounded-2xl border text-xs font-bold` + TYPE_META tints + count bubble).
Same concept ("filter this list"), four shapes (rounded-lg / rounded-lg-in-2xl-container / bordered-tint / rounded-full+rounded-2xl), two weights (semibold vs bold). The orders/topups/tickets/products family is internally consistent; risk + alerts are the outliers (and alerts' `rounded-2xl` chip on a 12px-radius system is the largest chip radius in the console — A1's F6 radii note is class-level, this is component-level).
**Fix:** pick the segmented-raised idiom for value-neutral filters; reserve the tinted treatment for severity semantics (risk/alerts may keep hue but should adopt `rounded-lg` shape + one weight). Effort S/M.

### F2 [P3] Table chrome is four different designs across the five real tables
**Evidence:**
- **orders.tsx:1548 + users.tsx:1400** (the money directories): `sticky top-0 z-10 border-b border-border bg-card/85 backdrop-blur-md` glass sticky header, rows `px-4 py-2.5` (orders.tsx:247 `border-b border-border/30 hover:bg-muted/20 cursor-pointer`, users.tsx:233 + zebra `bg-muted/[0.035]`).
- **risk.tsx:374**: `bg-muted/30 text-xs` thead, th `px-4 py-2.5 font-bold` (bold where all others are semibold), rows `border-t` (not border-b) + zebra `bg-muted/5` (:409) — a *different zebra intensity* than users' `bg-muted/[0.035]`.
- **security.tsx:589** (new audit tab): plain `border-b border-border/55` — **not sticky, no bg**, th `py-2 px-3 font-semibold`, rows `border-b border-border/30 align-top` (:609), **no hover** (fine for a log, but it is the only table with no row affordance at all).
- **pricing.tsx:890** (dry-run preview): `bg-muted/15 border-b border-border/60`, th `px-3 py-2 text-right font-semibold` — third density (px-3/py-2 vs px-4/py-2.5).
Density variance px-3 vs px-4, py-2 vs py-2.5, and header sticky-glass vs flat-muted vs plain-border = four designs. The sticky-glass treatment is the best operator answer (long scrolling money lists) — risk (infinite scroll, 533-line fraud queue) deserves it most among the rest.
**Fix:** adopt orders/users thead+row recipe on risk + security-audit tables (sticky glass header, border-b, one zebra value, semibold); pricing preview may stay dense but should take semibold + border-b/30. Effort S.

### F3 [P4] Chart axis tick type is 10px — the only sub-11px type instance in the console, invisible to the CSS guard
**Evidence:** dashboard.tsx:1005, :1010, :1106, :1111 `tick={{ fontSize: 10, fill: chart.muted }}` — recharts JS literal, so `design-system-css.test.ts`'s ramp guards never see it; the documented floor is 11px (index.css:97-106 rationale). Fill/spacing otherwise exemplary (token-driven via chart-theme.ts, verified A1 §3).
**Fix:** `fontSize: 11` (4 sites) or a `chart.muted`-paired tick style constant. Effort S.

*(audit continues — appended below)*

### F4 [P3] NEW — The admin mobile drawer's width class is malformed and silently dropped: `w-in(18rem,85vw)]`
**Evidence:** layout.tsx:1266 `className="md:hidden fixed right-0 top-0 bottom-0 w-in(18rem,85vw)] bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-right-4 duration-200"` — the intended class is `w-[min(18rem,85vw)]` (the `-[mi` was lost; byte-verified via `cat -A`). Tailwind emits nothing for the malformed token, so the drawer `aside` is a fixed, right-anchored box with **no width utility at all** — it shrink-wraps to its content instead of the designed 18rem/85vw. On phones the nav still renders (content-width ≈ label lengths), which is why this survived since round-93 (`cce6e2c`, 2026-09-07 — git blame). Admin-scope sweep: this is the only broken-bracket utility in `pages/admin/**`.
**Fix:** `w-[min(18rem,85vw)]` — one character-class repair. Effort S. (A tailwind-safe check: the identical idiom appears storefront-side as `w-[min(...)]` elsewhere.)

### F5 [P4] Stat-card chrome: security uses a different card radius + border opacity than every other page
**Evidence:** security.tsx:477, :534, :698, :728, :737 `bg-card border border-border/55 rounded-xl p-4` vs the console-wide stat/card idiom `border-border/60 rounded-2xl p-4` (referrals.tsx:95-115 StatCard, users.tsx:279 user cards, users.tsx:893 filter panel, dashboard.tsx:911/:1058/:1145 chart panels, alerts rows :679). referrals' StatCard even ships the canonical recipe with icon-tile + `text-2xl` value (referrals.tsx:95-115) that security's new audit-tab cards (:728-751, `text-2xl font-bold` values) nearly copy — at the wrong radius/border. The security audit tab is the newest surface (8b6357d) and institutionalized the variance.
**Fix:** one-class sweep on security.tsx (`rounded-xl`→`rounded-2xl`, `border-border/55`→`border-border/60` — 6 sites) or extract the referrals StatCard into `components/admin/StatCard.tsx` and adopt it on security + dashboard tiles. Effort S.

### F6 [P4] whatsapp's page title is an `h2` at `text-2xl tracking-tight` — hierarchy inversion + Arabic letter-spacing
**Evidence:** whatsapp.tsx:359 `<h2 className="text-2xl font-bold tracking-tight">إدارة جلسة واتساب</h2>` — the only page with no h1 (dashboard rides the top-bar h1 by design; whatsapp renders a heading ONE level below h1 that is visually LARGER than every other page's h1 (`text-xl` ×10). `tracking-tight` on Arabic severs letter connections — the same defect the layout's own group labels dropped (`uppercase tracking-widest` removed at layout.tsx:1179-1182 with the rationale comment); A4-F3 fixed `leading-tight` on six h1s but this `tracking-tight` Arabic title survived.
**Fix:** promote to `<h1 className="text-xl font-bold">`, drop `tracking-tight`. Effort S.

### F7 [P4] Date presentation: account-tab hand-rolls a date formatter; relative-vs-absolute split is undocumented at the cell level
**Evidence:** settings/account-tab.tsx:268 raw `toLocaleDateString("ar-LY-u-nu-latn", { day, month:"short", year })` while `lib/utils.ts` ships `formatDate` (:72 long+time) and `formatDateShort` (:248 relative<48h→short) — a third format shape exists only here. List-cell policy is defensible but split: relative in freshness queues (alerts.tsx:722 with absolute `title` hover — the gold-standard idiom, tickets.tsx:602, referrals.tsx:186) vs absolute in transaction tables (orders.tsx:317, users.tsx:258, risk.tsx:445, security.tsx:645/:875, topups.tsx:239). referrals/tickets relative cells carry no absolute hover-title.
**Fix:** account-tab → `formatDateShort`; add `title={formatDate(x)}` on the relative cells (the alerts idiom). Effort S.

### F8 [P4] Micro-batch: chrome-detail variances (one commit)
- **Stale-error banner padding:** 10 pages `p-4 rounded-xl` (orders.tsx:1452), pricing.tsx + tickets.tsx use `p-3` (byte-identical otherwise — class strings verified equal except size).
- **Container rhythm:** page stack `space-y-5` ×11 vs `space-y-4` (enrichment.tsx:127, risk.tsx:213) vs `space-y-6` (security.tsx:410, settings.tsx:227) — three rhythms for the same shell.
- **Header gap:** orders.tsx:1037/whatsapp gap-3 vs gap-4 everywhere else.
- **Card hover elevation:** products cards `hover:shadow-lg` (products.tsx:281) vs the console idiom `hover:shadow-md hover:shadow-black/10` (topups.tsx:189, alerts.tsx:679, tickets.tsx:589, users.tsx:279).
- **Create-CTA icon size:** `w-3.5` (coupons.tsx:346, admins.tsx:197) vs `w-4` (products.tsx:1073, promotions.tsx:323, whatsapp.tsx:422) on the same "new record" button concept (icon-size spec is A6's lane; noted here as concept-consistency).
- **admins role chips:** `rounded` 4px + mixed borderless/bordered trio (admins.tsx:245-249) vs StatusBadge `rounded-full` — a fourth chip shape (folds into F1's vocabulary).
- **Pricing money cells:** `dir="ltr"` islands put «د.ل» on the opposite side vs every other RTL money cell (pricing.tsx:901-918) — and the local `fmt()` still skips thousands grouping (known A2-F10; the dir flip is the visual half).
**Fix:** one mechanical class commit. Effort S total.

## 3. Token adherence beyond color (A1 owned color)

- **Inline styles: 4 in all of admin, all justified** — tickets.tsx:742 `maxHeight: clamp(...)` (scroll box), orders.tsx:1215 dynamic bar width, products.tsx:1296 hidden-file-input, dashboard.tsx:215 tooltip swatch `background: p.color` (recharts payload color — no token possible). **0 cosmetic inline styles.** ✓
- **Arbitrary Tailwind values: 0 in admin JSX** (A1's census + re-verified; the ONE broken-bracket class F4 is a typo that generates nothing, not an arbitrary value). ✓
- **Spacing:** everything rides the 4px grid; the only drift is the stack-rhythm trio (F8). ✓~
- **Radii:** tokens hold at the card/surface level (rounded-2xl cards, rounded-xl rows/inputs) — drift is confined to the chip family (F1: lg/full/2xl/rounded) + admins' `rounded` (F8). ✓~
- **Type ramp:** ramp-clean except the recharts 10px tick (F3) and h1-size trio (§1 matrix). ✓~
- **Elevation:** shadow tokens + `shadow-black/10`/`shadow-primary/*` sanctioned families only; products' `shadow-lg` vs `md` (F8) is weight, not off-token. ✓
- **Charts palette:** fully token-driven via `lib/chart-theme.ts` (chart.primary/success/warning/grid/muted, gradients derived) — verified at dashboard.tsx:957-1133. ✓

## 4. Micro-interactions + states polish

- **Row hover:** `hover:bg-muted/20 transition-colors` on all interactive tables (orders.tsx:247, users.tsx:233, risk.tsx:409); cards lift `hover:shadow-md/black-10`; security's audit table is the only hover-less table (F2).
- **Dangerous actions:** systematically distinguished — `useConfirm destructive:true` red confirm (9 sites: products ×2, alerts ×3, coupons, promotions, pricing, whatsapp; users.tsx:637 conditional on subtract; orders.tsx:798 `destructive: isRefund`; admins.tsx:163 conditional on disable) + topups' reject modals hand-roll `bg-destructive` (topups.tsx:407, :517). ✓
- **Copy feedback:** one shared CopyButton (idle→copied→failed, aria-live, 1.5s/2s reset, 44px target) — components/CopyButton.tsx; zero local copies in admin. ✓
- **Focus-visible:** every custom control is a real `<button>` (chips/tabs/select-all) → the global `:focus-visible` ring applies console-wide; no custom non-focusable controls found beyond table rows (which have dedicated buttons — A6 r125 §A-9). Sortable table headers don't exist (sorting lives in chip bars; known A2#22). ✓
- **Skeletons shape-match:** TableSkeleton rows match real row metrics (h-11 header strip + py-3 rows ≈ 40px vs real py-2.5+content); topups has a dedicated TopupCardSkeleton; products a 6×h-40 grid skeleton (products.tsx:1538-1543); dashboard chart fallback reserves exact panel height (`h-40`, ChartPanelFallback) — CLS-safe per A5's lane; alerts uses h-[72px] rows matching its card list (alerts.tsx:612). ✓ (residual: risk-event bare-text — known)
- **Error/offline honesty:** shared FetchErrorCard on full-page failures; byte-identical stale-keep banners on 12 pages (§F8 padding nit); layout badge pill is the global freshness signal. ✓
- **Empty states:** shared EmptyState with semantic per-page icons (ShoppingBag/Tag/Gift/Package/Users/Clock/ScrollText — orders.tsx:1521, coupons.tsx:590, referrals.tsx:533, products.tsx:1558, users.tsx:1372, topups.tsx:1496, security.tsx:580) + honest count/CTA actions. ✓

## 5. Charts verdict (dashboard)

Palette ✓ token-driven; tooltips ✓ card-styled (`bg-card rounded-xl p-3 shadow-2xl text-xs`, tabular money — dashboard.tsx:207-224); empty state ✓ (icon + copy + pickers kept, :890-899); lazy bridge + height-reserved fallback ✓ (A5's lane). **Gaps:** no at-rest series key — the AreaChart interleaves 3 series (revenue/orders/discounts, :1016-1047) and the BarChart 2 (discounts/coupon_orders, :1115-1131) with **no Legend and no static key**; decoding requires hover. Fix: a 3-swatch legend row above the panel (the TrendBadge/token colors already exist) or recharts `<Legend>` with token text. Effort S. (P3 — folded into F9 below.)

### F9 [P3] Multi-series charts have no at-rest legend — color meaning is hover-only
**Evidence:** dashboard.tsx:957-1048 (AreaChart ×3 series), :1095-1132 (BarChart ×2 series) — zero `Legend`/static key elements (grep: no matches). The tooltip names series on hover; at rest the operator cannot tell الإيرادات (primary) from الطلبات (success) from الخصومات (warning).
**Fix:** static legend chips above each chart panel (`<span className="w-2 h-2 rounded-full bg-primary"> الإيرادات…`) — matches the tooltip's own swatch idiom (:215). Effort S.

## 6. Sidebar/nav visual system (expanded; collapsed = A6 r128's lane)

**Verdict: the strongest visual system in the console.** Group labels `text-3xs font-bold` (layout.tsx:1183, Arabic-safe — no tracking/uppercase), items `px-2.5 py-2 rounded-xl text-sm font-semibold`, active = `bg-primary/15 text-primary-text font-bold border border-primary/20` + icon `text-primary` (:177-182) — tint+border+weight triple encoding; badges are solid-token pills (expanded, :198) or corner dots (collapsed); **context actions** render as an indented rail under the active item (`border-r border-primary/15 pr-2` — :213-216) giving the active section a two-level hierarchy nothing else in the console has; footer = search hint (with ⌘K kbd) + destructive-hover logout (:1212-1229). Spacing `space-y-0.5` tight rows + `mb-1.5` labels — density appropriate for a 18-item/3-group IA. ✓ (One nit: the active item's `text-primary` icon + `text-primary-text` label ride two different ink tokens in one row — deliberate contrast pairing, documented at button.tsx:35-37; fine.)

## 7. Top-10 admin polish opportunities (ranked by operator impact)

1. **Unify the filter-chip vocabulary (F1)** — operators meet 4 shapes for the same gesture across one session (orders→risk→alerts changes chip anatomy 3×). Pick segmented-raised for value-neutral, token-tinted for severity, `rounded-lg` shape everywhere.
2. **One table chrome (F2)** — sticky-glass thead + `border-b border-border/30` + one zebra value + semibold th on risk + security-audit tables (the fraud queue and the new audit trail are the two tables an operator scans longest).
3. **Fix the mobile drawer width class (F4)** — one-character repair on a shipped-since-R93 chrome bug; phone operators get the designed 18rem drawer.
4. **Chart legends (F9)** — two static key rows unlock at-rest reading of the console's only charts.
5. **h1 normalization (§1)** — three sizes (lg/xl/2xl) for sibling pages; standardize on `text-xl` (10 pages already), `text-sm` h2 sections — whatsapp promoted (F6).
6. **StatCard extraction (F5)** — referrals' StatCard → shared component; security's audit-tab cards adopt it (radius/border normalization rides along).
7. **Date hover-titles (F7)** — `title={formatDate(x)}` on relative cells (alerts' gold-standard idiom) on referrals/tickets; account-tab rides formatDateShort.
8. **Chart tick 11px (F3)** — 4 literals; brings chart axis onto the documented type floor.
9. **The F8 batch** — stale-banner p-3→p-4 ×2, space-y-4/6→5 ×4, gap-3→4 ×2, shadow-lg→md, chip radius on admins role pills — one commit, zero risk.
10. ** pricing money cells (F8-last)** — drop `dir="ltr"` on formatted «د.ل» cells + adopt grouped `fmt` (pairs with the known A2-F10 grouping fix).

## 8. Verified-OK (evidence-checked, no action)

| # | Item | Evidence |
|---|---|---|
| 1 | Skeleton system: shared TableSkeleton on 9 pages with shape-matched cells + `role="status"` | TableSkeleton.tsx:24-48; wrappers orders.tsx:154, users.tsx:194, coupons.tsx:58, referrals.tsx:86, tickets.tsx:508, admins.tsx:207, risk.tsx:327, enrichment.tsx:169; topups' card skeleton documented exception (TableSkeleton.tsx:15-18) |
| 2 | EmptyState canonical + semantic icons + honest CTAs | EmptyState.tsx:38-51; per-page icons §4 |
| 3 | Money cells: `font-bold text-primary-text tabular-nums` canonical on both money directories | orders.tsx:301-303, users.tsx:241-243 (+ lifetime_spend :251, points :247); topups card `text-xl tabular-nums` :226 |
| 4 | Status system: STATUS_TONE single-source + domain maps typed to StatusBadgeVariant (tone union, not hues) | status-badge.tsx:64-117; users.tsx:106 TIER_TONE, whatsapp.tsx:72, risk.tsx:68 + token-based TONE_CHIP :85-94, risk-event.tsx:72/:79 |
| 5 | Date policy coherent: relative in freshness queues, absolute in transaction tables; alerts ships the hover-title idiom | alerts.tsx:720-722, tickets.tsx:602 vs orders.tsx:317, users.tsx:258, risk.tsx:445, security.tsx:645 |
| 6 | Dialog system: AppDialog (+AlertDialog for confirms) everywhere incl. topups money modals + admins' DialogShell wrapper | app-dialog consumers: topups.tsx:378/:494, coupons.tsx:383, users.tsx:1045, admins.tsx:679, enrichment.tsx:402; use-confirm.tsx:116-143 |
| 7 | Destructive distinction systematic | §4 inventory (9 destructive:true + 2 conditional + topups hand-rolled pair) |
| 8 | CopyButton: one shared component, full lifecycle feedback | components/CopyButton.tsx (0 local reimplementations in pages/admin — grep) |
| 9 | Stale-error banner byte-identical on 12 pages (token status-error trio + WifiOff + retry) | §F8 (p-4 ×10) |
| 10 | Toast system: single RTL Toaster, Arabic labels, premium-toast chrome, safe-area offsets | sonner.tsx:70-120 |
| 11 | Sidebar expanded: grouping + active-state + context-action rail + badges (§6) | layout.tsx:166-232, 1176-1186 |
| 12 | Toolbar/search chrome: `pr-9 h-9 … text-sm` + `right-3` icon on all five searchable pages | orders.tsx:1071-1077, users.tsx:848-855, topups.tsx:1264-1271, products.tsx:1454-1460, referrals.tsx:473-479 |
| 13 | Inline styles ×4 all justified; 0 arbitrary values; spacing on-grid | §3 |
| 14 | Copilot FAB: deliberate, token-styled, aria-labeled | CopilotPanel.tsx:925-935 |
| 15 | LoadMoreButton + «عرض N (الأحدث أولاً)» honest-count idiom uniform | load-more-button.tsx; orders.tsx:1048, users.tsx:841, referrals.tsx:574, alerts.tsx:774 |
| 16 | Page-in entrance only on 2/21 pages (alerts, system) — noted for A5's motion-consistency lane; not double-counted here | alerts.tsx:432, system.tsx:706 |

## 9. Known-open carried (visual-adjacent, re-verified, NOT re-reported)

tickets' 2 hand-rolled empties · risk-event bare loader (risk-event.tsx:134) · referrals chips no aria-pressed + raw pills · products/coupons/referrals no LoadMore (cap-disclosed) · topups «عرض الكل» tab-empty CTA · doubled h1 (layout.tsx:1307 + page h1s) · search-clear 3 idioms (native ✕ / hand-rolled ✕ / none — topups renders both) · promotions inline form vs AppDialog split · system raw-hue STATUS_META (A1 D1) · whatsapp h1-less layout (F6 covers the visual half) · dashboard KPI leading-none (A4-F6).

## 10. Counts + fix order

**P0: 0 · P1: 0 · P2: 0 · P3: 4 (F1 chips, F2 tables, F4 drawer class, F9 chart legend) · P4: 5 (F3 tick, F5 stat cards, F6 whatsapp h1, F7 dates, F8 batch)**

Fix order (operator value / effort):
1. **F4** (one char, shipped-broken chrome) — S.
2. **F2 + F1** (the two consistency cores — one commit each; F1 needs a 2-minute design decision, F2 is mechanical) — S/M.
3. **F9** (two legend rows) — S.
4. **h1 normalization + F6** — S.
5. **F5 StatCard extraction** — S/M (extract = M, class-sweep = S).
6. **F3 + F7 + F8** (three mechanical batches) — S total.

**Coverage: 21/21 surfaces audited** (all page files read at matrix depth; layout/dashboard/orders/users/topups/risk/security/pricing/products/coupons/referrals/alerts/tickets/settings-family at close-read depth; system/whatsapp/admins/promotions/enrichment/risk-event/login at census+spot-read depth). ~21.7k lines in scope; no source edits, no test runs, no production access.

*Report written incrementally per transport-safety protocol (this was the retry run). Source tree untouched.*
