# R125-A6 — Admin console Accessibility + RTL audit

- **Repo**: SubNation2 @ `09857fc` (main, clean tree). Production: https://subnation.ly
- **Scope**: all 21 `frontend/src/pages/admin/*.tsx` pages (alerts, admins, coupons, dashboard, enrichment, layout, login, orders, pricing, products, promotions, referrals, risk, risk-event, security, settings, system, tickets, topups, users, whatsapp) + shared chrome (`layout.tsx` nav/search palette/drawer, `components/ui/app-dialog|alert-dialog|sonner|status-badge|fetch-error-card|load-more-button`, `components/admin/{TableSkeleton,EmptyState}`, `hooks/use-confirm|use-toast`) + the a11y wiring in `App.tsx` admin routes (skip link, `<main>`, RouteAnnouncer, admin route table).
- **Method**: static read-only code audit against WCAG 2.1 AA at HEAD `09857fc`. Every color claim computed with WCAG relative-luminance math (HSL→RGB→linear, alpha composited over the actual surface) — the R124-A3 method; inputs and results quoted inline. Radix behaviors verified from the wrapper code + the R124-A5 dist analysis. Rubric: `skills/impeccable-repo` craft-floor/audit. Predecessors: `docs/inspection-r124/A5-accessibility.md` (storefront rubric) + `A6-admin.md` §B #3 (labels) and #10 (toggle-state exposure).
- **Theme note**: dark is the admin default; a **light theme toggle ships in the admin top bar** (layout.tsx:1163-1171), so light-theme failures are reachable, not hypothetical.

## Verdict

The console's interaction layer is genuinely strong — the R124 fixes all held (verified in §A), dialogs ride Radix end-to-end, keyboard contracts exist for menus/expansions/inline editors, and RTL icon mirroring follows one documented decision. The gaps are (1) **one systematic WCAG-A-level miss: admin never sets `document.title`**, so the existing RouteAnnouncer is silent on every admin navigation; (2) **a light-theme contrast family**: ~9 raw Tailwind `-400` hue sites pass on dark and collapse to 1.4–2.9:1 on the shipped light theme; (3) **silent loading/error/empty transitions** — `TableSkeleton` and the shared `FetchErrorCard` carry no `role="status"`/`role="alert"` (storefront skeletons have both); (4) three incomplete sweeps (aria-pressed missed 6 chip bars, the storefront `text-primary` sweep never reached admin, hover-only row actions on alerts are invisible to keyboard focus).

**0 P0 · 3 P1 · 9 P2 · 9 P3.**

---

## A. Verified-HELD (R124 fixes and prior patterns, re-checked at 09857fc)

