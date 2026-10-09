# R126-A2 — Admin Catalog + Customers Deep Audit (products / promotions / enrichment / users / tickets / whatsapp)

**Scope:** `frontend/src/pages/admin/{products,promotions,enrichment,users,tickets,whatsapp}.tsx` (5,495 lines) at HEAD `186b131` (clean tree) + the R125-I6 socket/invalidation contract (`SocketInitializer.tsx`, backend `routes/admin/{tickets,risk,users}.ts` emit sites), the shared fetch layer (`custom-fetch.ts`, `lib/errors.ts`, `use-admin-headers`), `utils.ts` money/plural helpers, and `App.tsx` admin route guard. **whatsapp.tsx receives its first-class deep pass** (last deep audit: round-97/96 history docs); tickets/users/products get the "what did R125 miss" pass.

**Method:** full read of all six pages + every helper they ride; backend contract greps for each pagination/RBAC/money claim; R125 fix verification end-to-end (seed→save→re-list for SEO, emit→invalidation for stats). Static only — production not touched, no builds, no test runs (all findings statically evidenced; the two candidate vitest suites were read instead of executed to spare the shared box).

**Standing order honored:** inventory/restock UI audited as-is; no inventory-feature proposals anywhere below.

---

## A. R125 fixes verified HELD (so the next round doesn't re-hunt them)

| R125 fix | Verdict | Evidence at HEAD 186b131 |
|---|---|---|
| **SEO editor displays existing overrides (I3, end-to-end)** | **HELD, full chain** | backend list projection SELECTs `seoTitle` (routes/admin/products.ts:112) and maps `seo_title: p.seoTitle ?? null` (:202); PATCH honors explicit-null-clears (:339-343); generated `AdminProduct` carries `seo_title/seo_description` (api.schemas.ts:1248/:1254); `startEdit` seeds live values (products.tsx:767-768); `seoTouched` gates the submit payload (:843-844); success → `invalidate()` → re-list → next `startEdit` seeds the saved values. Pinned by `products-seo-submit.test.tsx` |
| **tickets `has_unread_admin` surfaced** | **HELD** | backend computes per-row (routes/admin/tickets.ts:148); row badge «بانتظار ردك» (tickets.tsx:554-558) + header count pill (:370-372, :393-397); pinned by tickets-error-state.test.tsx:174 |
| **users stats co-invalidation (frontend half)** | **HELD** | users.tsx:684-692 — `getListAdminUsersQueryKey()` + `["/api/admin/stats"]` after wallet/points save; backend emit at routes/admin/users.ts:417. **The users half matches; the tickets/risk halves do NOT — Finding 1** |
| **enrichment batch (I3: cursor + confirm parity + taxonomy + ponytail)** | **HELD** | load-more via `next_cursor` (enrichment.tsx:209-217); honest «(تُعرض أول N)» (:146-148); edit-publish confirms like unedited (:278-289); TableSkeleton (:168-170) + FetchErrorCard w/ retry (:174-186); dead `panel_url` removed (:73-75) |
| **ProductVariantsDialog label pairs (F4)** | **HELD** | 7 `htmlFor`↔`id` pairs (ProductVariantsDialog.tsx:414-523) |
| **StockoutRiskPanel dead `?highlight` link + aria-expanded (F9)** | **HELD** | aria-expanded :221-222; the dead-link CTA deleted (deletion-beats-addition, comment :341-346) |
| **whatsapp display-layer honesty (I5)** | **HELD** | first-load-only skeleton + silent refresh via `hasLoadedRef` (whatsapp.tsx:120-151); pair-code staleness cue after 120 s (:88, :159-176, :549-578); action errors as toasts near the pressed button; aria-labels on all inputs |
| **promotions verb disambiguation (F6) + 30-day client bound + Arabic default title (F21 parts)** | **HELD** | delete: «حذف العرض نهائياً؟ / حذف نهائي / تم حذف العرض» (promotions.tsx:272-286, :589-590); pause keeps «إيقاف»; `MAX_DURATION_MS` client check (:80, :160-163); default title «عرض سريع» (:65, :177) |
| Honest caps / aria-pressed chips / selection aria-pressed / plural counts in headers | HELD | products.tsx:1009-1014 + :1473-1477; tickets.tsx:405-407; users.tsx:800-805; chip bars `aria-pressed` across all six pages |
| **users finance gate (R122) on wallet/points** | HELD | `canEditMoney = hasAdminPermission("finance")` (users.tsx:736); fields disabled + honest banner (:1100-1104, :1121-1148); submit disabled for non-finance (:1038) |
| **products search debounce + abort claim** | **TRUE as commented** | debounce (products.tsx:586-589); the generated hook passes `signal` into `customFetch` (api.ts:6899-6900) — React Query aborts the in-flight request on queryKey change. No finding |

