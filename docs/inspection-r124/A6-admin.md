# R124-A6 — Admin Console UX / Consistency / Performance Audit

**Scope:** `frontend/src/pages/admin/` — 14 target pages (layout, dashboard, products, orders, topups, users, coupons, promotions, pricing, referrals, tickets, security, settings, admins, whatsapp) + all of `frontend/src/components/admin/*` (TableSkeleton, EmptyState, InventoryUploadDialog, ProductVariantsDialog, StockoutRiskPanel, copilot/*) + the shared primitives they ride (`components/ui/alert-dialog|app-dialog|status-badge`, `hooks/use-confirm|use-toast|use-dirty-guard`).
`wallet.tsx` **does not exist** in admin (wallet surfaces live in `users.tsx` edit dialog + storefront); `users.tsx` exists and is covered. Static code analysis only at main @ c736d13 — production was NOT touched.

**Method:** full read of all 14 pages (~19k lines total incl. tests dir excluded), shared components, and the layout; cross-cutting greps to quantify every divergence claim (counts cited inline). Verified against the repo's own regression tests (`no-native-confirm.test.ts`, `admin-layout-nav-scope.test.tsx`, `orders-false-empty-pagination.test.tsx`…).

---

## A. What is genuinely CONSISTENT (verified — the baseline is strong)

| Dimension | Verdict | Evidence |
|---|---|---|
| Confirm pattern | **Uniform.** 100% of destructive/money confirmations ride `useConfirm()` → Radix AlertDialog (44px targets, focus return, destructive variant). Zero live `window.confirm` (all remaining mentions are history comments; pinned by `__tests__/no-native-confirm.test.ts`) | orders.tsx:591, topups.tsx:443, products.tsx:296, coupons.tsx:113, referrals.tsx:127, promotions.tsx:76, admins.tsx:56, whatsapp.tsx:89, alerts.tsx:192 |
| Money-action safety | Every state-changing money call carries an `Idempotency-Key` (per-click or per-intent — users.tsx:212-227 keeps one key across retries, the strongest form); approve/refund/credit/archive all confirm first with the amount in the dialog | topups.tsx:541-614/716-725, orders.tsx:756-789, users.tsx:469-509, referrals.tsx:236-246 |
| Error ≠ empty | Every list page distinguishes failed-load (error card + retry) / stale-refresh-failure (inline banner over kept rows) / true empty. No outage masquerades as an empty queue anywhere | orders.tsx:1396-1436, topups.tsx:1061-1103, users.tsx:1061-1100, products.tsx:1147-1191, tickets.tsx:422-463, referrals.tsx:414-453, coupons.tsx:544-559, admins.tsx:181-197, security.tsx:211-229/311-329 |
| Honest counts | «إجمالاً» only when a single short page proves the total; «عرض N (الأحدث أولاً)» otherwise; capped windows say so (products/coupons) | orders.tsx:997-1005, topups.tsx:932-941, users.tsx:626-633, tickets.tsx:366-375, products.tsx:717-723, coupons.tsx:336-346 |
| RBAC honesty | Nav items, search palette sections, quick CTAs, bulk-refund option, wallet fields, pricing tab — all scope-gated up-front with the honest reason instead of offered-then-403'd | layout.tsx:60-125/296-308, orders.tsx:938-943, users.tsx:558-564/919-923, referrals.tsx:281-291, settings.tsx:88-95 |
| Status pills/labels for rows | One source: `STATUS_TONE` + `statusLabel` (unknown → neutral fallback) | status-badge.tsx:100-132, utils.ts:159-186 |
| Search inputs | All 4 search-box pages debounce 300 ms and abort the in-flight request (query-key AbortSignal or controller) | orders.tsx:871-878, users.tsx:257-260, products.tsx:330-335, referrals.tsx:208-221, layout.tsx (GlobalSearch) 318-384 |
| Double-submit guards | Present on every mutating button (`disabled={saving\|creating\|bulkProcessing\|busy}`) + approveAll re-click guard | all 14 pages; topups.tsx:798-799 |
| Dirty guards | All long forms (product editor, coupon, promotion, wallet edit, admin dialogs, ticket reply, pricing config) arm `useDirtyGuard` | products.tsx:346-347, coupons.tsx:138, promotions.tsx:97, users.tsx:250-253, admins.tsx:349-354/504-509, tickets.tsx:140, pricing.tsx (configDirty) |
| Route loading | All 20 admin routes are `lazyWithRetry` code-split (recharts rides its own vendor chunk; entry 27 KB gz) | App.tsx:60-79 |
| Session-expiry UX | One global 401 handler (toast + redirect); no page layers a misleading retry toast on top | admin-session.ts + per-page `AdminSessionExpiredError` guards throughout |

The divergences below are therefore **polish-level**, not systemic: the console is unusually disciplined for its size.

---

## B. Findings

### 1. [P2] Success toasts render in two different colors — including the single topup approve/reject (money actions)
**Evidence:** `use-toast.ts:40` supports `variant:"success"` (green). ~13 call sites pass it (topups bulk 776/857, whatsapp 134/237, pricing 375/410, tickets 329, products stock 175…), but ~18 success toasts omit it and render **default blue**, e.g.:
- `topups.tsx:559-564` «تمت الموافقة» and `:600-603` «تم الرفض» — the single highest-stakes money actions — while the *bulk* equivalents at :776/:857 are green. Same action, different color, same page.
- `users.tsx:534` wallet save (money), `products.tsx:392/412/428`, `coupons.tsx:233/295`, `admins.tsx:146/383/536`, `promotions.tsx:179/231/256`, `referrals.tsx:261-264`, `settings.tsx:589/649`.
Also the only emoji-bearing toast in admin lives here: `promotions.tsx:179` «تم إنشاء العرض ✅».
**Fix:** add `variant:"success"` to the ~18 sites (or a `toastSuccess(title, description?)` helper next to the existing helpers in use-toast.ts). Effort **S**.

### 2. [P2] Filter-tab vocabulary contradicts the row badges on the same page (violates the codebase's own status-unification invariant)
**Evidence:** `lib/utils.ts:161-168` is the canonical map (pending=«قيد الانتظار», refunded=«مُسترد», failed=«فشل», approved=«موافق عليه»). Row badges derive from it — but the filter tabs hand-roll different words:
- `orders.tsx:79-85` STATUS_FILTERS: «معلق» / «فاشل» / «مسترجع» → the orders page shows a tab «معلق» whose rows all read «قيد الانتظار», a tab «مسترجع» whose rows read «مُسترد» (the R111-F2 unification missed this list), a tab «فاشل» vs rows «فشل».
- `orders.tsx:72-77` BULK_STATUSES uses a **third** mix in the same file («قيد الانتظار», «مسترجع»).
- `topups.tsx:79-84`: tab «معلق»/«مقبول» vs badges «قيد الانتظار»/«موافق عليه».
- `dashboard.tsx:417` tile «طلبات الشحن المعلقة» (معلق family) — same drift.
tickets.tsx:63-66 already does it right (derives tab labels from `statusLabel`), proving the intended pattern; status-badge.tsx:64-70 documents the exact invariant ("a status can never show two different Arabic words on two pages") — here it shows two words on one page.
**Fix:** derive orders/topups filter labels (and BULK_STATUSES labels) from `statusLabel()` like tickets does. Effort **S**.

### 3. [P2] Product editor: zero programmatically-associated labels (9 fields) — the r103 label pass missed the biggest admin form
**Evidence:** `products.tsx:835-1027` — 9 `<Label>` elements without `htmlFor` facing `<Input>`/`<select>`/`<textarea>` without `id` (name, price, cost, description, image_url, category, usage_terms, seo_title, seo_description). Clicking a label focuses nothing; screen readers announce bare fields on the form used for every catalog edit. Same gap: `promotions.tsx:319-359` (3 fields) and `pricing.tsx:1028` (coupon-code field). Compare the FIXED pages from AUD103-6-F2 (r103): coupons.tsx:398-531, users.tsx:972-1006, topups.tsx:207-231, admins.tsx:400-446, settings.tsx:736-847, security.tsx:271-301 — the pass covered those six pages only.
**Fix:** add `htmlFor`/`id` pairs (mechanical, 13 fields total). Effort **S/M**.

### 4. [P2] Keystroke re-render of full lists — the R118-B2 memoization fix was applied to orders only
**Evidence:** R118-B2 (A6 F-8) memoized `orders.tsx:186-497` (module-level `React.memo` rows + `useMemo` chain + `useCallback` toggles) because a controlled search re-renders every row per keystroke. The same class is unaddressed on:
- `users.tsx` — controlled search (638-645, 300 ms debounce on the *network* only) + `sorted` recomputed inline per render (352-367, no `useMemo`) + 100+ inline `<tr>`/card closures (1188-1294): every keystroke re-sorts and re-renders the whole directory.
- `products.tsx` — controlled search (1084-1089) + 200-card inline grid (1196-1422) re-rendered per keystroke, *plus* a 60 s `refetchInterval` (369) that re-renders the full grid twice a minute.
- `referrals.tsx` — controlled search (387-392) + inline rows (472-552).
**Fix:** mirror the orders pattern (memoize the derived array; hoist rows to `React.memo`; stable callbacks). Effort **M**.

### 5. [P3] Loading-state taxonomy diverges on 3 pages
**Evidence:** 13 pages use shimmer skeletons (shared `TableSkeleton` or page-shaped cards). Divergent: `security.tsx:189-192` — bare centered text «جارٍ التحميل…» (full-page, no layout preservation); `admins.tsx:176-180` — spinner+text row; `whatsapp.tsx:353-356` — centered spinner. All three are the only list-shaped surfaces without a skeleton.
**Fix:** use `TableSkeleton` (tickets.tsx:442 shows the 3-line recipe for card lists). Effort **S**.

### 6. [P3] ~600 lines of hand-rolled, near-identical list-state JSX across 12 pages that should be 2–3 shared components
**Evidence (quantified):**
- Inline stale-refresh error banner (`role="alert"` + WifiOff + ms-auto retry link): **9 hand-rolled copies** — orders.tsx:1396-1411, users.tsx:1061-1076, topups.tsx:1061-1076, products.tsx:1147-1162, tickets.tsx:422-437, referrals.tsx:414-429, coupons.tsx:544-559, security.tsx:211-226, alerts.tsx.
- Full-page error card (icon tile + «تعذّر تحميل X» + message + retry Button): **≥12 copies** («تعذّر تحميل» appears 23× across 14 files) — e.g. orders.tsx:1416-1436, users.tsx:1081-1100, topups.tsx:1083-1103, products.tsx:1172-1191, admins.tsx:181-197, referrals.tsx:434-453, promotions.tsx:429-449.
- «تحميل المزيد» button block: **5 copies** (orders.tsx:1627-1647, topups.tsx:1267-1287, users.tsx:1300-1320, tickets.tsx:535-555, alerts.tsx:741+).
- Honest-count header logic (`knownTotal ? إجمالاً : عرض N`): **5 copies**.
- URL↔filter sync effect (validate param → setState-if-different → replaceState write-back): **4 copies** (orders.tsx:885-907, users.tsx:266-291, tickets.tsx:261-282, settings.tsx:902-1013; topups one-way variant 1026-1036).
Each copy is individually correct today; the cost is that every future tweak (e.g. adding an aria-live, changing retry wording) must land 5–12 times — the exact drift this audit documents in findings 1/2.
**Fix:** extract `<ListErrorInline message onRetry/>`, `<ListErrorCard message onRetry/>`, `<LoadMoreButton/>`, and a `useUrlFilterSync()` hook into `components/admin/`. Effort **M** (high-leverage: nets ~-600 lines and locks consistency).

### 7. [P3] Pagination contract and polling cadence diverge across pages without a documented rationale hub
**Evidence:**
- Accumulating load-more (infinite query): orders.tsx:609-629, topups.tsx:495-516, users.tsx:307-333, tickets.tsx:174-197, alerts.tsx:211-230.
- Capped, no load-more (honest wording only): products.tsx:122-133 (200-row server cap, no `page` param), coupons.tsx:336-346.
- No pagination at all: referrals (list length = whatever the endpoint returns, no cap hint), security.tsx (see #17), admins.
- `refetchInterval`: products **60 s** (products.tsx:369) vs **300 s** on orders/topups/users/dashboard/layout-badges vs alerts **20 s** (alerts.tsx:227) vs tickets **none**. Each is locally commented, but there is no single place stating the policy; the alerts inbox also polls 15× more often than its own unread-count badge (layout 300 s), so the badge can lag the inbox by minutes.
**Fix:** add a short "list contracts" table to the admin docs (or normalize: 300 s + socket for all, alerts' freshness need is already served by its socket push). Effort **M**.

### 8. [P3] topups.tsx carries a local CopyButton that duplicates the shared one
**Evidence:** `topups.tsx:365-409` re-implements the idle→copied→failed state machine that `components/CopyButton.tsx:30+` already provides with strictly better hygiene (`type="button"` form-safety, 44 px hit box, tracked reset timer, aria via label). orders.tsx:3 imports the shared one. Known-acknowledged in R116's report ("admin local CopyButton vs shared") but never converged.
**Fix:** delete the local component, import the shared one (adjust `size`). Effort **S**.

### 9. [P3] Dashboard chart period switch has no abort/race guard
**Evidence:** `dashboard.tsx:294-335` `fetchChart` is a plain `fetch` with no AbortController/sequence token; the granularity/period chips (707-722) fire a new fetch per click. A slow 7-day response landing after a fast 90-day one overwrites the chart with the wrong period (chips say 90, data says 7). The exact class was fixed in GlobalSearch (layout.tsx:324-383, abort + stale-drop) and referrals (fetchSeqRef, referrals.tsx:140-221).
**Fix:** abort on `chartDays` change (the GlobalSearch recipe). Effort **S**.

### 10. [P3] Toggle-state exposure to assistive tech is inconsistent (aria-pressed / tab semantics)
**Evidence:**
- Row selection: orders.tsx:242-243 exposes `aria-pressed` (fixed in F3-08); topups.tsx:1134 and products.tsx:1218 expose only a changing `aria-label` (no `aria-pressed`).
- Filter/tab bars: none of the chip bars carry `aria-pressed`/`aria-selected`/`role="tab"` — the active chip is purely visual: orders.tsx:1324-1350, topups.tsx:1020-1053, users.tsx:687-732/714-732, tickets.tsx:378-391, settings.tsx:1048-1060 (5 real tabs). Individual toggles elsewhere *do* it right (coupons.tsx:691 `aria-pressed`), so the pattern exists in-repo.
**Fix:** `aria-pressed` on chips/row-selectors; `role="tablist"/"tab"/"aria-selected"` (or minimally `aria-pressed`) on the settings tab bar. Effort **S**.

### 11. [P3] orders bulk mutation double-refetches
**Evidence:** `orders.tsx:841-846` — `refetch();` immediately followed by `qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() })`; the invalidate re-fetches the still-active query, so one bulk action fires two identical list requests (plus the dashboard key is separately invalidated). Every other page invalidates once (users.tsx:540, topups.tsx:525-529, products.tsx:381-382).
**Fix:** drop the explicit `refetch()`. Effort **S**.

### 12. [P3] CopilotPanel (1,676 lines + history view) is statically imported into the admin layout chunk
**Evidence:** `layout.tsx:12` static import; rendered unconditionally at layout.tsx:1183 on every admin route although it only mounts a floating launcher (`CopilotPanel.tsx:929` aria-label «فتح المساعد الذكي»). It rides the shared admin chunk every page pays for.
**Fix:** `lazyWithRetry` the panel behind the launcher (the App.tsx:60-79 recipe). Effort **S**.

### 13. [P3] Empty-state shape/CTA affordances diverge
**Evidence:** Shared `EmptyState` used by orders/topups/products/users/coupons/referrals/security/whatsapp (and deliberately not by alerts/promotions per EmptyState.tsx:34-36). Divergences: `admins.tsx:198-201` is a bare text line («لا توجد حسابات مسؤولين بعد.») — the only list page with no card at all; `tickets.tsx:465-469/716-722` hand-roll two. CTA parity: coupons offers «+ إنشاء أول كوبون» (coupons.tsx:564-571), orders/users offer «مسح الفلاتر», but products (empty catalog) offers nothing next to the header's «منتج جديد», topups/tickets/promotions offer nothing.
**Fix:** adopt EmptyState in admins (+tickets' list pane), add a primary CTA where a natural one exists. Effort **S**.

### 14. [P3] Table capability gaps: no column sorting anywhere; the money queue has no search; search-box chrome differs
**Evidence:**
- Sorting: no table exposes column-header sort; the only sort control is users' client-side panel (users.tsx:87-93, honestly labeled «ضمن المعروض», 707-713). Orders (money) cannot be sorted by amount/date at all.
- Search: orders/users/products/referrals have it; **topups — the money queue — has none** (topups.tsx header 920-1056 has no search box), so finding one topup by phone/reference means paging through load-more. security/admins/coupons/promotions also lack it (acceptable set sizes for admins/promotions; coupons has 200-row cap + no search).
- Chrome: users.tsx:639 uses `type="search"` (native ✕, `dir="ltr"`), orders.tsx:1034-1045 and products.tsx:1090-1101 hand-roll the ✕ button; referrals.tsx:387 has no ✕ at all.
**Fix:** (a) add a topups search (server `?search=` if the route supports it, else filter loaded pages + honest hint); (b) unify the search-box chrome (shared `<AdminSearchInput/>` is a natural part of #6); (c) column sort is a larger follow-up — at minimum amount/date on orders. Effort **M**.

### 15. [P3] Create/edit pattern split: modal on 4 pages, inline form on 3
**Evidence:** AppDialog for create/edit: coupons.tsx:364, users.tsx:827, admins.tsx:397/550 (DialogShell), topups reject/bulk. Inline page-top form: products.tsx:803-1060 (justified — `#new` hash deep-link + ⌘S/Esc, layout.tsx:251 CONTEXT_ACTIONS depends on it), promotions.tsx:309-412, whatsapp.tsx:311-334. Promotions has no deep-link/hash rationale — it's the unexplained outlier (a one-active-sale form, so the cost is low, but an operator moving between coupons→promotions meets two different creation idioms).
**Fix:** either document the split rule next to AppDialog ("inline = full-width editors with deep-linkable state; dialog = quick creates") or migrate promotions to AppDialog. Effort **S** (doc) / **M** (migration).

### 16. [P3] Nav information-architecture nits: «الكتالوج» group holds non-catalog entities; page titles drift from nav labels
**Evidence:** `layout.tsx:90-110` — the «الكتالوج» (Catalog) section contains المستخدمون (users), الإحالات (referrals), الكوبونات (coupons — finance-scoped, per the nav-parity comment at 102-107). None are catalog entities; the middle group is really "customers & pricing". Title drift: nav «سجل الأمان» (layout.tsx:119) vs top-bar title «الأمان» (layout.tsx:221); nav «الرئيسية» vs title «لوحة التحكم» (layout.tsx:208); nav «التنبيهات» vs title «صندوق التنبيهات» (layout.tsx:220).
**Fix:** rename the middle group (e.g. «العملاء والتسعير») and align the 3 drifted PAGE_TITLES entries (or intentionally keep nav short + title long — then document it once). Effort **S**.

### 17. [P3] security activity timeline is unpaged and unbounded with no honest count
**Evidence:** `security.tsx:108-136` fetches `/api/admin/auth-activity?filters` with no page/limit and renders everything returned (334-366); no load-more, no «عرض N», no cap hint. Whatever the backend silently truncates to is presented as the whole log (the false-total class the other 5 list pages explicitly killed).
**Fix:** honest «عرض N» header at minimum; load-more if the endpoint grows a page param. Effort **M**.

### 18. [P3] Minor copy/format nits (batch)
**Evidence:**
- `promotions.tsx:179` emoji «✅» in a toast title (only one in admin; see #1).
- `topups.tsx:1201` label «الحساب:» — fine, but the same row family uses «المُرسل:» with the shadda diacritic style while others don't («المستخدم:») — pick one diacritic policy for field labels.
- Dashboard TrendBadge uses raw `text-emerald-400/text-red-400` (dashboard.tsx:185) instead of the `--status-*` tokens that status-badge.tsx enforces everywhere else (cosmetic token discipline).
- `users.tsx:639` search `dir="ltr"` + `type="search"` vs orders/products `dir` default — phone-entry in an LTR box on users but RTL on referrals' phone search (referrals.tsx:388, no dir) — pick one for phone search fields.
**Fix:** one-liners. Effort **S**.

---

## C. Dashboard hierarchy verdict (mission §5)

Prominent-and-honest: **PASS**. First paint = urgent pending-topups banner (finance-gated, dashboard.tsx:509-529) → KPI grid with today's revenue highlighted (403-416), pending-topups urgent-styled (417-429), stock low-stock pulse (469-480), wallet balance finance-gated (481-494) → quick actions → charts + recent orders. Money tiles are server-truth (`/admin/stats`), chart payload is finance-gated at the *fetch* layer (309-313), aggregates over partial data are labeled (1194-1205), and the new-users chart honestly goes dark for non-finance operators with the residual documented (303-308). Only nit: non-finance operators lose the users *chart* along with money charts (documented backend-split residual).

## D. Priority counts

**P0: 0 · P1: 0 · P2: 4 · P3: 14** (findings 1-4; 5-18, with #18 as a 4-item batch).

## E. Suggested fix order (ponytail)

1. #1 + #2 + #18 (toast variants, status vocabulary, copy nits) — one small "console consistency" commit, S.
2. #3 (labels) — mechanical S/M.
3. #8, #11, #12, #9 (dedupe CopyButton, drop double-refetch, lazy copilot, chart abort) — four one-liners, S.
4. #5, #10, #13, #16 (skeleton parity, aria-pressed, EmptyState parity, nav labels) — S each.
5. #6 (shared list-state components) — the structural M that prevents the whole class this audit enumerates.
6. #4 (users/products/referrals memoization) — M, do before the directory grows.
7. #7, #14, #15, #17 — M-tier UX expansions (topups search first among them).
