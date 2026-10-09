# R126-A1 — Admin Money Pages Deep Audit (round 2)

**Scope:** `frontend/src/pages/admin/{dashboard,orders,topups,pricing,coupons,referrals}.tsx` (7,320 lines) at HEAD `186b131`, clean tree. Read-only static audit: every page read line-by-line in full, plus the shared surfaces they ride (`layout.tsx` badge merge/pill/refresh, `SocketInitializer.tsx` admin-room invalidations, `use-admin-headers`, `lib/idempotency`, `lib/utils` money/plural formatters, `LoadMoreButton`, `EmptyState`, `index.css` stagger/focus-visible rules), the orval key shapes (`shared/api-client-react/src/generated/api.ts:5585-5587`), backend ordering/pagination contracts (`backend/src/routes/admin/topups.ts`, `referrals.ts`), and the R125 predecessor reports (A1 money-UX, A2 catalog/pricing, A6 a11y/RTL) so nothing already fixed or already filed is re-reported as new. No tests run (no finding needed a run to be decisive); no production requests needed.

**What R125 already fixed is NOT re-reported.** Verified HELD at HEAD on these six pages: topups money-core discipline (Idempotency-Key per click at topups.tsx:887/900 and per-iteration at 959/1056 with the documented rationale, amount-bearing confirms at 873-877 / 491 / orders.tsx:791-799, 207 partial-body parsing at orders.tsx:835-853, session-expiry loop exits at topups.tsx:967-970/1067-1070, `dismissable={!loading}` on every money modal); dashboard chart abort-guard + single-fire refresh (dashboard.tsx:468-531, 549-558); orders footer «مجموع المعروض» (orders.tsx:1625-1628); aria-pressed chip sweeps (dashboard.tsx:126/148, orders.tsx:1372/1404, topups.tsx:1284/1345); «قيد الانتظار» vocabulary on topups (1170/1209/1425); topups client-side search + honest counts + partial hint (591-596, 808-828, 1188-1193, 1371-1375); A2's pricing fixes (Switch aria-label 1100, grouped `fmt` 225-238, lucide warning icon 1184, calc race seq 562-598, dead cast removed 956-958), coupons fixes («أرشفة» honest verb + per-row busy 284-319/745-761, mobile field labels 631-721), referrals fixes (200-cap hint 626-637, `*50` column deleted 515-523, mount double-fetch fixed 325-330). All re-verified at the cited lines.

**Status of R125 findings still open in this lane** (verified, listed once for the implementation lanes, not re-litigated): R125-A1 #11 copy/dead-code batch — NOT landed: orders.tsx:109 «30 يوم», orders.tsx:1382 identical-ternary, dashboard.tsx:1148 «آخر {chartDays} يوم», dashboard.tsx:590-591 collapsed `onChangeDays` branches, topups.tsx:247 «المُرسل:» damma-vs-bare drift; R125-A1 #13 topups status-tab empty CTA — NOT landed (topups.tsx:1414-1446 still offers a CTA only for `searchActive`); A2#8 referrals status vocabulary/chips (referrals.tsx:65/164-172/477/543-555/641 — «معلقة» vs «قيد الانتظار» on one page, no aria-pressed, hand-rolled raw-hue pills) — NOT landed; A6 B-15 double-h1 (layout.tsx:1293 + per-page h1 at orders.tsx:1027, topups.tsx:1161, pricing.tsx:631, coupons.tsx:334, referrals.tsx:442) — NOT landed. Everything below is **new**, beyond these.

---

## A. dashboard.tsx