**Verified-OK (checked, no finding):** whatsapp/enrichment lack per-page `useAuth` guards but are route-guarded by `AdminProtectedRoutes` (App.tsx:860-865, guard :494-563) and every fetch rides the global 401 interceptor; `useAdminHeaders` is `useMemo`-stable (no whatsapp effect loop); tickets status-filter race is guarded by the queryKey (tickets.tsx:188); layout `openTickets` badge prefers server stats over the page's partial count (layout.tsx:920-922); products 60 s poll bounded (`refetchIntervalInBackground:false`).

---

## B. New findings

### 1. [P2] The R125-I6 socket emits land on a frontend that never invalidates the tickets/risk LISTS — the round's own "byte-matching the orders idiom" is half-done
**Evidence:** backend now emits `admin-stats-update` on ticket reply/status (routes/admin/tickets.ts:259, :297), risk label/bulk-label (routes/admin/risk.ts:357, :438), and users PATCH (:417). The socket handler invalidates only `["/api/admin/stats"]`, `["/api/admin/orders"]`, `["/api/admin/topups"]`, `["/api/admin/users"]` (SocketInitializer.tsx:78-86) — **not** `["/api/admin/tickets", …]` (the tickets list key, tickets.tsx:188) and **not** `["admin-risk-events"]`/`["admin-risk-dashboard"]` (risk-event.tsx:116-117). The reconnect resync handler (:47-53) has the same four-key hole. Worse, the tickets query has **no** `refetchInterval` (tickets.tsx:182-205) and the app disables focus refetch (App.tsx:218 `refetchOnWindowFocus: false`) — the queue's only freshness paths are manual refresh and the acting tab's own mutations.
**Why:** a second admin (or second tab) replying/closing tickets leaves the first operator's queue stale indefinitely while the layout badge (fed by the invalidated stats) updates — the same screen can show «بانتظار ردك» on a ticket another admin already answered, and a badge count that contradicts the visible list. risk-event.tsx:120's comment even claims the socket "has since landed" coverage for risk — it hasn't, for the risk list keys.
**Fix:** add `queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] })` + the two risk keys to `handleStatsUpdate` and the resync handler (4 lines, prefix-matched — the users idiom users.tsx:448-452 already proves the pattern). Effort **S**. Pinned follow-up: extend stats-co-invalidation.test.tsx to the socket path (A4 gap #1 already notes the socket path is untested).

### 2. [P2] whatsapp: a failed FIRST load renders the error banner AND the «لا توجد جلسات بعد» empty state together — the false-empty class R125-I5's skeletons didn't finish killing
**Evidence:** whatsapp.tsx:388-393 renders the `error` banner, then the list branch runs `loading ? skeleton : sessions.length === 0 ? <EmptyState … title="لا توجد جلسات بعد" description="أنشئ جلسة أولى للبدء.">` (:450-451). On a failed first load `sessions` stays `[]` → banner + misleading empty card stack. The banner has no `role="alert"` (B-8 fixed the shared FetchErrorCard, not this hand-rolled one) and no retry button — the only retry is the section-header refresh icon (:429-437), nothing points to it.
**Why:** the exact B5-04 class (an outage/expired session masquerading as a clean state) that products/tickets/users/promotions/enrichment all killed; the I5 pass added the skeleton and toasts but not the error taxonomy.
**Fix:** `sessions.length === 0 && error` → FetchErrorCard (the page already imports the EmptyState idiom; FetchErrorCard is the sibling); `role="alert"` if the banner stays. Effort **S**.

### 3. [P2] users CSV export corrupts its own rows — grouped currency strings inside a comma-joined, unquoted CSV
**Evidence:** `exportUsersCSV` puts `formatCurrency(u.wallet_balance)` / `formatCurrency(u.lifetime_spend)` into cells (users.tsx:774, :777) and joins with bare commas (`r.join(",")`, :781). `formatCurrency` uses `Intl.NumberFormat("en-US")` grouping (utils.ts:17-25) → any value ≥ 1,000 renders `"1,234.50 د.ل"` — the embedded ASCII comma splits the cell into two columns, shifting every field after it for that row. Wallet balances and lifetime spend cross 1,000 LYD routinely (topups are LYD-denominated). No quoting/escaping anywhere in the builder (:757-789).
**Why:** the export exists so the operator can read balances offline; a mid-table column shift silently mis-attributes money per row.
**Fix:** quote every cell (`"…"`, doubling embedded quotes) or export raw numbers (`u.wallet_balance.toFixed(2)`) and keep د.ل out of the cells. Effort **S**. Also: the button exports only the loaded + tier-filtered window with no scope hint — add the users «ضمن المعروض» wording (:888 recipe) while there.

### 4. [P2] tickets: category filter produces a false-empty AND hides the only way out — the exact partial-empty class users got fixed for in R125-I4, tickets didn't get the mirror
**Evidence:** `visibleTickets` is a client-side category filter over the accumulated pages (tickets.tsx:373-376). When it yields 0 while `hasNextPage` is true (matches exist on unloaded pages — needs only >100 tickets in the queue), the render chain hits the hard empty state «لا توجد تذاكر / ستظهر تذاكر الدعم هنا» (:496-501) and the load-more button is **inside the non-empty branch** (:577-584) — so the operator is told the category is empty with no path to the pages that contain it. The `?category=` URL filter (:275-278) makes the dead-end shareable.
**Why:** the A1-7 class R125-I4 fixed on users (`tierFilter && hasNextPage` → partial-empty block with load-more + «قد تكون النتائج غير مكتملة», users.tsx:1309-1330) — the tickets twin was missed. The unfiltered empty and the search-empty are honest; only the category path lies.
**Fix:** mirror the users partial-empty block (condition: `categoryFilter && hasNextPage`). Effort **S**.

### 5. [P2] users: a points-only edit skips the money confirm the code's own comment promises — points are LYD-convertible (100:1)
**Evidence:** the wallet confirm (with resulting-balance preview) is gated `if (walletValue !== null)` (users.tsx:580) — while the comment above it says "money adjustment requires an explicit confirmation BEFORE the PATCH fires" (:576-579). A points-only change (empty wallet field, edited `loyalty_points`) fires the PATCH with no confirm — only the ≥3-char note gate. The dialog itself states points are money: «القيمة بالدينار: {…} (كل 100 نقطة = 1 د.ل عند التحويل)» (:1234-1239).
**Why:** the console-wide rule (R125-A2 §A: "every mutation confirms where money moves") — a fat-fingered 100,000-point set (= 1,000 د.ل) lands in one unconfirmed tap; every adjacent money path (wallet edit :598-604, referrals credit, topup approve) confirms.
**Fix:** run the same confirm when `pointsChanged` with the point delta + LYD equivalent in the message. Effort **S**.

### 6. [P3] whatsapp: the QR image got none of the staleness care the pair code got in R125-I5 — an expired QR sits on screen indefinitely
**Evidence:** whatsapp.tsx:597-608 renders `qrImage` (from `POST …/qr`, :272-296) with no TTL cue; openwa QR codes expire/rotate on the WhatsApp-web cadence (faster than the 2-minute pair code). The pair-code block right above it dims at 120 s and says «انتهت صلاحية الرمز على الأرجح — أعد إصدار رمز جديد» (:573-577) — the QR twin of A3-12 was missed.
**Fix:** stamp `qrIssuedAt` on load, reuse the dim + hint (the R125-I5 pattern is 15 lines, copy-paste). Effort **S**.

### 7. [P3] whatsapp: transitional session statuses never update — the pairing flow's own copy says "wait for «جاهزة»" but the badge is frozen until a manual refresh
**Evidence:** STATUS_META carries `authenticating/connecting/initializing/qr_ready` (whatsapp.tsx:68-76); `loadSessions` runs only on mount and after each action (:153-155, :218, :259…). After «تشغيل», the row shows «جارٍ الاتصال» and stays there — the operator must know to click the header refresh icon (:429-437) to discover readiness; nothing on the page says so.
**Fix:** poll (5–10 s) while any session status ∈ transitional set, stop when all are terminal (`ready/disconnected/failed`); or a «حالة الجلسة لا تتحدث تلقائياً — اضغط تحديث» hint. Effort **S/M**.

### 8. [P3] promotions: the create form's default end time is frozen at MODULE-LOAD time — a long-lived tab serves a stale (eventually past) default
**Evidence:** `EMPTY_FORM.ends_at` is computed once at module scope (promotions.tsx:68-73) and reused by `useState` (:96), post-create reset (:202), and cancel reset (:449). A tab open 3 h offers "now+21h" as untouched default; a tab open >24 h offers a PAST default that then trips the 5-minute-floor toast (:153-156) — for a form the operator never edited. Admin tabs live for days in this console.
**Fix:** seed `ends_at` on form OPEN (the #new-hash/openCreateFromHash recipe), keep EMPTY_FORM for the other fields. Effort **S**.

### 9. [P3] products: `bulkToggleActive` counts out-of-window skipped rows as successes — and the lookup that skips them uses a dead variable
**Evidence:** products.tsx:953-955 — `const p = products.find((pr) => pr.id === id); if (!p) continue;` inside the loop; `p` is never used again (the PATCH body is `{is_active: active}` by id). Rows selected under one search and toggled after the window changed are silently skipped, then `summarizeBulk(…, selectedIds.size, failures)` (:984) computes `successCount = total − failures` — skipped ids count as succeeded: «تم التفعيل 10 منتجات» after 7 PATCHes. `bulkDelete` has no such guard (:911-936) — asymmetric.
**Fix:** delete the two lookup lines (pure deletion — the PATCH needs only the id); or record skips as failures. Effort **S**.

### 10. [P3] products: Ctrl+S bypasses native validation — an empty name / NaN price rides to the server's 400
**Evidence:** the shortcut dispatches `new Event("submit", …)` on the form (products.tsx:735-740). Programmatic `dispatchEvent("submit")` does NOT run constraint validation (only `requestSubmit()` does) — so ⌘S with an empty required `name` (required, :1142) or empty `price` (parseFloat("") → NaN → `null` in JSON) submits a doomed body and toasts the raw zod error, while the mouse path (type=submit) validates and focuses the field. The header advertises the shortcut (:1103-1105).
**Fix:** `form.requestSubmit()` — one line, keeps ⌘S semantics identical to the button. Effort **S**.

### 11. [P3] products: create/update/archive error toasts lead with English — raw `ApiError.message` instead of the console's `getErrorMessage` mapping
**Evidence:** products.tsx:654-660, :675-681, :692-698 — `description: err instanceof Error ? err.message : "فشلت العملية"`. The generated client throws `ApiError` whose message is `"HTTP 400 Bad Request: <backend Arabic>"` (custom-fetch.ts:220-241 `buildErrorMessage` — English status prefix by construction). `getErrorMessage` maps `err.data.code` → clean Arabic (errors.ts:149-166) and is the idiom everywhere else on this page (bulk loops :929, :976) and lane (users :700, promotions :192).
**Fix:** `description: getErrorMessage(err)`. Effort **S**.

### 12. [P3] Pluralization stragglers on four of the six pages — `formatCount` is imported on every one of them
**Evidence:** tickets «{t.reply_count} ردود» → «1 ردود» (tickets.tsx:560); users mobile «{user.order_count} طلب» (users.tsx:275) and products «{product.order_count} طلب» (products.tsx:437); promotions «{sales.length} عرض/عروض» two-form guess (promotions.tsx:466-468); products filters footer bare `{filtered.length} منتج` (:1466). Header counts on the same pages already use `formatCount` (tickets :406-407, users :802, products :1011-1014).
**Fix:** mechanical `formatCount` swaps. Effort **S**.

### 13. [P3] Raw-hue survivors beyond the documented alerts/system tail — the A6 B-4 light-theme class on five of six pages
**Evidence (all still raw `-400`-family inks at HEAD):** users stat strip `text-blue-400 / cyan-400 / emerald-400 / purple-400` (users.tsx:949-978) + dialog spend value `text-emerald-400` (:1082); tickets close `text-emerald-400` (:627) + reopen `text-blue-400` (:640) — action buttons, not decoration; products inline-stock save `text-emerald-400` (:228), stock count `text-orange-400/text-emerald-400` (:427), low-stock header `text-orange-400` (:1021); promotions active pill `text-emerald-400` (:524) + expired pill `text-amber-500` (:529). A6 B-4 computed this family at 1.4–2.9:1 on the light theme; the R125 sweep fixed ~25 `text-primary` sites and documented only alerts/system residuals — these were neither swept nor documented.
**Fix:** `--status-*` ink+tint pairs (the StatusBadge idiom) for the semantic ones; the users stat strip can keep four DISTINCT hues if they're `dark:`-paired or tokened. Effort **M** (mechanical, ~10 sites).

### 14. [P3] users: the tier-pill AA fix (A6 B-4) migrated the DESKTOP row only — mobile card and both dialog snapshots still ride the old raw map
**Evidence:** desktop row uses `StatusBadge` + `TIER_TONE` (users.tsx:233-235, fixed R125-I4); the mobile card (:273), the dialog snapshot (:1063) and the dialog tier value (:1251) still call `tierColor()` — whose map (utils.ts:131-139) still contains `text-amber-600` (bronze), the exact 2.86:1 entry B-4 listed as failing. Mobile admins (the 375px layout this console explicitly supports) get the un-migrated AA failure.
**Fix:** reuse `TIER_TONE` + StatusBadge (or the same tokens as text classes) at the three sites. Effort **S**.

### 15. [P3] tickets: the header pills «N نشطة» / «N بانتظار ردك» count only the loaded pages — presented as global counts beside an honest «عرض N»
**Evidence:** `openCount`/`pendingCount`/`awaitingReplyCount` filter the accumulated `tickets` array (tickets.tsx:358-372) — with 3 loaded pages they're partial, and unlike the layout badge (which prefers server `open_tickets`, layout.tsx:920-922) these pills have no server source. The count line right below honestly says «عرض N (الأحدث أولاً)» (:405-407) — the pills above it don't qualify.
**Fix:** cheap: qualify the pills («ضمن المعروض») or move `awaitingReplyCount` to a server stat; right: backend `pending_count` in the list meta (bigger, later). Effort **S**.

---

## C. Residual ledger — R125-A2 reported, still open in this lane (not re-argued, kept honest for the tracker)

| R125-A2 finding | Status at 186b131 | Evidence |
|---|---|---|
| F12 (manual refresh blanks lists) | **OPEN (promotions)** | `load()` unconditionally `setLoading(true)` (promotions.tsx:116) — header refresh collapses the history to 3 skeletons (:471-476); the silent-refresh argument exists nowhere on this page |
| F14 (Esc discards dirty editor; Esc leaks through Radix dialogs) | **OPEN** | window-level Esc → `cancelForm()` with no dirty check (products.tsx:734-745, :851-856); fires while InventoryUploadDialog/ProductVariantsDialog/ConfirmDialog are open over the editor |
| F15 (dismissal semantics split) | OPEN | products `cancelForm` wipes (:851-856); promotions «إلغاء» wipes (:447-450); coupons preserves |
| F19 (enrichment polish) | **OPEN** | no success toast on publish/reject (enrichment.tsx:248-253, :262-263 — card silently vanishes); no dirty guard on the edit textarea (:317-324); one `useConfirm` provider per DraftCard (:239) — 25 cards = 25 dialog trees |
| F21 (promotions busy guards) | **PARTIAL** | 30-day bound + Arabic default + verb split landed (I3); `toggleActive`/`handleDelete` still have no per-row in-flight guard (promotions.tsx:216-262, :264-296) — double-click delete double-toasts (success + 404) |
| Editor-reset paths discard dirty work silently (F14-adjacent nuance) | OPEN | `#new` hashchange (products.tsx:557-566) and the header «منتج جديد» button (:1030-1037) reset `form` to EMPTY_FORM with no dirty check — a mid-edit tap on the layout context action loses the edit |

Out-of-scope pages' R125-A2 items (pricing race F11, referrals F7/F8/F13, coupons F16/F17, sorting F22) — untouched by this audit, still open per the R125 report.

---

## D. Summary

**New findings: 15 — P0: 0 · P1: 0 · P2: 5 · P3: 10** (+6 residual rows §C). R125's own fixes on this lane all verified HELD, including the SEO end-to-end chain and the users half of the stats co-invalidation; the one contract break is that the tickets/risk halves of R125-I6's socket emits were never wired frontend-side (Finding 1) — precisely the cross-lane handoff the round's changelog claims as closed.

### Prioritized fix list (ponytail — deletions first)

1. **Finding 1 (socket keys)** — 4 lines in SocketInitializer.tsx (tickets + 2 risk keys, both handlers). The only cross-tab/multi-admin correctness item; S.
2. **Finding 9 (dead lookup)** — delete two lines in products.tsx; kills a false-success count; S.
3. **Finding 10 (requestSubmit)** — one-line swap; restores validation parity for the advertised shortcut; S.
4. **Finding 3 (CSV quoting)** — quote cells or export raw numbers; S.
5. **Finding 5 (points confirm)** — extend the existing confirm gate to `pointsChanged`; S.
6. **Finding 4 (tickets partial-empty)** — copy the users.tsx:1309-1330 block; S.
7. **Finding 2 (whatsapp error taxonomy)** — FetchErrorCard branch + role="alert"; S.
8. **Findings 6+7 (whatsapp QR staleness + status polling)** — one whatsapp commit, both ride loadQr/loadSessions; S/M.
9. **Findings 8, 11, 12, 15** — copy/polish batch (stale default, error mapping, plurals, pill qualification); S each.
10. **Findings 13+14** — the raw-hue/tier-token tail on this lane; M, mechanical.
11. §C residuals — fold F12/F21 into the next promotions commit; F14/F15/F19 remain the lane's known UX-debt cluster.