| # | Item | Evidence (file:line) |
|---|---|---|
| 1 | **A6 #10 toggle-state exposure — fixed & held on 6 surfaces**: row selectors (topups + products), filter chip bars (orders/topups/users/tickets/products), settings tab bar | topups.tsx:1210, products.tsx:301/1443, orders.tsx:257/418/1356/1388/1532, topups.tsx:1088, users.tsx:834/865, tickets.tsx:389/410, coupons.tsx:693; settings.tsx:1053 `role="tablist"` + :1062 `role="tab"` + :1064 `aria-selected` + tabpanels `aria-labelledby` (:1085/1092/1177/1384/1420) |
| 2 | **A6 #3 label association — held & extended**: products 13 fields, promotions 3, pricing 8 (config 3 + calculator 4 + coupon 1) now carry real `htmlFor↔id` pairs; r103 pages still clean | products.tsx:1132–1368 (`product-editor-*` + `is_active`), promotions.tsx:328–367, pricing.tsx:656–1029; coupons 400–525, admins 401–555, settings 738–849, topups 222, security 271–289, users 1116–1152, login 194–242, enrichment 364 — 47 `htmlFor` pairs across 11 files, zero bare `<Label>` facing an input found |
| 3 | **A6 #1 success-toast severity — held** on the money actions | topups.tsx:549 (single approve), :592 (single reject), :788/:869 (bulk), admins.tsx:383, referrals.tsx:380, whatsapp/pricing/tickets sites — plus destructive on all error paths |
| 4 | **A6 #2 status vocabulary — held**: filter tabs + bulk labels derive from `statusLabel` | orders.tsx:79–94 (BULK_STATUSES + STATUS_FILTERS), topups tabs + layout.tsx:261-266 context CTA «قيد الانتظار فقط» |
| 5 | **A6 #8 CopyButton dedupe + #14a topups search — held** | topups.tsx:10 (shared import), topups.tsx:989–1005 search + honest count :957–961 |
| 6 | **Sonner Arabic labels reach admin** (single root Toaster, mounted outside the auth gate) | sonner.tsx:85 `containerAriaLabel="الإشعارات"`, :94 `closeButtonAriaLabel="إغلاق"`; App.tsx:991-997 mounts for all routes; `dir="rtl"` sonner.tsx:78 |
| 7 | **Dialog system**: AppDialog = Radix trap + Esc + scroll-lock + focus return + explicit `aria-modal` (app-dialog.tsx:127) + guarded `dismissable` while mutating (:77-82) + 44px Arabic close (:175-184); DialogShell (admins.tsx:614-635) rides it; `useConfirm` restores invoker focus (use-confirm.tsx:110-118) | No `onOpenAutoFocus` overrides found (grep: zero) — Radix defaults intact |
| 8 | **Orders bulk-status menu — full keyboard contract** | orders.tsx:1249-1315 `role="menu"`/`menuitem`, Esc closes + returns focus to trigger, ↑/↓ wrap, first item focused |
| 9 | **Row interaction semantics** | orders row expand: `aria-expanded` + state-aware `aria-label` (orders.tsx:323, :459); MaskedCredential eye toggle `aria-label`+`aria-pressed` (orders.tsx:180-186); mobile cards are real `<button>` (F3-02); admins ScopeCheckboxGrid `role="checkbox"`+`aria-checked` (admins.tsx:665-667); settings provider toggles `aria-pressed`+`aria-label` (settings.tsx:235) |
| 10 | **Products editor keyboard**: ⌘S save / Esc close wired globally + printed in the form header (discoverable) | products.tsx:733-742 handler; :1092-1102 `<kbd>⌘S</kbd> للحفظ · <kbd>Esc</kbd> للإغلاق`; reject dialog ⌘↵ hint topups.tsx:250-257 |
| 11 | **RTL icon mirroring — one documented decision** ("forward points left, back points right") | dashboard.tsx:593 comment + ArrowUpLeft; risk-event.tsx:128/151 ArrowRight back-links; tickets.tsx:695 `Send` `-scale-x-100` (B5-17), :556 ChevronLeft rotate-180; layout.tsx:974 ChevronRight toward the right-edge sidebar; system.tsx:1527 «عرض الكل» ChevronLeft |
| 12 | **RTL/LTR islands**: 42 `dir="ltr"` isolations on phones/amounts/codes/dates/config values (pricing money cells 859–1281, orders order_code :183, MaskedCredential :180, login :204/:252, whatsapp phone+session ids) + `dir="rtl"` on Arabic textareas (topups:233/355, tickets:681, products:1351, enrichment:373) | Physical-vs-logical: all 38 physical `ml-/mr-/pr-/border-r` usages hand-verified **correct for the fixed-RTL app** (e.g. `pr-9` pairs the `right-3` icon at the RTL start edge; layout.tsx:206 indent on the start side); zero wrong-side instances; newer code uses logical (`ms-auto` orders.tsx:475, dashboard:670, users:1216, alerts:566) — see B-14 for the standardization note |
| 13 | **`<table>` semantics** on tabular pages | users.tsx:1264-1318, orders.tsx:1518-1580, risk.tsx:290-315 — real `<table>`/`<thead>`/`th scope="col"` (96-F7); overflow handled (`overflow-x-auto` + risk `min-w-[720px]`); pricing.tsx:846-853 `<th>` without `scope` (cosmetic — see B-15 batch) |
| 14 | **Login form (a11y exemplar)**: `htmlFor` + `autoComplete="username"/"current-password"/"one-time-code"` + `aria-describedby`→`role="alert"` error + `dir="ltr"` + single `<h1>` | login.tsx:181-264 |
| 15 | **Error taxonomy ≠ empty** (A6 #A-table): stale-refresh banners `role="alert"` on 9 pages; full-page failures → FetchErrorCard + retry | users.tsx:1206, orders.tsx:1424, topups.tsx:1125, products.tsx:1485, coupons.tsx:548, referrals.tsx:538, security.tsx:213, tickets.tsx:431, alerts.tsx:562 (+ settings/pricing/system inline alerts) |
| 16 | **Autocomplete correctness** beyond login: `new-password` (admins.tsx:440, settings.tsx:834/858), `current-password` (settings.tsx:776/818), `one-time-code` (settings.tsx:476) | whatsapp phone has `inputMode="tel"` (whatsapp.tsx:444) but no `autoComplete="tel"` — B-11 |
| 17 | **StatusBadge contrast tokens hold in BOTH themes** (computed, /12 tint over card): dark success 7.70 / warning 7.72 / error 4.63 / info 4.98 / purple 4.79; light 4.98 / 5.09 / 5.23 / 5.43 / 6.86 | index.css:155-168 (dark), :319-324 (light); status-badge.tsx:31-42 — every value reproduces the R124-A3/R116-S1 documented fixes |
| 18 | **Focus visibility**: global `:focus-visible` 2px `--ring` outline (index.css:1098 block for motion; ring token 348 80% 48%) — ring vs dark card **3.76:1**, vs base **3.96:1** ≥ 3:1 non-text floor (1.4.11); light 5.30:1; Button adds `focus-visible:ring-2` (button.tsx:15) | Computed |
| 19 | **Reduced motion**: global kill-switch completes entrance animations + pins infinite loops (index.css:1098-1109) — covers `badge-pulse`, `skeleton-shimmer`, `animate-spin` (final frame visible, loader stays readable) | index.css:629-634 shimmer |
| 20 | **Mobile-responsiveness of the ops console is real** (zoom/reflow verdict): mobile drawer (layout.tsx:1068-1083), card variants for orders/users/risk lists (`md:hidden` + `hidden md:` pairs), `flex-wrap` toolbars (topups:927 comment for 375px), tables scroll inside `overflow-x-auto` cards; QR `<img>` has descriptive alt (whatsapp.tsx:499); realistic policy: desktop-first ops console, usable at 320px for read/approve flows | Verified per page |

---

## B. Findings

### B-1. [P1] Admin never sets `document.title` — every admin navigation is silent to screen readers; the document title is the storefront's
- **Evidence**: grep for `useSeo|MetaTags|document.title` across `pages/admin/*.tsx` → **zero matches**. The default MetaTags fallback (App.tsx:778-784) stamps «SubNation — سوق الاشتراكات الرقمية» on every `/admin/*` route. `RouteAnnouncer` (App.tsx:685-739) announces **only title changes**, and announces nothing when the title doesn't change (:716 `if (!title || title === titleAtNavStart) return;`) — so every admin→admin navigation is a silent URL swap for SR users. The per-page title data already exists (`PAGE_TITLES` derived from NAV_SECTIONS, layout.tsx:226-235) — nothing feeds the document.
- **WCAG**: 2.4.2 Page Titled (A, SPA reading); 4.1.3 adjacent (no status message on navigation). The repo's own bar (F3-07 built the announcer for exactly this) makes this a compliance gap, not a nice-to-have.
- **Fix sketch**: in `AdminLayout`, `useEffect(() => { document.title = \`${pageTitle} — SubNation الإدارة\`; }, [pageTitle])` (or a `useAdminPageTitle` hook; restore the storefront default on unmount). The RouteAnnouncer then works unchanged. **Effort**: S.

### B-2. [P1] Alerts inbox row actions are invisible while focused — hover-only opacity with no focus reveal
- **Evidence**: alerts.tsx:682 `className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"` — the mark-read + delete buttons (each correctly `aria-label`ed, :691/:703) are `opacity-0` on ≥sm until *hover*. Keyboard Tab reaches them (they stay focusable) but neither the button nor the global `:focus-visible` outline is visible through `opacity:0`. Touch is handled (`opacity-100` below sm); keyboard desktop is the miss.
- **WCAG**: 2.4.7 Focus Visible (AA).
- **Fix sketch**: add `sm:group-focus-within:opacity-100` on the container and/or `focus-visible:opacity-100` on the buttons. **Effort**: S (one class pair).

### B-3. [P1] Topups bulk-approve button: emerald label on the pink primary gradient ≈ **2.57:1** — a missing `variant="outline"` on the money action
- **Evidence**: topups.tsx:1013-1021 `<Button size="sm" className="h-9 gap-1.5 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/10 text-xs">` — **no `variant`** → the default variant's `bg-gradient-to-b from-primary to-primary/95` (button.tsx:21-22) stays under the emerald text. Computed: `#34d399` on `hsl(348 80% 48%)` = **2.57:1** (both themes — the gradient is theme-fixed). The sibling reject button correctly passes `variant="outline"` (red-400 on card = 6.73:1 dark / fails light only, see B-4).
- **WCAG**: 1.4.3 Contrast (Minimum) — AA fail on the highest-stakes bulk money control.
- **Fix sketch**: `variant="outline"` (matches the reject sibling + the single-row approve/reject pair), or a solid `--status-success` surface. **Effort**: S (one prop).

### B-4. [P2] Light theme collapses every raw `-400` hue site to 1.4–2.9:1 — the admin light mode is a sub-AA surface family
- **Evidence** (all computed, alpha-composited over `--surface-card`; dark values in parentheses):
  - TrendBadge `text-emerald-400`/`text-red-400` (dashboard.tsx:212-213): light **1.92:1 / 2.77:1** (dark 9.68 / 6.73 — passes).
  - Topups pending pill `bg-yellow-400/15 text-yellow-400` (topups.tsx:937) and pending-total text (topups.tsx:972), dashboard urgent banner + CTA (dashboard.tsx:545-556): light **1.43–1.53:1** (dark 8.79–12.15).
  - Users loyalty-tier pills cyan-400 / yellow-400 / slate-300 / amber-600 on /10 (users.tsx:217-230): light **1.43 / 1.46 / 1.43 / 2.86:1** (dark 5.22–10.21).
  - Orders bulk-status menu labels (orders.tsx:86-93 `text-emerald-400/text-yellow-400/text-red-400/text-blue-400` consumed at :1307): light **1.53–2.77:1** (dark 6.73–12.15).
  - Settings scope-gate banner `text-amber-500 bg-amber-500/10` (settings.tsx:1078): light **1.99:1** (dark 7.43).
- **Why it matters**: the light theme is one toggle away for every operator (layout.tsx:1163-1171). The `--status-*` token family already solved this exact problem for badges in both themes (§A-17) — these ~9 sites predate/escaped that discipline.
- **WCAG**: 1.4.3 (AA, normal text — all these are ≤14px bold/`text-xs`/`text-3xs`).
- **Fix sketch**: swap to `--status-*` ink+tint pairs (the status-badge idiom: `text-status-success` = 8.79:1 light on /12) or `dark:*`/`light:*` variant pairs; the menu dots can keep raw hues (decorative). **Effort**: M (~9 sites, mechanical).

### B-5. [P2] Topups single-row approve button: white on emerald-600 = **3.77:1** (bold 14px — not large text)
- **Evidence**: topups.tsx:1310 `bg-emerald-600 ... text-white font-bold` («موافقة», `size="sm"` text-xs). Computed `#fff` on `#059669` = **3.77:1** < 4.5:1 — both themes (fixed color). Its reject sibling is red-400-on-card (dark 6.73, light fail per B-4).
- **WCAG**: 1.4.3.
- **Fix sketch**: `emerald-700` (`#047857` = **5.48:1**) or a `--status-success` surface token. **Effort**: S.

### B-6. [P2] The storefront `text-primary` sweep (R124-A5 #1) never reached admin — ~25 raw `text-primary` text sites sit at **3.76:1** on dark, including money values
- **Evidence** (raw `--primary` on dark card = **3.76:1**; on its own /10–/15 tints **3.43–3.56:1**; light theme passes at 5.30 — dark-only failure, and dark is the default):
  - **Money values**: orders amount cells (orders.tsx:289 desktop, :436 mobile), orders «إيرادات اليوم» tile (:1118), users wallet-balance cells (users.tsx:209, :271), dashboard revenue-in-recent-orders (:1080).
  - Active filter chips on `bg-primary/10` (3.56:1): users tier + sort chips (users.tsx:794/837/868), tickets active tab (tickets.tsx:413), risk default chip (risk.tsx:245).
  - Empty-state recovery links `text-xs text-primary hover:underline` (orders.tsx:1484/1505, users.tsx:1252, topups.tsx:1177, coupons.tsx:569, risk.tsx:350) and settings 2FA CTA (settings.tsx:507, on /10 tint).
  - Mono code/token values: system.tsx:933/:1077, promotions.tsx:398/:512, settings.tsx:1352-1363, coupons.tsx:612.
  - Hover drops further (`hover:text-primary` on muted links: layout.tsx:209 context actions, system.tsx:1525, dashboard.tsx:999, settings.tsx:351).
  - The repo already settled this: `text-primary-text` (348 80% 65%) = **5.75:1** on dark card, **5.18:1** on the /10 tint, and button.tsx:35-37 documents raw `text-primary` as surface-only.
- **WCAG**: 1.4.3 (dark theme).
- **Fix sketch**: the same one-class sweep R124-I3 did for storefront: `text-primary` → `text-primary-text` on text sites (icons on `text-primary` are fine — 3.76 ≥ 3:1 non-text). **Effort**: M (~25 sites, mechanical, grep-driven).

### B-7. [P2] No skip-to-content link in admin — 18 nav links + search + logout before content on every page
- **Evidence**: App.tsx:788 — the V2-H1 skip link renders only `{!isAdmin && !isChromeless}`. The admin sidebar repeats on every route (NAV_SECTIONS = 18 items, layout.tsx:69-139) plus footer search + logout; `<main id="main-content" tabIndex={-1}>` (App.tsx:820-823) is focused on navigation, but the initial tab walk still crosses the whole sidebar. Storefront got the link; admin was excluded.
- **WCAG**: 2.4.1 Bypass Blocks (A).
- **Fix sketch**: drop the `!isAdmin` guard (target `#main-content` exists under admin too). **Effort**: S (one condition).

### B-8. [P2] Loading, full-page-error, and empty transitions are silent to screen readers — `TableSkeleton`, page skeletons, `FetchErrorCard`, `EmptyState` carry no live-region semantics
- **Evidence**: A6 #5 was fixed visually (security.tsx:190 gained `role="status"`) but the SR half is open everywhere:
  - `TableSkeleton.tsx:24-48` — pure shimmer divs, no `role="status"`/`aria-live`/sr-only label (storefront skeletons have exactly this: R124-A5 §6).
  - Page-shaped skeletons likewise: topups.tsx:121-129, tickets.tsx:447, dashboard.tsx:568/766/953/1011-1016, products.tsx:1504, alerts.tsx:579, system.tsx:729/960/1534, enrichment.
  - Spinner-only/`role`-less text: admins.tsx:181-185 (spinner + «جارٍ التحميل…», no status role), whatsapp.tsx:361-364 (spinner only — not even text).
  - `fetch-error-card.tsx` — the shared full-page failure card (consumed by 8+ admin pages) has **no `role="alert"`**; only the hand-rolled stale-refresh banners do (§A-15). When a list load fails, SR users hear nothing.
  - `EmptyState.tsx:38-51` — no `role="status"`; the loading→empty swap is unannounced.
- **WCAG**: 4.1.3 Status Messages (AA) for load/error/empty result changes.
- **Fix sketch**: `role="status"` + sr-only «جارٍ التحميل…» inside `TableSkeleton` and the ~7 page-shaped skeletons; `role="alert"` on FetchErrorCard's outer card (or a sr-only alert line); `role="status"` on EmptyState. One shared fix nets most pages (A6 #6's extraction pays off here). **Effort**: S/M.