### A1-1. [P3] `admin-stats-update` socket push refreshes the KPI queries but never the chart series — the money charts go stale while the tiles beside them update
**Evidence:** the admin-room handler invalidates exactly four keys — `["/api/admin/stats"]`, `["/api/admin/orders"]`, `["/api/admin/topups"]`, `["/api/admin/users"]` (SocketInitializer.tsx:82-85). The chart payload is a **raw fetch into local state** (dashboard.tsx:496-521) — invisible to react-query, so it is refetched only on mount, on `chartDays` change (526-528), and on the manual refresh button (557). The app-wide `refetchOnWindowFocus: false` (App.tsx:218) removes the focus catch-up too. Blast radius is the R125-A1 #3 deepened set: the three charts, the KPI TrendBadges (776), the Sparklines (791), and the `newUsersToday` tile sub-line (602-603).
**Why it matters:** when another operator approves topups (the backend emits `admin-stats-update` on every approve/reject — topup.service.ts:619/685) while a finance admin sits on the dashboard, «إيرادات اليوم» ticks up while the revenue chart below it still shows the pre-approval series — two money numbers on one screen disagreeing, for up to the 300s fallback (dashboard.tsx:426) or until a manual refresh.
**Fix sketch:** either move chart-data onto react-query under `["/api/admin/chart-data", days]` (the four-key handler gains a fifth prefix — or the existing invalidate list covers it via a shared prefix), or have SocketInitializer dispatch a window CustomEvent (the `ADMIN_ALERT_NEW_EVENT` idiom, layout.tsx:1074) that the dashboard effect listens for and re-runs `fetchChart(chartDays)`. **Effort S/M.**

### A1-2. [P3] R125-A1 #11 dashboard residuals still at HEAD — number agreement + collapsed branches
**Evidence:** dashboard.tsx:1148 `آخر {chartDays} يوم` — wrong for every value the chips can pick (7 → «أيام», 14 already correct elsewhere, 30/90 → «يوماً»; the correct 11-99 form is singular accusative). dashboard.tsx:612 `${stats.today_orders ?? 0} طلب اليوم` and :646 `${stats.total_orders ?? 0} طلب إجمالاً` — bare counts, no `formatCount` (the helper exists and the users tile at 664-670 already uses it with proper forms). dashboard.tsx:590-591 — `if (days <= 14) setGranularity("daily"); else if (days <= 30) setGranularity("daily");` — the first two branches are identical (collapse to `days <= 30`).
**Fix:** «آخر 7 أيام / آخر {n} يوماً» (or just make the chips own the label), `formatCount` with ORDER-count-style forms, delete the dead branch. **Effort S.**

### A1-3. [P3] Users-chart CSV export re-implements the download ritual, loses the date stamp, and carries a dead hover class
**Evidence:** dashboard.tsx:1150-1170 — an inline Blob/`URL.createObjectURL`/`a.click()` block, byte-for-byte the same ritual as `exportChartCSV` (362-387) minus the `${date}` filename suffix (`users_${chartDays}d.csv` vs `chart_${days}d_${date}.csv`) and minus the numeric-formatting discipline (the money export rides `CSV_DECIMAL_FORMATTER`; this one joins raw values). The trigger button's classes are `text-muted-foreground hover:text-muted-foreground` (1166) — the hover half is a no-op (the exact dead-class class R125-A1 #11 deleted on orders).
**Fix:** extract a `downloadCsv(rows, filename)` (orders.tsx:979-988 already has one — lift it to a shared helper), add the date suffix, drop the dead hover class. **Effort S.**

### A1-4. [P3] KPI tile icons/legend swatches ride raw `-400` hues — light theme fails the 3:1 graphics floor; skeleton block-count CLS for scoped admins
**Evidence:** METRIC_CARDS colors `text-emerald-400` (648), `text-blue-400` (672), `text-orange-400` (684), `text-cyan-400` (699) on `bg-*-400/10` chips; legend swatches `bg-emerald-400` (914), `border-amber-400` (918), `bg-amber-400` (1061), `bg-emerald-500/60` (1065); low-stock dot `bg-orange-400` (770). A6's B-4 measured this hue family at 1.9-2.9:1 on the shipped light admin theme — under even the 1.4.11 non-text 3:1 floor. A6's enumerated B-4 list covered TrendBadge/urgent-banner/menu labels (all since fixed); these icon/swatch sites were not in it, and the known-open ledger only tracks `text-yellow-400`. Also: the loading skeleton always renders 6 blocks (749-753) while a non-finance operator's `METRIC_CARDS.filter` yields 3 (710) — a 6→3 grid collapse on first paint for scoped admins.
**Fix:** icons can adopt the `--status-*`/chart-token inks (`chart.success/info/warning` already exist in-file at 620/653/677); skeleton length = the finance-filtered card count. **Effort S.**

## B. orders.tsx

