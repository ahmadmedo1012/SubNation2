# R125-A1 — Admin Money-Core Pages UX Deep Audit

**Scope:** `frontend/src/pages/admin/{dashboard,orders,topups,users,layout,login}.tsx` (6,980 lines) + `__tests__` + shared primitives they ride: `components/admin/{EmptyState,TableSkeleton}`, `components/ui/{alert-dialog,app-dialog,status-badge,fetch-error-card,load-more-button}`, `hooks/use-{confirm,toast,dirty-guard}`. Static code analysis only, main @ 09857fc (clean tree). Production NOT touched. Adjacent files (tickets/referrals/products/alerts/security) read only to verify cross-page invariants; inventory/restock and WhatsApp/OpenWA logic untouched per standing orders.

**Method:** impeccable `audit.md` + `craft-floor.md` + `clarify.md` rubrics; full read of all six pages and all shared primitives; R124-A6 predecessor re-verified finding-by-finding; per-page state-machine walkthrough (first-load / error / stale-refresh / empty / partial-page / 0-1-row / last-page / filter-no-results); money-action safety trace (Idempotency-Key lifecycle, confirm content, double-submit, pessimistic-UI, recovery); copy audit incl. programmatic codepoint verification of suspect Arabic words (المنتج/يحتاج/يعمل/الحساب/التحديث/الولاء — **all verified correctly spelled** via unicodedata, no false claims); cross-cutting greps (refetchInterval census, aria-pressed census, animate-pulse × prefers-reduced-motion, skip-link, معلق residue).

---

## A. Verified HELD (R124 fixes — all six re-checked at HEAD)

| R124-A6 # | Fix | Evidence at HEAD | Verdict |
|---|---|---|---|
| 1 | Success toast variants (money actions) | topups.tsx:544-550 (approve), 589-593 (reject), users.tsx:664-669 (wallet save), orders.tsx:847-853 (bulk); 29 `variant:"success"` sites across admin | **HELD** |
| 2 | Status vocab derives from `statusLabel` | orders.tsx:74-99 (BULK_STATUSES + STATUS_FILTERS), topups.tsx:87-98, dashboard.tsx:446-449 tile, layout.tsx:261-266 context CTA; pinned by tickets.tsx:62 comment | **HELD** (residual «معلق» strings remain — finding 8) |
| 4 | Memoization (R118-B2 pattern beyond orders) | users.tsx:180-288 (React.memo rows), 446-496 (useMemo chain + useCallback); products.tsx:246-266, 808-813; referrals.tsx:111-126, 401 | **HELD** |
| 11 | Orders bulk double-refetch | orders.tsx:856-865 — explicit `refetch()` dropped, single base-key invalidate (R124-I5 comment) | **HELD** — but the same class resurfaced in dashboard (finding 4) |
| 12 | CopilotPanel lazy | layout.tsx:12-21 (lazyWithRetry) + 1190-1196 (Suspense, null fallback) | **HELD** |
| 14a | Topups money-queue search | topups.tsx:395-407 (300ms debounce), 610-631 (client-side filter over accumulated pages, useMemo), 988-1009 (search chrome), 1110-1118 (partial-window hint), 949-961 (honest «نتائج البحث» count); pinned by `topups-queue-search.test.tsx` (3 tests) | **HELD** |
| 16 | Nav IA + titles | layout.tsx:99-104 (group renamed «الكتالوج والعملاء»), 221-235 (PAGE_TITLES derived from NAV_SECTIONS — drift impossible by construction) | **HELD** |

Also verified HELD beyond the six: **A6 #8** (topups local CopyButton deleted — shared one at topups.tsx:1252/1261/1271/1281), **A6 #10** (aria-pressed on orders 1356/1388, topups 1088/1210, users 834/865, tickets 389/410, products 1443/301; settings.tsx:1050-1064 got full `role=tab`/`aria-selected`). Known-open item 3 (row selectors) is therefore **CLOSED** — orders/topups/products all expose `aria-pressed` now.

## Money-safety verdict (the round's core question)

**No P0/P1. The money-surface discipline is excellent and test-pinned:**
- **Idempotency-Key coverage is complete and correctly shaped**: per-click on topups single (669), per-iteration in bulk loops (733, 830 — with the one-key-per-topup rationale documented at 722-727), per-save-INTENT on wallet edits (users.tsx:599-606, 335 — the strongest form, kept across retries, cleared only on definitive resolution or 409 `IDEMPOTENCY_IN_FLIGHT`, 653-657), per-click on bulk refund (orders.tsx:799-803).
- **Confirm dialogs show the amount**: topups approve shows amount + phone + sender + reference (657); wallet edit shows current→next balance preview per mode + overdraw warning (572-595); bulk refund shows count + total LYD (776-786). Pinned: `topups-approve-confirm.test.tsx`, `users-wallet-confirm.test.tsx` (17 tests).
- **Double-submit**: same-tick Enter guards (login verifyingRef 34), per-row processingId (topups 1312/1324), approveAll re-click guard (811), dismissable={!loading} on every money modal (AppDialog 122-124).
- **Pessimistic UI everywhere** (no optimistic money mutations); 207 partial bodies parsed (orders 822-854); session-expiry exits break loops without toasting into the redirect (topups 714-766, 818-863); useConfirm is overlap-safe (use-confirm.tsx:67-70 resolves a pending confirm as false).