### B-9. [P2] GlobalSearch palette: `aria-modal` claimed but not enforced — no focus trap, no focus return, non-option listbox children, unannounced result changes
- **Evidence** (layout.tsx:447-645):
  - The overlay is `role="dialog" aria-modal="true"` (:449-451) but a plain div — **Tab walks out of the palette into the page behind**; browse-mode SR users can read the "modal" background.
  - On close (Esc :317-323, backdrop :453, Enter-navigate) focus is **not returned** to the trigger — the focused input unmounts and focus falls to `<body>`, dropping keyboard users to the top of the tab order (the exact class A4-F3 fixed for `useConfirm`).
  - Inside `role="listbox"` (:485), each section is a bare `<div className="p-2">` wrapper + a header div (:497-498) — APG allows only `option`/`group` children; `role="group" aria-label` on the section wrappers is the one-attribute fix.
  - «لا نتائج لـ "…"» (:486-494) and result-count changes are not announced (no `aria-live`) — a SR user typing gets silence until they arrow.
  - Positive: initial focus ✓ (:292-294), Esc ✓, real combobox semantics (`role="combobox"` `aria-expanded` `aria-controls` `aria-activedescendant` :472-475), ↑/↓/↵ work and are honestly hinted in the footer (:625-641).
- **WCAG**: 2.1.2 / 2.4.3 (trap+return), 4.1.2 (listbox structure), 4.1.3 (result status).
- **Fix sketch**: mount the palette inside Radix `Dialog.Root`/`Content` (keeps the custom chrome — trap, Esc, focus return free), `role="group"` on section wrappers, `aria-live="polite"` sr-only result-count line. **Effort**: M.