### A1-5. [P3] `toggleSelectAll` compares SIZES while `allFilteredSelected` (aria-pressed) compares MEMBERSHIP — the select-all lies about what a click will do
**Evidence:** orders.tsx:1010 `if (selectedIds.size === filtered.length) setSelectedIds(new Set())` vs :1014 `const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id))`. Selections survive filter switches (never pruned), so after switching tabs `selectedIds` can hold N ids from the old view while `filtered` shows N different rows: aria-pressed reads false, yet clicking "select all" CLEARS the whole selection instead of selecting the visible rows. The bulk-refund input path is where this control feeds (1356 family).
**Fix:** make the toggle ride the same membership test: `if (allFilteredSelected) clear(); else setSelectedIds(new Set(filtered.map(o => o.id)))` (the topups idiom, topups.tsx:918-923, is already membership-based). **Effort S.**

### A1-6. [P3] Raw counts without `formatCount` across the money-action strings + the R125-A1 #11 orders residuals
**Evidence:** orders.tsx:1041 `{todayCount} اليوم`, :1250 `{selectedIds.size} طلب محدد`, :792 `تأكيد استرداد ${selectedIds.size} طلب؟`, :861/:864 `تم استرداد ${updated} طلب` / `تخطي ${skipped} طلب` — «2 طلب» reads wrong («طلبان») and 3-10 should be «طلبات»; the page already owns `ORDER_COUNT_FORMS` (127-134) and uses it two lines above each site. Plus the two verified-open #11 items: :109 «30 يوم» → «30 يوماً», and :1382 `${active ? "text-muted-foreground" : "text-muted-foreground"}` (identical branches — delete).
**Fix:** one-liners. **Effort S.**

### A1-7. [P3] Coupon-stats emerald cluster escaped both the A6-B4 and A6-B6 sweeps — light theme 1.92:1
**Evidence:** text-emerald-400 at orders.tsx:1047 (header revenue chip), :1141 (label «إجمالي الخصومات»), :1145 (its value), :1196 (top-coupon code chip), :1210 (top-coupon discount value), :382 (expanded-row coupon_code). A6-B4's enumerated raw-hue list covered TrendBadge/topups/orders-menu-labels/settings — not the coupon panel; A6-B6's ~25 `text-primary` list didn't either. Dark default passes (9.68:1); the light theme — one toggle away (layout.tsx theme toggle) — fails 1.4.3 on money-adjacent text.
**Fix:** `text-status-success` ink (the StatusBadge family) or `text-emerald-500`+`dark:` pairs; one mechanical pass. **Effort S.**

### A1-8. [P3] CSV export identity/shape nits
**Evidence:** orders.tsx:996 — the «المستخدم» column exports `o.user_phone ?? ""` only, while the table renders `displayUserName(userFromRow(order))` (name-first, phone fallback) at :284/:441 — the exported money record loses the identity the operator actually verifies. :998 — amount cells export the raw number, while the dashboard's money CSV pins the en-US 2-decimal no-grouping shape (`CSV_DECIMAL_FORMATTER`, dashboard.tsx:190-194) for exactly this reason — two money CSVs, two shapes.
**Fix:** export `displayUserName(...)` + phone (two columns), reuse a shared decimal formatter. **Effort S.**

### A1-9. [P3] The clear-filters handler is triplicated
**Evidence:** orders.tsx:1416-1428 («مسح الكل»), :1491-1504 (partial-empty «مسح الفلاتر»), :1512-1525 (empty-state «مسح الفلاتر») — three byte-identical `setSearch(""); setStatusFilter(""); setDateRange(0); syncFilterParams("", 0)` bodies.
**Fix:** one `clearFilters()` helper (ponytail rule). **Effort S.**

## C. topups.tsx