---

## B. Findings

### 1. [P2] users «مسح الفلاتر» clears the UI but not the URL — a cleared filter resurrects on refresh
**Evidence:** users.tsx:1245-1255 — the empty-state CTA calls `setSearch(""); setTierFilter("")` but never `syncFilterParams(...)` (defined 393-402). The page's other clear paths do sync (826-830, 879-889); orders.tsx:1400-1413 is the correct idiom («مسح الفلاتر» + `syncFilterParams("", 0)`).
**Why it matters:** after clearing, `?tier=gold` stays in the address bar; a refresh (or a copy-pasted link) silently re-applies a filter the operator believes they removed — state divergence on the directory that lists wallet balances. Also `sortBy` is not reset (inconsistent with the panel's «إعادة ضبط»).
**Fix:** call `syncFilterParams("", "wallet_desc", showFilters)` (and reset sortBy) in the CTA handler. **Effort S.**

### 2. [P2] The wallet-amount input — the money field itself — has no programmatic label
**Evidence:** users.tsx:1068 `<Label>تعديل المحفظة (د.ل)</Label>` without `htmlFor`, facing `<Input type="number">` (1089-1106) without `id`/`aria-label`. The note and points fields in the same dialog DID get the r103 pass (1115-1120 `htmlFor="user-edit-note"`, 1146-1151 `user-edit-points`) — the primary money input was missed.
**Why it matters:** screen readers announce only the mode-dependent placeholder («الرصيد الجديد»/«المبلغ للإضافة»/«المبلغ للخصم») — a WCAG 1.3.1/3.3.2 failure on the field where every manual wallet adjustment is typed; clicking the visible label focuses nothing.
**Fix:** `htmlFor="user-edit-wallet"` + `id="user-edit-wallet"` (+ `aria-describedby` the points-value hint pattern). **Effort S.**

### 3. [P3] dashboard fetchChart race — known-open #1, CONFIRMED and deepened
**Evidence:** dashboard.tsx:322-363 — plain `fetch`, no AbortController/sequence token; effect at 365-367 fires per `chartDays` change; period chips 738-753. **Deepened blast radius:** stale `chartData` doesn't only mismatch the chart — it feeds TrendBadge (592), KPI Sparklines (607), and the `newUsersToday` tile sub-line (425-426), so a slow 7-day response landing after a fast 90-day one puts wrong-period numbers in the KPI cards, not just the chart. Also the older fetch's `finally` clears `chartLoading` (362) while the newer is still in flight (fake-idle skeleton gap). Granularity chips are safe (client-side re-aggregation only, 391).
**Fix:** abort-on-change in the effect (the GlobalSearch recipe, layout.tsx:331-391) or a fetchSeq token (referrals idiom); check `signal.aborted` before every setState incl. the finally. **Effort S.**

### 4. [P3] dashboard handleRefresh double-fires /admin/stats — the exact F11 class R124 killed in orders
**Evidence:** dashboard.tsx:374-378 — `refetch();` immediately followed by `queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() })`: the invalidate re-fetches the still-active query, so each refresh click sends two identical stats requests. orders.tsx:856-865 is the fixed shape with the R124-I5 rationale.
**Fix:** drop the explicit `refetch()`. **Effort S** (one line).

### 5. [P3] Polling-cadence policy still undocumented and divergent — known-open #4, deepened census
**Evidence (HEAD):** 300s standard — dashboard.tsx:289/315, orders.tsx:641, topups.tsx:496, users.tsx:442, layout.tsx:723/756 (badges) + 921 (alert-toast poll). Divergent: products **60s** (products.tsx:621), alerts **20s** (alerts.tsx:228), risk 30s (risk.tsx:102), system 15/60/90s (system.tsx:450-528), tickets **none**. Each is locally commented but no hub states the policy; concretely, the alerts **inbox** polls 15× more often than the layout's **unread badge** (20s vs 300s) — after a socket dropout the badge can lag the inbox by minutes.
**Fix:** a short "admin list contracts" table (cadence + rationale + socket-coverage column) in docs/operations; then normalize alerts to 300s (its freshness need is already served by the `admin-alert-new` socket push + visibilitychange catch-up, layout.tsx:913-920). **Effort S (doc) / M (normalization).**

### 6. [P3] aria-pressed residuals after the R124-I5 sweep — dashboard chips, wallet mode segmented control, topups select-all
**Evidence:** dashboard.tsx:724-735 (granularity chips) and 741-752 (period chips) — active chip purely visual; users.tsx:1070-1087 (wallet add/subtract/set — a money-mode control, no aria-pressed/radiogroup); topups.tsx:1033-1043 («اختيار الكل» — no aria-pressed AND the label never changes to «إلغاء اختيار الكل», unlike orders' named state-aware select-all at 1530-1536); topups.tsx:1206 generic row aria-label («اختيار»/«إلغاء الاختيار») vs orders' per-row naming (orders.tsx:256).
**Fix:** one-liners, the orders.tsx:1356 idiom. **Effort S.**

### 7. [P3] users tier-filter empty state asserts global emptiness over a partial window
**Evidence:** users.tsx:1235-1244 — `sorted.length === 0` renders a hard `EmptyState` («لا مستخدمون بمستوى X») with no `hasNextPage` variant, although the tier filter runs client-side over accumulated pages (469) — a tier can read empty while matching users sit on unloaded pages. orders.tsx:1455-1490 solves exactly this (R115 A9 P2: load-more visible + honest incompleteness hint); users even has the sibling honesty hint for sort (897-901) but not for the tier-empty claim. Search-empty is honest (server-side).
**Fix:** mirror the orders partial-empty block when `tierFilter && hasNextPage`. **Effort S/M.**

### 8. [P3] topups still carries the «معلق» vocabulary beside its own «قيد الانتظار» tab
**Evidence:** topups.tsx:939 urgent chip `{pendingCount} معلق`, 972 «إجمالي معلق», 1164 empty state «لا توجد طلبات معلقة» — on the same page whose tabs now read `statusLabel("pending")` = «قيد الانتظار» (1088-1095). Adjacent: referrals.tsx:65/164 tabs «معلقة» (out of my lane, noted for the referrals owner).
**Why:** the status-badge invariant (status-badge.tsx:73-74) — one status, one Arabic word — broken three times on the money queue itself; R124-A6 F2 fixed the tabs but not the prose around them.
**Fix:** «قيد الانتظار» phrasing («N قيد الانتظار», «إجمالي قيد الانتظار», «لا توجد طلبات قيد الانتظار»). **Effort S.**

### 9. [P3] Admin shell chrome gaps (batch)
**Evidence & items:**
- **(a) No skip-to-content** — App.tsx:786-794 deliberately excludes admin (`!isAdmin`); the admin shell (layout.tsx:1051-1189) has no skip link, so keyboard users tab through ~20 nav items + top bar before content on every page (storefront got this in V2-H1; admin never did).
- **(b) Doubled title/h1** — top bar renders `<h1>{pageTitle}</h1>` (layout.tsx:1104) while every page renders its own `<h1>` with the now-derived identical text (orders.tsx:1014 «الطلبات», topups.tsx:935, users.tsx:761) — the same word twice on screen and two h1s per document.
- **(c) Collapse chevron unlabeled** — layout.tsx:970-977, icon-only, no aria-label/aria-expanded.
- **(d) Mobile drawer focus leak** — layout.tsx:1068-1083: `role="dialog" aria-modal="true"` with NO focus trap or initial focus (documented §11.2 rule-6 follow-up at 1065-1067); aria-modal promises containment the DOM doesn't enforce — Tab walks into the page behind the scrim.
- **(e) Color-only error state on mobile** — the badge "last updated" pill hides its text below sm (`hidden sm:inline`, layout.tsx:1149); the amber dot (1139-1143) carries the «تعذّر التحديث» state by color + hover-title only on touch.
**Fix:** skip link to `#admin-main` + `tabIndex={-1}` on main; demote top-bar title to a `<div>` (the page h1 remains) or drop page h1s; `aria-label="طيّ القائمة"`/`aria-expanded`; drawer initial-focus + Tab containment (or accept and drop aria-modal); always-visible one-word error («تعذّر»). **Effort S per item, M for (d).**

### 10. [P3] orders footer prints a partial-window sum as «إجمالي»
**Evidence:** orders.tsx:1600-1608 — the desktop table footer shows `· إجمالي ${formatCurrency(totalRevenue)}` whenever rows exist, including when `!knownTotal` (accumulated pages) where it is a slice sum; the coupon stats panel in the same page carries the honest caveat (1218-1224: «الإحصاءات تعكس الطلبات المعروضة…») but the footer doesn't. Also inconsistent gating: the header shows totalRevenue only when a filter is active (1031-1038) while the footer always shows it — the same number appears under two different conditions.
**Fix:** footer reads «مجموع المعروض: X» when `!knownTotal`, «إجمالي» only on a provable window. **Effort S.**

### 11. [P3] Copy/grammar batch (clarify pass)
**Evidence:**
- Arabic number agreement: orders.tsx:105 «30 يوم» and dashboard.tsx:927 «آخر {chartDays} يوم» — 11–99 takes singular accusative «يوماً» («30 يوماً», «آخر 90 يوماً»); «7 أيام»/«3 أشهر» are correct.
- users.tsx:1242 «لا مستخدمون بمستوى…» → «لا مستخدمين…» (accusative after لا).
- Dead code: orders.tsx:1364-1370 identical ternary branches (`active ? "text-muted-foreground" : "text-muted-foreground"`); dashboard.tsx:411-415 `onChangeDays` — `days <= 14` and `days <= 30` branches both set "daily" (collapse).
- Diacritics policy (R124-A6 #18 residual): topups.tsx:657/1257 «المُرسل:» carries a damma while sibling field labels «المستخدم:» (1248) and «رمز التحويل:» (1267) are bare — pick one policy for the money-card labels.
- login.tsx:200 placeholder `admin` — primes the default admin username on the public login card; use a neutral example or none.
- Pluralization drift: layout.tsx:553 `{u.order_count} طلب` and users.tsx:267 mobile card skip `formatCount` (used by every list counter — «طلب/طلبان/طلبات»).
**Fix:** all one-liners. **Effort S.**

### 12. [P3] Login page — strong overall; two nits (full audit per brief)
**Verified good:** labels+htmlFor (194/210/237), autoComplete username/current-password/one-time-code (199/216/242), inputMode numeric + pattern + 6-digit clamp (246-250), aria-describedby→role=alert error block (206/222/254, 260-270), double-Enter same-tick ref guard (34, 109, 121), error bodies parsed after ok-guard with Arabic fallback (147-151), cookie-bootstrap probe honesty (51-73, SESSION_BOOTSTRAP_FAILED), **rate-limit messaging verified**: backend auth.ts answers 429 with Arabic + retry minutes («الحساب مقفل بسبب محاولات فاشلة. حاول بعد N دقيقة.» auth.ts:145-148/614-618; mapped via the code map errors.ts:67) — no raw English reaches the operator.
**Nits:** (a) `required` (203/220/251) delegates first-validation to browser-locale bubbles — an English-locale browser shows English "Please fill out this field" on an all-Arabic form (`noValidate` + the existing inline error block, or accept); (b) «العودة لتسجيل الدخول» (289-302) clears otpCode but keeps `tempToken` — a return-and-retry after the temp-token TTL surfaces the generic expired-code message instead of restarting the flow. **Effort S.**

### 13. [P3] EmptyState CTA parity residual — known-open #5, partially improved
**Evidence:** topups gained «مسح البحث» (1172-1182) ✓ and orders/users retain «مسح الفلاتر» ✓. Remaining: topups' status-tab empties (1160-1171) offer no «عرض الكل» CTA; tickets' hand-rolled list empty (tickets.tsx:465-469, out of lane) still has no CTA and no EmptyState. In-scope lists all use the shared EmptyState consistently.
**Fix:** add the natural CTA where one exists (topups: switch tab to «الكل»). **Effort S.**

### Also verified and HELD (no finding): known-open #6 — honest counts
orders.tsx:1016-1024, topups.tsx:944-953 (+ search-result count 954-961), users.tsx:762-769, dashboard aggregates labeled partial (1194-1224), layout badges server-sourced with error-fallback policy (772-787). Out-of-lane residual: security.tsx still has no honest count (R124-A6 F17 open, untouched by R124).

## C. Priority counts

**P0: 0 · P1: 0 · P2: 2 · P3: 11** (findings 1-2; 3-13, with 9 and 11 as batches). Money paths: clean — no finding touches Idempotency-Key coverage, confirm gating, or double-submit protection (all verified present and test-pinned).

## D. Suggested fix order (ponytail: deletion beats addition; consistency beats novelty)

1. **One "consistency" commit, S:** #4 (delete `refetch()`), #6 (aria-pressed one-liners), #10 (footer «مجموع المعروض»), #8 («معلق»→«قيد الانتظار»), #11 (copy batch + dead-code deletions) — all mechanical, zero behavior risk.
2. **#1 + #2 (the two P2s), S:** URL write-back in users' clear CTA + wallet-input label — both are one-liners on the money directory.
3. **#3 (chart abort), S:** the in-repo GlobalSearch recipe; kills the last unguarded multi-fetch on the money surface.
4. **#7 (users partial-empty variant), S/M:** copy the orders block verbatim.
5. **#9 (shell batch), S each:** skip-link + h1 demotion + collapse label first (pure deletions/additions); drawer focus (M) last.
6. **#5 (cadence doc + alerts normalization), S/M** and **#13 (topups tab CTA), S** — close out the two documented-policy gaps this round inherited.