### B-10. [P2] The aria-pressed sweep (A6 #10) is incomplete — 6 more chip bars + topups select-all expose state visually only
- **Evidence**: alerts type chips (alerts.tsx:497-514) and filter tabs (:518-545); referrals status chips (referrals.tsx:517-527); risk severity chips (risk.tsx:239-252); dashboard granularity picker (dashboard.tsx:718-728) and period picker (:731-743); topups «اختيار الكل» (topups.tsx:1034-1046 — contrast: orders' select-all has it, orders.tsx:1532).
- **WCAG**: 4.1.2 Name, Role, Value.
- **Fix sketch**: `aria-pressed={active}` on each (the in-repo idiom now regression-tested); the two dashboard pickers additionally deserve `role="group" aria-label` (unlabeled button groups otherwise). **Effort**: S.

### B-11. [P2] Top-bar hamburger and sidebar-collapse controls: icon-only with no accessible name; hamburger also hides its expanded state
- **Evidence**: layout.tsx:1089-1102 — the mobile-drawer toggle (Menu/X icon swap) has **no `aria-label` and no `aria-expanded`/`aria-controls** (the storefront Navbar's hamburger has both, per R124-A5 #4). layout.tsx:970-977 — the sidebar collapse chevron is icon-only, no `aria-label`/`aria-expanded`/`aria-controls`.
- **WCAG**: 4.1.2.
- **Fix sketch**: `aria-label="فتح قائمة الإدارة"` + `aria-expanded={mobileOpen}` + `aria-controls` on the hamburger; `aria-label="تصغير القائمة الجانبية"` + `aria-expanded` on the collapse toggle. **Effort**: S.

### B-12. [P2] Admin nav lacks `aria-current="page"` (active item is visual-only) — desktop sidebar and mobile drawer
- **Evidence**: layout.tsx:166-203 — `NavItem` marks active with `bg-primary/15 text-primary` + border only; no `aria-current`. The storefront MobileNav has it (`aria-current={active ? "page" : undefined}`, A5 #3's fixed counterpart); admin's own longest-prefix logic (:245-249) already computes `active`.
- **WCAG**: 1.3.1 (2.4.8 Location at AAA).
- **Fix sketch**: `aria-current={active ? "page" : undefined}` on the `<Link>`. **Effort**: S.

### B-13. [P3] Search inputs and a few form fields are placeholder-only (no programmatic label)
- **Evidence**: orders.tsx:1046 (`id="orders-search"` exists but nothing references it), users.tsx:774, topups.tsx:989, products.tsx:1420, referrals.tsx:510 — all `placeholder="بحث…"` + decorative icon, no `aria-label`; tickets reply box (tickets.tsx:675, placeholder «اكتب ردك هنا…»); whatsapp session-name (whatsapp.tsx:328) and pair-phone (:443 — also missing `autoComplete="tel"` despite `inputMode="tel"`); risk-event notes textarea (risk-event.tsx:247 — its section title is not associated); users wallet **amount** field (users.tsx:1089 — the mode toggle above is labeled, the amount itself is placeholder-only; a money field).
- **WCAG**: 3.3.2 Labels or Instructions / 4.1.2 (placeholder is not a persistent label).
- **Fix sketch**: `aria-label` per input (`بحث في الطلبات…` etc.) or visible sr-only `<Label>`; `autoComplete="tel"` on whatsapp phone. **Effort**: S (10 fields).

### B-14. [P3] Physical CSS utilities in a fixed-RTL app: 38 sites, zero logical-property usage in `pages/admin`
- **Evidence**: 38 `ml-|mr-|pl-|pr-|border-l-|border-r` matches across 13 admin files vs **0** `ms-|me-|ps-|pe-` (newer code already uses logical: `ms-auto` orders.tsx:475, dashboard.tsx:670, users.tsx:1216, alerts.tsx:566). All 38 hand-verified **correct for RTL today** (search `pr-9` pairs the `right-3` icon at the start edge; `ml-1` gaps icon→label in RTL flow; layout.tsx:206 start-side indent; coupons.tsx:641 `mr-1` verified correct) — but each is correct only by inspection, and the split idiom invites a future wrong-side copy (the exact drift class this round's console-consistency work kills).
- **Fix sketch**: mechanical sweep `ml→ms, mr→me, pl→ps, pr→pe, border-l→border-s, border-r→border-e` (behavior identical in a dir=rtl-only app; unlocks LTR previews for free). **Effort**: M (mechanical, low risk).

### B-15. [P3] Batch of small semantic/polish items
- **Double `<h1>` per page**: layout top-bar h1 (layout.tsx:1104) + every page's own h1 (18 pages; dashboard/whatsapp correctly rely on the top-bar one) — two identical-text h1s per page (A5 #8 precedent). Fix: demote the top-bar h1 to a `<div>` (page h1 stays the landmark heading). S.
- **pricing.tsx:846-853**: `<th>` without `scope="col"` (the 96-F7 pass covered orders/users/risk, missed this table). S.
- **Charts**: recharts `<ResponsiveContainer>` SVGs (dashboard.tsx:759+, sparklines :186-197) have no `role="img"`/`aria-label` and no `aria-hidden`; SR traversal of the chart column is silent. The KPI tiles + CSV export (dashboard.tsx:745-750 — `title`-only accessible name) keep the data available as text, so this is honest-gap rather than data loss; fix = `role="img"` + Arabic `aria-label` («مخطط الإيرادات والطلبات — آخر 7 أيام») or `aria-hidden` + sr-only summary; give the export button a real `aria-label`. S.
- **TrendBadge SR output**: «42%» with a shape-only icon — no direction word for SR (dashboard.tsx:211-216). Fix: sr-only «ارتفاع»/«انخفاض» or `aria-label`. S.
- **Form error association**: field errors are `role="alert"` (announced ✓ — 3.3.1's intent met) but not anchored: no `aria-invalid`/`aria-describedby` on pricing config inputs (pricing.tsx:669-724), coupons (coupons.tsx:469), users wallet. Storefront wallet (wallet.tsx:1583-1613) is the model. M (mechanical).
- **Mobile drawer focus**: role=dialog + Esc ✓ (layout.tsx:1074-1081, :853-860) but no focus move-in/trap/return — same class as A5 #4/#5 (one shared drawer component would close both). M.
- **Alerts read-rows**: `opacity-60` container (alerts.tsx:634) dims the muted message text to ≈**3.6:1** on dark (title ≈6.94:1, computed); unread state per row is color-only (pulse dot + tint) — the mark-read button's presence partially signals it, but a sr-only «غير مقروء» (or aria-label suffix) makes it explicit. S.
- **Settings tabs**: Tab-through works with correct `tablist` roles; APG's arrow-key roving tabindex is absent (settings.tsx:1053-1075). Optional enhancement. S.
- **Last-updated pill color-only below sm** (layout.tsx:1149-1157 `hidden sm:inline`): the emerald/amber/gray dot is the sole state signal on narrow windows. S.

---

## C. Priority counts

**P0: 0 · P1: 3 (B-1, B-2, B-3) · P2: 9 (B-4 … B-12) · P3: 9 (B-13, B-14, B-15 counted as 7 sub-items in one batch)**

All color claims computed (WCAG relative luminance, alpha composited over the real surface): raw `--primary` on dark card 3.76:1 / on /10 tint 3.56:1 / `--primary-text` 5.75:1 (5.18 on tint); emerald-400 on dark card 9.68 / light card 1.92; red-400 6.73 / 2.77; yellow-400 12.15 / 1.53 (8.79 on its /15 tint over dark, 1.43 over light); white on emerald-600 3.77 / on emerald-700 5.48; emerald-400 on primary gradient 2.57; StatusBadge tokens dark 4.63–7.72 / light 4.98–10.57; focus ring 3.76–3.96 vs dark surfaces (≥3:1 non-text ✓) / 5.30 light; nav badges black-on-yellow-400 13.71:1; alerts read-row message ≈3.6:1.

## D. Suggested fix order

1. **B-3 + B-5** (two money-button contrast fixes — one prop + one class; the console's most-pressed control) — S.
2. **B-2** (`group-focus-within:opacity-100` on alerts actions — restores visible focus) — S.
3. **B-1** (per-route `document.title` in AdminLayout — unlocks the existing RouteAnnouncer for every admin navigation) — S.
4. **B-7 + B-11 + B-12** (skip link condition, hamburger/collapse names + expanded, nav `aria-current`) — one "admin chrome semantics" commit, S.
5. **B-10** (aria-pressed on the 6 remaining chip bars + topups select-all) — S.
6. **B-6 + B-4** (the two contrast sweeps: `text-primary`→`text-primary-text` on dark; raw `-400` hues → `--status-*` pairs for light) — M each, grep-driven, ideally one lane.
7. **B-8** (live-region semantics in TableSkeleton/EmptyState/FetchErrorCard + the page-shaped skeletons + admins/whatsapp loaders) — S/M, highest SR leverage per line.
8. **B-9** (palette on Radix Dialog + focus return + listbox groups + live result count) — M.
9. **B-13 → B-15 → B-14** (labels batch, semantic batch, logical-property sweep) — polish passes.

*Read-only audit: no source files modified, no builds/tests run. Only this report file was created.*