### A1-10. [P2] The status-tab empty state claims «لا توجد طلبات قيد الانتظار» over a partial window — the money queue's false-empty, plus a badge that disagrees with itself
**Evidence:** the infinite query fetches ALL statuses unfiltered — `/api/admin/topups?page=${page}&limit=${TOPUPS_PAGE_SIZE}` (topups.tsx:667-675; the backend supports `?status=` at routes/admin/topups.ts:60/73 but the page never sends it) — and the tabs filter client-side (812-828). `topups.length === 0` then renders the hard `EmptyState` «لا توجد طلبات قيد الانتظار» (1414-1426) with no `hasNextPage` variant, while pending rows older than the newest 100 sit on unloaded pages (backend orders `desc(createdAt)`, topups.ts route :102). The header chip `{pendingCount} قيد الانتظار` (1170) and the tab count (1325) count only the loaded window — they can read 0 while the sidebar badge (server truth, layout.tsx:915) shows N>0: two numbers on one screen disagreeing about pending money. This is the exact class R115-A9 P2 killed on orders (orders.tsx:1471-1506 renders the guarded «لا طلبات مطابقة ضمن الصفحات المحمّلة» + load-more + clear CTA when `hasNextPage`); R125-A1 #7 fixed the users sibling; the money queue itself is still unguarded. Partial mitigation, verified: the bare `LoadMoreButton` does render below the EmptyState (1472-1476 is outside the empty branch) — but nothing tells the operator it is the remedy, and the empty claim itself is false.
**Fix:** mirror the orders partial-empty block when `!searchActive && hasNextPage && topups.length === 0` (honest title + «حمّل المزيد» as the CTA); the deeper fix is passing `?status=` for the active tab so the pending queue is server-filtered and page 1 is always the pending head. **Effort S (guard) / M (status-param query).**

### A1-11. [P3] «موافقة الكل» approves only the loaded window with no cap hint
**Evidence:** topups.tsx:1036-1038 — `approveAll` filters `allTopups` (accumulated pages) for pending and iterates them; the button label is `موافقة الكل (${pendingCount})` (1318) where `pendingCount` is the loaded-window count. When `hasNextPage` is true, the word «الكل» over-promises: pending rows beyond the window survive the loop, and only the post-loop `invalidate()` surfaces them (a second click is needed). The count shown is at least accurate for what will run — but nothing says the queue extends further.
**Fix:** while `hasNextPage`, label «موافقة المعروض (N)» or disable with the honest hint; or make the loop paginate (`?status=pending`) until a short page. **Effort S.**

### A1-12. [P3] One concept, three Arabic words: `payment_reference` renders as «رمز التحويل» / «مرجع التحويل» / «رقم التحويل» on the same page
**Evidence:** topups.tsx:255 card label «رمز التحويل:», :875 approve-confirm «مرجع التحويل:», :1229 search placeholder «بحث برقم التحويل أو الهاتف…». The status-badge invariant (one status, one word) is the established rule; this is its money-field equivalent — an operator reconciling a bank statement against the confirm dialog meets two different field names for the number they are verifying.
**Fix:** pick one («رمز التحويل» matches the card) and use it in all three. **Effort S.**

### A1-13. [P3] Bulk money-dialog count copy + the #11 residuals on topups
**Evidence:** topups.tsx:491 `${count} طلب سيتم معالجته` (BulkConfirmModal description — the money confirm; «3 طلب» should be «3 طلبات», «2» → «طلبان»); :1094/:1101 approveAll toasts (`تمت الموافقة على ${approvedCount} طلب`); :1170 `{pendingCount} قيد الانتظار`; :745 vs :789 — the approve toast says `لـ ${t.user_phone}` while the reject toast says `من ${t.user_phone}` for the same actor-action pair. Plus :1355 identical-ternary dead class (the orders :1382 twin), and :247 «المُرسل:» carries a damma while :238/:255/:263 sibling labels are bare (R125-A1 #11's diacritics policy item — still open).
**Fix:** one-liners; `TOPUP_COUNT_FORMS` (108-115) already exists in-file. **Effort S.**

### A1-14. [P3] `processingId` is a single slot — a second in-flight action re-enables the first row's buttons
**Evidence:** topups.tsx:597 `useState<number | null>` consumed as `isProcessing={processingId === t.id}` (1457). Confirm A → `setProcessingId(A)` → POST in flight; open B's confirm (the modal is the only serialization) → confirm → `setProcessingId(B)` (879) — card A now renders `isProcessing=false` and its «موافقة»/«رفض» buttons are enabled while A's POST is still running. No double-credit is possible (per-click Idempotency-Key + server status guards), but the disabled-state honesty — the thing the R124/R125 discipline is built on — breaks for the older row. Same single-slot pattern: referrals `crediting` (referrals.tsx:234, :363), coupons `toggling` (:128) and `archiving` (:132).
**Fix:** a `Set<number>` of in-flight ids (or disable all row actions while any mutation is pending). **Effort S.**

### A1-15. [P3] Status-tab empty states have no recovery CTA (R125-A1 #13, verified still open)
**Evidence:** topups.tsx:1433-1445 — only `searchActive` gets an action («مسح البحث»); a tab-empty on «مرفوض» renders «لا توجد طلبات في هذه الفئة» with no «عرض الكل» switch.
**Fix:** CTA `onClick={() => { setStatusFilter(""); /* + the replaceState write-back at 1336-1339 */ }}`. **Effort S.**

## D. pricing.tsx

### A1-16. [P3] A failed recalc blanks the results column to the WRONG message; a stale result outlives its inputs
**Evidence:** pricing.tsx:597 — the catch path calls `setResult(null)`, so the output column renders the placeholder «أدخل سعراً أو اختر منتجاً لرؤية الحساب» (1116-1118) — on a transient network failure the page tells the operator their (still-present) inputs don't exist. Every list page keeps stale data on refresh failure (orders.tsx:1438-1453 idiom); the calculator deletes it. Converse bug: when `canCalculate` flips false (e.g., switching the picker to «custom» with an empty price), the debounce effect early-returns (609) and the PREVIOUS product's full result set (waterfall, margins, worst-case) stays on screen beside inputs it no longer describes — nothing marks it stale.
**Fix:** on error keep `result` (toast only); when `!canCalculate`, clear or dim-and-label the results. **Effort S.**

### A1-17. [P3] The products picker query has no error state and is never refreshed by the page's own refresh button
**Evidence:** pricing.tsx:521-528 — `const { data: products = [] } = useListAdminProducts(...)`; `isError` is never destructured. A failed `/admin/products` leaves the picker (943-969) offering only «— سعر مخصّص (للاختبار) —» with zero signal — the false-empty class, on the very control that seeds every simulation. `onRefresh` (618-621) refetches the config and recalculates but never invalidates `getListAdminProductsQueryKey()` — the picker's prices (and cost hints) can stay stale through a manual refresh.
**Fix:** destructure `isError` + inline banner/retry (the config section's own idiom at 660-679); add the products key to `onRefresh`. **Effort S.**

### A1-18. [P3] Final-price money cell rides raw `text-primary` — the one money-value site A6-B6's ~25-site sweep missed
**Evidence:** pricing.tsx:1191 `className="tabular-nums font-bold text-primary text-base"` — «السعر النهائي», the calculator's headline money number. Raw `--primary` on the dark card is 3.76:1 (A6 measured), text-base is not large text; dark is the admin default — this fails on the DEFAULT theme, unlike the light-only emerald residuals. Same family in-file: the amber-500 dry-run card family (798/860/866/937) and `text-emerald-500` delta (:901) sit at ~2:1 on light.
**Fix:** `text-primary-text` for the final price (the B-6 sweep class); `--status-*` or `dark:` pairs for the amber/emerald set. **Effort S.**

### A1-19. [P3] `configDirty` compares the operator's inputs against LIVE server data — another admin's save can mark YOUR untouched form dirty and arm the save button
**Evidence:** pricing.tsx:356-361 — `configDirty = pricingConfig != null && (rateNum !== pricingConfig.usd_to_lyd || …)`. The config query can be updated under the operator (socket/manual refetch); after another admin saves a new rate, the local inputs (seeded once, 339-346) now differ from the fresh `pricingConfig`, so the form reads dirty and «حفظ الإعدادات» enables — saving would silently revert the other admin's change with no warning, on the rule that prices the whole catalog.
**Fix:** snapshot the seeded values in a ref and diff against the snapshot (the dirty flag then means "operator edited", which is what the save gate and the `useDirtyGuard` at :368 actually promise). **Effort S.**

## E. coupons.tsx

### A1-20. [P3] The نسبة/مبلغ type picker is the last un-swept chip bar on the money pages — no aria-pressed, no group semantics
**Evidence:** coupons.tsx:430-457 — two `<button>`s whose active state is purely visual (`bg-primary text-white`), facing a bare `<Label>نوع الخصم</Label>` (:428, no control to associate — the control is the button pair). The R124-I5/R125 aria-pressed sweep covered orders/topups/users/tickets/products chips, settings tabs, and even the coupons row-toggle (:734) — this segmented control on the coupon-creation form (it decides whether «value» means percent or LYD) was missed.
**Fix:** `role="group" aria-label="نوع الخصم"` + `aria-pressed={form.type === t}` per button (the ChartPickers idiom, dashboard.tsx:117-135). **Effort S.**

### A1-21. [P3] Raw-hue + raw-count residuals on the coupons stats
**Evidence:** coupons.tsx:364 `text-emerald-400` (the «نشطة» stat number, 2xl — fails light 3:1 even as large text), :740 toggle icon emerald-400; :770 footer `{coupons.length} كوبون · {activeCount} نشط` — bare counts, no `formatCount` («2 كوبون» → «كوبونان»).
**Fix:** status-success ink; `formatCount` with coupon forms. **Effort S.**

### A1-22. [P3] The only money list with no search — on a page whose rows are codes you look up
**Evidence:** coupons.tsx has no search/filter input anywhere (full read; the header at 328-345 is title + «كوبون جديد» only), while the list is server-capped at 200 with no page param (the honest-cap wording at 359-361 admits it). Orders/topups/users/products/referrals all ship search; a coupon code among 200 rows is findable only by visual scan, and beyond 200 not at all. (A2#22's no-sorting known-open compounds this.)
**Fix:** a client-side filter over `code`/`description` (the list is already fully loaded — the topups client-search idiom, no backend change). **Effort S.**

## F. referrals.tsx

### A1-23. [P3] The searchable money list with no clear affordance — no ✕ button, no «مسح البحث» CTA, no URL sync
**Evidence:** referrals.tsx:533-540 — the search Input has no clear button (orders.tsx:1066-1077 and topups.tsx:1234-1245 both ship one); :594-598 — the empty state offers no action for `search` (the `EmptyState` `action` prop exists and both siblings use it); the `statusFilter` never writes back to `?status=` (orders.tsx:932-939 and topups.tsx:1336-1339 both do). Clearing a bad search here means select-all-delete in the box.
**Fix:** copy the orders ✕ + CTA trio; optional `replaceState` sync. **Effort S.**

### A1-24. [P3] Raw counts without `formatCount` on the leaderboard and footer
**Evidence:** referrals.tsx:513 `{r.credited_count} ناجحة`, :514 `{r.total_count} إجمالي`, :637 `${list.length} إحالة` — «2 إحالة» should be «إحالتان», 3-10 «إحالات» (the `formatCount` helper is imported-adjacent in every sibling page; referrals imports only `formatRelativeTime`, :13).
**Fix:** one-liners. **Effort S.**

## G. Cross-page

### A1-25. [P3] `lib/idempotency.ts` docblock prescribes the exact bulk-key pattern topups deliberately rejects
**Evidence:** idempotency.ts:34-36 — "Bulk operations: ONE key per logical bulk (a "Refund 5 orders" button is one intent), not per item." vs topups.tsx:948-953 — "one Idempotency-Key per topup, NOT one for the whole bulk. The backend dedup is per-(admin, route, key); a single key shared across N approvals would let only the first call commit and the next N-1 would replay the first response". The code is right (sequential per-item loops need per-item keys); the module doc is the stale pre-94-C2 guidance and would guide a future implementer straight into the replay bug the in-file comment warns about.
**Fix:** rewrite the docblock bullet to the per-iteration rule with a pointer to topups.tsx:948. **Effort S (doc-only).**

### A1-26. [P3] Socket freshness coverage stops at the four big lists — coupons/pricing/referrals have no push path at all
**Evidence:** SocketInitializer.tsx:82-85 invalidates stats/orders/topups/users only; the backend emits `admin-stats-update` for topups/orders/users/tickets/risk (backend grep — no coupon/pricing/referral emit), and none of the three raw-fetch pages (coupons/pricing/referrals ride local state) listens to anything. Multi-admin staleness on these pages is bounded only by their manual refresh (all three use raw fetch — A2#12's known family), with one sharp edge: the pricing CONFIG (react-query) can be refreshed by socket/revalidation while the coupons list beside it in another tab stays old — cross-page number disagreement is possible after a shared mutation (e.g., a coupon created elsewhere never appears until refresh).
**Why it matters:** on the money pages the mandate's "data freshness" bar (socket invalidation + cache coherence) is met for orders/topups/dashboard but silently absent for the other three.
**Fix (minimal):** subscribe the three pages' fetchers to the same `admin-stats-update` event (dispatch → refetch), or fold them into react-query keys under their URL prefixes and add the prefixes to the handler. **Effort M.** — marked **P3** because all three are single-operator-editor pages in practice and every mutation the SAME operator makes already refetches locally.

---

## H. Verified-good (money-safety re-check, no finding)

- **Idempotency-Key coverage on my six pages is complete and correctly shaped**: topups single per-click (887/900), bulk + approveAll per-iteration (959/1056), orders bulk per-click (812-815), referrals credit per-click (375). No money mutation on coupons/pricing needs one (create is code-unique; toggle/archive are state-settling and per-row-busy-guarded; recompute is inherently idempotent + confirm-gated at pricing.tsx:502-519).
- **Confirm gates**: every destructive/money action on all six pages opens a dialog that names the amount (topups 873-877, orders 791-799, referrals 357-361, coupons 293-300, pricing 503-516).
- **Pagination honesty**: orders/topups `getNextPageParam` full-page rule + `knownTotal` single-short-page proof (orders.tsx:649-650/685, topups.tsx:679-680/703) — «إجمالاً» only on a provable window, «عرض N» otherwise; pageParam ceilings enforced server-side (topups route :75-86). referrals mirrors its 200 cap in wording (79, 635-637).
- **Error taxonomy**: loading skeleton / hard-fetch error card / stale-refresh inline banner / empty — all six pages carry the full triad with `role="alert"`/`role="status"` (orders 1438-1469, topups 1380-1413, referrals 562-592, coupons 559-574, pricing 660-679, dashboard 846-862/1256-1288).
- **RTL**: money/numeric cells are `tabular-nums` + `dir="ltr"` islands where mixed (pricing 887-907/1236-1288, MaskedCredential 187); physical margins hand-checked correct-for-RTL on all six (the A6-B13 finding).
- **Keyboard**: `/` shortcut + ESC (orders 892-901), menu arrow-keys + ESC-focus-return (orders 1288-1307), ⌘↵ submit in money note fields (topups 428/549), focus-visible global ring (index.css:836-839).
- **Layout badge merge prefers server truth with page fallback** (layout.tsx:909-924) — topups' loaded-window badge is only the error fallback, as designed.

## I. Summary

| Severity | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 1 | A1-10 (topups status-tab false-empty over partial window + badge disagreement) |
| P3 | 25 | A1-1..9 (dashboard 4, orders 5), A1-11..15 (topups 5), A1-16..19 (pricing 4), A1-20..22 (coupons 3), A1-23..24 (referrals 2), A1-25..26 (cross-page 2) |

**R125 findings verified still-open in this lane** (not counted above, already filed): R125-A1 #11 residuals (orders «30 يوم»/1382, dashboard 1148/590-591, topups 247 diacritics), #13 topups tab CTA, A2#8 referrals status vocabulary/aria-pressed, A6 B-15 double-h1.

## J. Prioritized fix list for the implementation lanes

1. **A1-10 (P2, S/M)** — topups partial-empty guard (orders block verbatim) + `?status=` on the query; the money-queue honesty gap.
2. **One "mechanical" commit, S, zero behavior risk:** A1-2, A1-6, A1-13 (formatCount + agreement + dead branches/classes across all six pages), A1-9 (de-triplicate clear-filters), A1-12 (رمز/مرجع/رقم unification), A1-24, A1-21 counts, plus the four still-open R125-A1 #11/#13/A2#8 items.
3. **A11y/contrast cluster, S:** A1-4, A1-7, A1-18, A1-20, A1-21 (hue) — one `--status-*`/`text-primary-text` sweep over the enumerated lines.
4. **State-machine honesty, S:** A1-16 (calculator stale-keep + stale-clear), A1-19 (configDirty snapshot), A1-5 (select-all membership), A1-14 (in-flight id Set), A1-11 (موافقة الكل cap label).
5. **Freshness, S/M:** A1-1 (chart on socket push) — pairs naturally with A1-26 (coupons/pricing/referrals push path) in one SocketInitializer change.
6. **Hygiene, S:** A1-3 (CSV helper), A1-8 (CSV identity/shape), A1-17 (picker error + refresh), A1-23 (referrals clear affordance), A1-22 (coupons client search), A1-25 (idempotency doc rewrite).

**Verdict: SHIP-WORTHY.** No P0/P1; the one P2 is a wording/honesty guard on an already-recoverable state (the load-more button renders, the sidebar badge disagrees loudly), not a money-safety defect. The money-mutation core (idempotency, confirms, double-submit, partial-failure parsing, session-expiry exits) re-verified clean on every page.
