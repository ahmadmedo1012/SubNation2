# R126-A4 — Admin Data Layer + API Contract Completeness Audit

**Agent:** R126-A4 (READ-ONLY audit; only this report file + one worklog entry created)
**Repo state:** `main @ 186b131`, clean tree. **Predecessors:** `docs/inspection-r125/A4-admin-data-layer.md` (raw-fetch B-1, SEO B-2, co-invalidation B-3, chart abort B-4, honesty B-6, spec blind spot B-7, over-fetch B-8) + `docs/inspection-r125/A8-backend.md` §C (105 admin-family endpoints, 70 absent). This round goes deeper on seven axes: raw-fetch remainder at HEAD, the batch-1 OpenAPI exposure plan, 401-coherence, the full mutation→invalidation matrix, pagination honesty, generated-client drift, and a new key-shape/cache-defaults audit.

**Method:** static analysis only — ripgrep sweeps + full reads of every fetch/invalidation/pagination site across the 21 admin pages (~20k lines) and their backend routers, the R125 implementation diffs (`75f6b68`, `7e4d27a`, `a8d688c`, `d604e67`, `186b131` vs the R125-audit base `09857fc`), `shared/api-client-react/src/{custom-fetch.ts,generated/api.ts,generated/api.schemas.ts}`, `App.tsx`, `SocketInitializer.tsx`, `lib/admin-session.ts`. No orval run, no builds, no test suites (per hard rules); 4 guest-level live GETs to subnation.ly (all admin endpoints correctly 401 at the edge). Cross-lane overlap: R126-A2's finding 1 (socket key-set) is independently re-derived and confirmed here with the data-layer framing.

---

## A. Verified-held — R125 implementation claims that HOLD at HEAD

| # | Claim (R125 impl) | Evidence at 186b131 |
|---|---|---|
| A-1 | SEO editor displays existing overrides end-to-end (A4 B-2 / A2-3) | BE projection `routes/admin/products.ts:106-113` (seoTitle/seoDescription in select) + `:199-203` (snake_case round-trip); spec `openapi.yaml:5455-5470` (both nullable props); regen landed in the SAME commit `a8d688c` (`api.schemas.ts` +14, `api-zod/api.ts` +36); FE seeds from the row |
| A-2 | Dashboard chart abort-guard + single-fire refresh (A4 B-4) | `dashboard.tsx:493-498` (AbortController + `signal` on the chart fetch, stale-drop at `:509`), `:548-558` (`handleRefresh` = 2 invalidations + `fetchChart`, the manual `refetch()` is GONE) |
| A-3 | Tickets + alerts MAX_PAGE ceilings (A8 B-5) | `routes/admin/tickets.ts:60-67` + `routes/admin/alerts.ts:36-40` both call `pageParam()` (floor 1, ceiling 10 000, `lib/http.ts:69-74`); limit clamps stay inline with a byte-compatibility rationale |
| A-4 | Risk events hasMore cursor (A4 B-6) | `risk.tsx:126-152` — accumulating `useInfiniteQuery` keyed `["admin-risk-events","load-more",{level}]`, `getNextPageParam: lastPage.next_cursor ?? undefined`; counters via separate `["admin-risk-events","all"]` window query (`:176`) |
| A-5 | Security timeline honesty + race guard (A3-5) | `security.tsx:48-52` (`ACTIVITY_WINDOW_CAP = 100` constant + honest «عرض N (الأحدث أولاً)» wording at `:385-386`); `:133-141` seq + AbortController race guard on the activity fetch |
| A-6 | Referrals 200-cap hint (A2-5) | `referrals.tsx:74-79` (`REFERRALS_SERVER_CAP`) + `:627-630` honest window wording |
| A-7 | Enrichment cursor load-more (A2-1) | `enrichment.tsx:96-114` (`useInfiniteQuery` on `next_cursor`), hidden exactly when cursor is null (`:207-208`) |
| A-8 | users/tickets/risk-event frontend stats co-invalidation (A4 B-3, 3 of 4 arms) | `users.tsx:684-692`, `tickets.tsx:310` + `:341`, `risk-event.tsx:109-125`; pinned by `__tests__/stats-co-invalidation.test.tsx` (users + tickets describes) and BE `admin-stats-emit.test.ts` (5 emits) |
| A-9 | Backend emits: tickets ×2, users ×1, risk ×2 (R125-I6) | `routes/admin/tickets.ts:259` (`ticket-reply`), `:297` (`ticket-status-update`); `routes/admin/users.ts:417` (`user-update`); `routes/admin/risk.ts:357` (`risk-label`), `:438` (`risk-bulk-label`) — plus pre-existing orders `:568/:703`-family (`routes/admin/orders.ts:568,703`) and topups (`services/topup.service.ts:201,619,685`) |
| A-10 | QueryClient defaults unchanged and disciplined | `App.tsx:202-226` — `staleTime 60_000`, `gcTime 5 min`, retry 1× retryable-only (`isRetryableQueryError` at `:258-260`: TypeError or 5xx — **4xx never retried**), `refetchOnWindowFocus/Reconnect: false`; no mutation retry defaults |
| A-11 | Live edge 401 discipline | guest GETs: `/api/healthz` → 200, `/api/admin/stats|alerts|referrals` → 401 (no body leak) |

---

## B. Findings (P0–P3)

### B-1. [P2] `referrals.tsx` list GET is the console's LAST silent-401 — an expired session renders an Arabic error card instead of the login redirect

**Evidence:** `referrals.tsx:262` (`fetch(/api/admin/referrals?…)`) has **no** `isAdminUnauthorized` check — the page imports it (`:9`) but uses it only on the credit POST (`:379`). A 401 falls into the `!r.ok` branch (`:268-277`) → `setLoadError("فشل تحميل الإحالات (HTTP 401)")` → error card, no redirect; the operator can hammer «إعادة المحاولة» forever. Every other raw/adminFetch site in the console redirects (verified site-by-site in §C). This was already true at `09857fc` — R123's 56-conversion sweep and R125-A4's B-1 table both missed it (the R125 table even flagged *security* as the 401 holdout, but security.tsx:110/:145 both carry `isAdminUnauthorized` — the real gap was next door).
**Impact:** coherence break only (no data exposure — 401 leaks nothing); 1-line fix. **P2** because it breaks the console's documented uniform 401 contract on a finance-adjacent page (referral credit lives here).
**Fix:** add `if (isAdminUnauthorized(r, url)) return;` before the `!r.ok` branch in `fetchData` (`referrals.tsx:267`), matching the credit handler 100 lines below. Effort **S**.

### B-2. [P2] Products family still leaves `/admin/stats` stale after every catalog write — the 4th B-3 arm was NOT closed, and commit `a8d688c`'s message overclaims it

**Evidence:** `available_stock`/`unsold_rows` are stats fields (`routes/admin/stats.ts:127-131`; spec `openapi.yaml:5291-5295`). Every products write path invalidates ONLY the products list key (`products.tsx:638` `invalidate = getListAdminProductsQueryKey()`; onSuccess at `:646/:667/:688`, bulk loops `:940/:986`, stock set-count via `stockEditDone :792`, variants dialog via `onChanged :1555`) — **no `["/api/admin/stats"]` invalidation anywhere in products.tsx or `ProductVariantsDialog.tsx`** (grep-verified), and **no backend emit**: `emitToAdmins` exists in only 4 admin route files + topup.service (orders/tickets/risk/users — `rg emitToAdmins backend/src` exhaustively); `routes/admin/products.ts` has zero hits. Yet commit `a8d688c`'s message says "admin-stats-update socket emits for tickets status/reply, users PATCH, risk-event label, **products mutations**" — the products claim is false in code (the commit's products.ts diff is SEO-projection only, +13 lines). The R125-I6 test file confirms the real set: 5 tests = tickets ×2 + users ×1 + risk ×2 (`admin-stats-emit.test.ts:187-302`), no products case.
**Impact:** after any product create/update/archive/bulk-toggle/stock-set/variant write, the dashboard + layout stats (`available_stock`, `unsold_rows`) lag up to 300 s (stats poll) / 30 s (server cacheWrap). Single-operator nuisance, not money.
**Fix:** (a) one line in `products.tsx` `invalidate()`: also `invalidateQueries({queryKey: ["/api/admin/stats"]})` — this covers ALL products/variants/stock paths at once since they all funnel through it; (b) correct the a8d688c claim in the R125 CHANGELOG entry (docs truth), or land the missing `products` emit (5 more backend lines, mirroring tickets) if cross-tab freshness is wanted. Effort **S**.

### B-3. [P2 → planned] OpenAPI covers 35 of 105 admin-family endpoints — the 70-absent count VERIFIED at HEAD; batch-1 exposure plan in §D

Re-derived from source at HEAD (not inherited): 94 route defs in `backend/src/routes/admin/` + 9 copilot + 2 `/admin/settings/auth` = **105 admin-family endpoints**; spec admin ops = **35** (24 admin paths; method-by-method tally matches A8 §C exactly — `openapi.yaml:1940-3936` family); **absent = 70**. The spec's only HEAD delta since the R125 audit is the AdminProduct SEO pair (`:5455-5470`, a8d688c). Everything in §C (raw-fetch tail) and §D (batch 1) hangs off this gap. Severity stays **P2** (contract blind spot: no generated bindings, no contract-suite rows, drift gate blind to ⅔ of the admin surface) — the remediation is now scoped and sequenced (§D).

### B-4. [P3] Raw-fetch migration made ZERO progress in R125 — still 18 sites / 11 pages, 7 ready-to-migrate (one R125 table entry mislabeled)

Full enumeration at HEAD in §C. The R125 implementation lane fixed B-2/B-3/B-4/B-6 arms but none of B-1's steps: `git diff 09857fc..186b131` shows no fetch→generated/adminFetchJson conversion on any of the 18 sites (the only raw-fetch motion is dashboard's abort signal added to its existing fetch). Also corrected: R125's B-1 row "`promotions.tsx:214 DELETE /api/admin/flash-sales/:id`" was actually a **PATCH is_active toggle** at 09857fc:214 (the DELETE already rode `adminFetchJson`); at HEAD the same toggle sits at `promotions.tsx:232` with generated `updateFlashSale` (`api.ts:6576`) available — still READY-TO-MIGRATE, just under the right verb. Batch plan in §C. Effort **M** (the 7-site batch ≈ ½ day).

### B-5. [P3] `admin-stats-update` socket handler's key-set predates the 3 new emit families — tickets + risk lists don't refresh on other tabs

`SocketInitializer.tsx:81-85` invalidates exactly `["/api/admin/stats"|"/api/admin/orders"|"/api/admin/topups"|"/api/admin/users"]`. The R125-I6 emits added tickets reply/status (`tickets.ts BE :259/:297`) and risk label/bulk-label (`risk.ts BE :357/:438`) — but no `["/api/admin/tickets"]`, `["admin-risk-events"]`, or `["admin-risk-dashboard"]` invalidation exists anywhere in the socket path. Tickets has **no polling** (`tickets.tsx:188-211` — no refetchInterval; `refetchOnWindowFocus:false` globally) and risk-events has none either (only the dashboard sub-query polls 30 s, `risk.tsx:113`), so admin B's queue after admin A's reply stays stale until a manual refresh — and the layout badge (socket-refreshed stats `open_tickets`) can contradict the visible stale list. Independently found by R126-A2 (their finding 1); re-confirmed here with the no-poll amplification. **Fix:** 3 lines in `handleStatsUpdate` keyed off the emit `type` (or blanket-add the 3 keys — 1-3 operators, cost negligible). Effort **S**. (Also: the comment at `SocketInitializer.tsx:61-62` still says the backend emits only from "topup approve/reject + order bulk updates" — stale doc, fix in passing.)

### B-6. [P3] GlobalSearch over-fetch (R125 B-8) unfixed — full 200-row product payloads (with variant trees) still fetched to render 4 lines

`layout.tsx:445-451` still calls `/api/admin/orders?search=`, `/users?search=`, `/products?search=` with **no `limit`**; the products route still hard-codes `.limit(200)` with no limit param (`routes/admin/products.ts:128`) and embeds full variant trees. Worst case per keystroke-pause ≈ 300 full rows to render 12 (products rows ≈ variant-tree heavy; ~100 KB class). Orders/users already accept `limit` — the frontend just doesn't send it. **Fix:** `&limit=5` on all three + (optional, M) a clamped `?limit=` on the products route. Effort **S** for the frontend half.

### B-7. [P3] Referrals post-LIMIT search semantics (R125 B-6 arm) still open

`routes/admin/referrals.ts:58` still `LIMIT 200` with the `?search=` filter applied **in JS after the LIMIT** (`:97-101`) — a search for an older referrer outside the newest 200 silently misses. The frontend hint (`referrals.tsx:74-79`) discloses the window cap but not that *search* is scoped to it. **Fix:** move the filter into SQL (ILIKE over the joined phones — the users.phone trigram GIN index already exists, `schema/users.ts:84`) or document the search window in the hint. Effort **S/M**.

### B-8. [P3] Harmless double-invalidation: `["admin-alerts"]` prefix subsumes `["admin-alerts-unread-count"]` at 2 sites

`SocketInitializer.tsx:90-91` and `alerts.tsx:240-241` invalidate both keys; React Query prefix matching means the second call is fully covered by the first (`["admin-alerts"]` matches `["admin-alerts","inbox"]` AND `["admin-alerts-unread-count"]`). Same-tick invalidations coalesce — zero runtime cost — but it misleads readers into thinking the keys are disjoint and would mask a future rename. **Fix:** drop the redundant second line at both sites (or keep one with a comment). Effort **S** (comment-level).

### B-9. [P3] Generated-mutation `onError` handlers double-surface session expiry (the quiet-catch convention covers raw sites, not hook sites)

Raw/adminFetch paths all quiet-catch `AdminSessionExpiredError` (verified: alerts `:276/:301/:327/:341/:354`, tickets `:243/:315/:347`, coupons, admins, whatsapp, pricing's raw half `:470`). But generated-hook mutations ride customFetch, which fires the global toast+redirect observers (`custom-fetch.ts:611-628`) **then throws ApiError** — and these `onError` handlers toast `err.message` unconditionally: products `useCreate/Update/DeleteProduct` (`products.tsx:654-659/675-680/692-697`), pricing `useUpdateAdminPricingConfig` (`pricing.tsx:393-398`) + `useRecomputeCatalogPrices` (`:439-444`), variants dialog ×3 (`ProductVariantsDialog.tsx:143-149/160-166/177-186`). On a mid-work 401 the operator gets the global «انتهت الجلسة» toast + a second red toast (ApiError carries the backend 401 body). Also enrichment's hand `onError: setError(e.message)` ×2 (`enrichment.tsx:252/:263`) renders the session-expired Arabic string into the panel. **Impact:** cosmetic duplicate noise during the redirect. **Fix:** guard `err instanceof ApiError && err.status === 401` (or duck-type `status`) → silent return; 8 sites. Effort **S**.

### B-10. [P3] `healthz/ready` 401 → silent «degraded» (documented deviation from the 401 contract)

`system.tsx:450-461` maps ANY non-ok-except-503 (incl. 401/403) to `{status:"degraded"}` with an explicit comment ("401/403 here means token expired — treat as degraded silently"). Deliberate and defensible (the panel is a liveness readout, and a redirect from the System tab mid-diagnosis is worse), but it is the one fetch path where an expired session does NOT hand off to `handleAdminUnauthorized`. Recording as a coherence NOTE with the recommendation to keep + re-comment in Arabic-intent terms, or fire the observer without the local error state. No change required.

### B-11. [P3] Key-shape nits: near-miss detail/list key names; no wrong cross-invalidation found (mandate 7 verdict)

Full sweep of every `queryKey` literal + generated key fn across the 21 pages & shared components:
- **No collisions that cross-invalidate wrongly.** Every shared base (`["/api/admin/stats"|"orders"|"topups"|"users"]`, `getListAdmin*QueryKey()` URL-first prefixes vs hand `[…,"load-more",params]` second-segment discriminators, `["admin-alerts", …]`, `["admin-risk-events", …]`, `["admin-enrichment-list", …]`) is either same-data sharing (intended) or disjoint by construction (element 2 differs — a params object can never equal the string `"load-more"`/`"inbox"`/`"all"`).
- **Near-miss hazard:** detail `["admin-risk-event", id]` (`risk-event.tsx:94`) vs list `["admin-risk-events", …]` (`risk.tsx:144/176`) — one character apart, no current overlap (different first-element strings), but a rename to `"admin-risk-event"` (plural) on one side would silently couple detail invalidations to the list. Recommend renaming the detail key to `["admin-risk-event-detail", id]` when next touched. **S.**
- **One-char-sibling #2:** `["admin-alerts"]` (list family) vs `["admin-alerts-unread-count"]` — intentionally coupled (that's the design), see B-8 for the redundant half.
- **Storefront↔admin isolation verified:** `getListTopupsQueryKey` (storefront `/api/wallet/topups` family: wallet.tsx, TopupWaitingModal, SessionActivityManager) never collides with `getListAdminTopupsQueryKey` (`/api/admin/topups`) — distinct URLs, distinct keys.
- **staleTime/gcTime effect on admin freshness (mandate 7):** 60 s stale + 5 min gc + no focus/reconnect refetch (`App.tsx:202-226`) means back-navigation within 60 s serves cache silently; beyond that, mount refetch; freshness otherwise rides the per-page intervals (60 s products, 300 s orders/topups/users/dashboard/layout, 20 s alerts inbox, 30 s risk dashboard, 15-90 s system) + socket events. The demoted-300 s family is documented per-site; `refetchOnWindowFocus:false` is a deliberate mobile-data choice (comment `:218-226`). **Verdict: coherent, documented — no change.**
- **Retry semantics on 4xx (mandate 7):** `isRetryableQueryError` (`App.tsx:258-260`) retries ONLY TypeError + 5xx — every admin 4xx (400/401/403/404/409/429) fails fast into error states; mutations have no retry default (money-safe). The cold-start 503 boot-gate retry is request-level inside customFetch (bounded, side-effect-free POST-safe — `custom-fetch.ts:627-639`). **Verdict: correct as designed.**

### B-12. [P3] Spec cannot express `?dry_run=true` on `/admin/pricing/recompute` — pricing keeps a hand-rolled preview fetch

`pricing.tsx:405-407` documents it: the generated hook's codegen URL builder takes no query params, so the dry-run preview rides `adminFetchJson` (`:452-458`) while the real run uses `useRecomputeCatalogPrices`. 401-safe (adminFetchJson), but the preview response (variants_drifted/sample envelope) is contract-unpinned. **Fix:** add the optional `dry_run` query param + preview response schema to the existing `/admin/pricing/recompute` spec entry (the path is already spec'd — this is a param widening, not a new path), regen, migrate the preview to the generated fetcher. Effort **S**. (Fold into §D batch 2.)

### B-13. [P3] Data-layer test gaps carried from R125-A4 B-10, minus what R125 landed

Still unpinned at HEAD: (1) the PRIMARY `admin-stats-update` socket handler invalidation set has no test (only the RESYNC fallback is pinned — `socket-initializer-resync.test.tsx:85-95`); B-5's fix would land with a pin here; (2) no test pins the infinite-key SHAPE `["/api/admin/tickets","load-more",…]` etc. (a dropped URL-first prefix would sever every socket/page invalidation silently); (3) no test pins users-save per-intent idempotency-key retention (`IDEMPOTENCY_IN_FLIGHT` keep / success clear); (4) no cadence pins. R125 landed pins for: stats co-invalidation (users/tickets), risk label co-invalidation, risk load-more, dashboard chart race, security honesty, alerts delete-confirm, global-search abort. Effort **S each**, ride §C/§D batches.

---

## C. Raw-fetch remainder at HEAD — the exact 18 + classification + migration batch plan (mandate 1)

`rg --pcre2 '(?<![\w.])fetch\(' frontend/src/pages/admin/*.tsx` at 186b131 = **19 hits, one a comment** (`system.tsx:432`), so **18 live call sites across 11 pages** — identical count to R125's B-1, zero migrations since. 10 pages remain fetch-free (admins, alerts, coupons, enrichment, layout, pricing, risk, risk-event, tickets, whatsapp).

| # | Site | Endpoint | Generated equivalent (api.ts) | Classification | Migration note |
|---|---|---|---|---|---|
| 1 | orders.tsx:587 | GET `/admin/orders/:id/credentials` | `getAdminOrderCredentials` :5712 | **READY-TO-MIGRATE** | keep the local Map cache + `isAdminUnauthorized`→`ApiError.status===401` catch; S |
| 2 | orders.tsx:812 | PATCH `/admin/orders/bulk-status` | `bulkUpdateOrderStatus` :5862 (207 union already generated) | **READY-TO-MIGRATE** | keep `withIdempotencyKey(jsonHeaders, key)` header threading + 207 partial-body branch; S/M |
| 3 | products.tsx:914 | DELETE `/admin/products/:id` (bulk loop) | `deleteProduct` :7203 | **READY-TO-MIGRATE** | per-item loop stays; 401 break becomes `err.status===401`; S |
| 4 | products.tsx:958 | PATCH `/admin/products/:id` is_active (bulk loop) | `updateProduct` :7098 | **READY-TO-MIGRATE** | same idiom as #3; S |
| 5 | promotions.tsx:232 | PATCH `/admin/flash-sales/:id` is_active toggle | `updateFlashSale` :6576 | **READY-TO-MIGRATE** | (R125 mislabeled this row as DELETE; the DELETE at :283 already uses adminFetchJson) S |
| 6 | referrals.tsx:366 | POST `/admin/referrals/:id/credit` | `creditReferral` :6776 | **READY-TO-MIGRATE** | keep per-click idempotency key; S |
| 7 | users.tsx:640 | PATCH `/admin/users/:id` | `updateAdminUser` :8309 (options incl. headers) | **READY-TO-MIGRATE** | MUST preserve the per-INTENT key retention verbatim (keep on `IDEMPOTENCY_IN_FLIGHT`, clear on terminal — `users.tsx:669-670`); S/M |
| 8 | topups.tsx:957 | POST `/admin/topups/:id/{approve,reject}` (bulk loop) | `approveTopup`/`rejectTopup` :6117/:6231 | READY-DEFERRED | per-item keys + mid-loop 401 break; error shape flips Response→ApiError; M — do with #9 when the file is next touched |
| 9 | topups.tsx:1053 | POST `/admin/topups/:id/approve` (approve-all loop) | `approveTopup` :6117 | READY-DEFERRED | same as #8 |
| 10 | referrals.tsx:262 | GET `/admin/referrals` | none — **path absent from spec** | **NEEDS-SPEC-FIRST** | §D batch-1 #17; also carries the B-1 silent-401 — patch the 401 NOW regardless of spec |
| 11 | security.tsx:110 | GET `/admin/auth-stats/summary` | none — absent | **NEEDS-SPEC-FIRST** | §D batch-1 #15; interim: the hand parse is already 401-correct here |
| 12 | security.tsx:145 | GET `/admin/auth-activity` | none — absent | **NEEDS-SPEC-FIRST** | §D batch-1 #16 |
| 13 | settings.tsx:1151 | GET `/admin/settings` + `/admin/settings/auth` (one loader fn, two URLs) | none — absent | **NEEDS-SPEC-FIRST** | §D batch-1 #12-13; the `"__unauthorized__"` string sentinel can retire once spec'd (AdminSessionExpiredError instead) |
| 14 | system.tsx:438 | GET observability ×3 via `fetchAdminJson` factory (summary / alerts-recent / scheduler) | none — absent | **NEEDS-SPEC-FIRST** | §D batch-2; `"SESSION_EXPIRED"` sentinel idiom is 401-correct |
| 15 | dashboard.tsx:498 | GET `/admin/chart-data?days=` | none — absent | **NEEDS-SPEC-FIRST** | §D batch-1 #14; abort-guard already landed (A-2) |
| 16 | system.tsx:455 | GET `/api/healthz/ready` | `healthCheck` is `/healthz`, not `/ready` | **JUSTIFIED-RAW** | 503 = DATA (degraded checks), not error — a generated hook's `!ok→throw` would destroy the contract; 401→degraded is documented (B-10). Keep-with-reason |
| 17 | login.tsx:53 | GET `/api/admin/probe` | none | **JUSTIFIED-RAW** | pre-auth page — no session for `useAdminHeaders`; cookie round-trip probe |
| 18 | login.tsx:131 | POST `/admin/login/verify-2fa` | none — **deliberately undocumented** (openapi.yaml:3441, api.ts:8423) | **JUSTIFIED-RAW** | pre-auth + anti-enumeration choice; keep |

**Migration batch plan for the implementation lane:**
- **Batch A (day 1, ~½ day, 7 sites — #1-7):** each is a mechanical swap to the generated fetcher inside the existing useMutation/handler, keeping idempotency headers + 401 quiet-catch + Arabic toasts byte-identical. The repo idiom to copy: `topups.tsx:523-536` (generated fetcher inside `useMutation` + `withIdempotencyKey`). Order by risk: #5 (no idem) → #1/#3/#4 → #6 → #2 → #7 (highest care — key retention).
- **Batch B (defer, M):** #8-9 topups loops.
- **Batch C (after §D):** #10-15 — spec exposure first, then each page's loader flips to a generated hook in the same commit family (contract-suite row + drift-gate regen included).
- Keep-with-reason forever: #16-18 (document in the polling-policy/data-layer doc table when B-5's R125 doc follow-up lands).

---

## D. OpenAPI batch-1 exposure plan — 17 endpoints (mandate 2)

**Verified gap at HEAD:** 70 of 105 admin-family endpoints absent (B-3). **Batch 1 = every endpoint whose frontend consumer is raw-fetch / hand-rolled today** (the §C NEEDS-SPEC-FIRST set + the alerts/tickets families that ride hand-shaped calls). Priority inside batch 1 is by traffic: alerts (20 s poll + socket) > tickets (support SLA) > security/chart (dashboard) > referrals/settings (low churn).

| # | Path + method | Frontend consumer(s) | Request schema source | Response schema source | Effort |
|---|---|---|---|---|---|
| 1 | GET `/api/admin/alerts` | alerts.tsx:221 (customFetch, infinite) | query: page/limit (limitParam 50/200 + pageParam — `routes/admin/alerts.ts:36-40`) | `{alerts[], unreadCount, total, page, limit, hasMore}` envelope (`alerts.ts:147-155`; AdminAlert row = `schema/admin_alerts.ts` projection) — already stable + consumed by 3 tests | **S** |
| 2 | GET `/api/admin/alerts/unread-count` | layout.tsx:848-860 (RQ 300 s + socket) | none | `{count}` (`alerts.ts:122-133`) | **S** |
| 3 | PATCH `/api/admin/alerts/{id}/read` | alerts.tsx markRead (optimistic) | none (path id) | `{success}` (`alerts.ts:170-181`) | **S** |
| 4 | PATCH `/api/admin/alerts/read-all` | alerts.tsx markAllRead | none | `{success}` (`alerts.ts:160-168`) | **S** |
| 5 | DELETE `/api/admin/alerts/{id}` | alerts.tsx deleteAlert | none | `{success}` (`alerts.ts:193-211`) | **S** |
| 6 | DELETE `/api/admin/alerts/read` | alerts.tsx deleteRead | none | `{success, deleted}` (`alerts.ts:183-191`) | **S** |
| 7 | DELETE `/api/admin/alerts` | alerts.tsx deleteAll | none | `{success}` (`alerts.ts:213+`) | **S** |
| 8 | GET `/api/admin/tickets` | tickets.tsx:188-211 (infinite) | query: page/limit/status (`TicketStatusFilter` z.enum open/in_progress/closed — `routes/admin/tickets.ts:30-31,58-67`) | plain `TicketSummary[]` array (frozen contract — no total meta; `getNextPageParam` full-page heuristic documented FE-side) | **S/M** |
| 9 | GET `/api/admin/tickets/{id}` | tickets.tsx openTicket | path id (intParam) | thread envelope `{ticket, replies[], has_unread_admin}` (R125-I5 surfaced has_unread_admin) | **S/M** |
| 10 | POST `/api/admin/tickets/{id}/reply` | tickets.tsx:299 | **zod ready**: `AdminReplyBody` `{message: string 1-4000}` strict (`tickets.ts:37-42`) | `{reply}` row (`tickets.ts:208-258`) | **S** |
| 11 | PATCH `/api/admin/tickets/{id}/status` | tickets.tsx:332 | status enum (mirror of `TicketStatusFilter` + FE guard) | updated ticket row | **S** |
| 12 | GET `/api/admin/settings` | settings.tsx:1151 (fetchJsonOrNull) | none | 4 fixed fields `{telegram_configured, platform_name, currency, maintenance_mode}` (`settings.ts:15-22`) — trivial | **S** |
| 13 | GET `/api/admin/settings/auth` | settings.tsx:1151 (second URL) | none | `{providers[]}` — provider meta + masked config (`auth-settings.ts:1153-1174`); the **PATCH `/auth/:id`** sibling has a DYNAMIC per-provider zod builder (`:1189-1199`) → batch 2, M | **S** (GET only in batch 1) |
| 14 | GET `/api/admin/chart-data` | dashboard.tsx:498 (raw, abort-guarded) | query: days 1-365 clamp (`stats.ts:142-143`) | `Array<{date, orders, revenue, users, discounts, coupon_orders}>` (`stats.ts:170-175, 190-196`) — money fields; finance-gated FE-side | **S** |
| 15 | GET `/api/admin/auth-stats/summary` | security.tsx:110 | none | 4 counts (now 1 FILTER query — R125-I6, `security.ts:83-117`) | **S** |
| 16 | GET `/api/admin/auth-activity` | security.tsx:145 (abort+seq) | query: action/success/from/to (validated `security.ts:10-22`) | `{activities[]}` — auth_activity rows w/ PII-lean projection (`security.ts:45-51`) | **S/M** |
| 17 | GET `/api/admin/referrals` | referrals.tsx:262 | query: status/search (search currently post-LIMIT JS — B-7; spec the SQL behavior or document the window) | `{stats{total,credited,pending,total_points}, top_referrers[], list[]}` (`referrals.ts:106-119`) | **S/M** |

Batch-1 totals: **17 endpoints, ~14 S + 3 S/M ≈ 2-3 focused days** (spec authoring + zod-schema mirror + orval regen + one contract-suite row each + flip the page's loader in the same family — see §C batch C). Excluded from batch 1 with reasons: alerts `/new` + `/test` (job/test utilities, no page consumer — batch 2), settings/auth PATCH (dynamic schema — batch 2), observability ×6 + diagnostics ×9 (system tab; batch 2 — includes the 3 raw `fetchAdminJson` sites), risk ×10 (A8 family 2 — kills the local zod perimeters), admins ×6/auth ×7 (lifecycle — family 3), healthz/ready (keep-raw, B-10). Storefront 7 absent (A8) — out of this lane's scope.

**Drift discipline for the lane:** every batch-1 commit must bundle spec edit + `pnpm --filter @workspace/api-spec run codegen` output (CI gate `ci.yml:310-321` fails otherwise) + a contract-suite row (`backend/src/routes/__tests__/` R123 21-endpoint suite pattern) + the page-loader flip where §C lists it.

---

## E. Mutation → invalidation matrix, all 21 pages (mandate 4)

Socket coverage column: does the `admin-stats-update` handler (`SocketInitializer.tsx:81-85`: stats/orders/topups/users — the 4-family blanket) cover the mutation's cross-tab refresh? ✆ = yes (family key in handler), ✆-stats = only the stats key refreshes cross-tab, ✗ = no socket path at all.

| # | Page | Mutations (mech) | Invalidates | Backend emit | Socket covers | Verdict |
|---|---|---|---|---|---|---|
| 1 | dashboard | none (reads; manual refresh = 2 invalidations + chart fetch, `:548-558`) | n/a | — | reads stats/orders ✆ | ✅ single-fire (R125-I2) |
| 2 | products | create/update/delete (generated) `:646/:667/:688`; bulk DELETE `:940`, bulk is_active `:986` (raw); stock set-count `:172`→`stockEditDone :792`; variants ×3 (`ProductVariantsDialog.tsx:142-186`→`onChanged`→invalidate) | products base only (`:638`) | **none** | ✗ (stats NOT covered — B-2) | ⚠ **list ✓, stats ✗ ≤300 s** |
| 3 | orders | bulk-status raw `:812` | orders base `:878` (single fire, A6#11 held) | `order-bulk-update` ×2 (orders.ts BE `:568,:703`) | ✆ orders+stats | ✅ |
| 4 | topups | approve/reject generated `:735/:779`; bulk loops raw `:957/:1053` | topups base `:707-709` | topup-automated/approved/rejected (topup.service BE `:201,:619,:685`) | ✆ topups+stats | ✅ |
| 5 | users | PATCH raw `:640` (per-intent idem key) | users base `:684` + stats `:692` | `user-update` (users.ts BE `:417`) | ✆ users+stats | ✅ (R125-I4) |
| 6 | tickets | reply `:299`, status `:332` (adminFetchJson) | detail refetch (`openTicket`) + list `refetch()` (all loaded pages) + stats `:310/:341` | `ticket-reply`/`ticket-status-update` (tickets.ts BE `:259,:297`) | ✆-stats only — **tickets list key NOT in handler (B-5)** | ⚠ acting tab ✅, other tabs' queue stale (no poll) |
| 7 | alerts | markRead/read-all/delete/deleteRead/deleteAll (optimistic + rollback `:244-360`) | `["admin-alerts"]` + `["admin-alerts-unread-count"]` (`:239-242`; 2nd subsumed — B-8) | `admin-alert-new` (separate handler `:88-94`, both keys) | ✆ alerts | ✅ best-in-class |
| 8 | coupons | create/update/soft-archive (adminFetchJson) | manual `fetchCoupons()` re-call (no RQ) | none | n/a (no cache) | ✅ (design: no RQ) |
| 9 | referrals | credit raw `:366` (idem key) | manual `fetchData()` (no RQ) | none (points ledger only — no stats field) | n/a | ✅ w/ B-1 401 patch |
| 10 | security | none (reads) | n/a | — | n/a | ✅ |
| 11 | admins | create/patch/disable/enable (adminFetch) | manual `reload()` | none | n/a | ✅ (design) |
| 12 | promotions | create/activate-toggle/delete (adminFetchJson + raw PATCH `:232`) | manual `load()` | none (flash-sale is overlay pricing — no stats field) | n/a | ✅ (design) |
| 13 | pricing | config PUT (generated) `:390`; recompute (generated) `:419`; dry-run preview (adminFetchJson `:452`) | config key `:390` + products base `:419` | none needed (no stats field) | n/a | ✅ (B-12 = preview unpinned) |
| 14 | settings | telegram-test / 2FA rotate / auth PATCH (adminFetchJson) | manual reload | none | n/a | ✅ (design) |
| 15 | system | none (6 read queries, 60/90/15 s) | n/a | — | n/a | ✅ |
| 16 | risk | none on this page (label writes live on risk-event; bulk-label has NO frontend consumer — grep-verified) | n/a | `risk-label`/`risk-bulk-label` (risk.ts BE `:357,:438`) | ✆-stats only — **risk keys NOT in handler (B-5)** | ⚠ dashboard self-heals 30 s poll; events list manual |
| 17 | risk-event | label (adminFetchJson) `:100-125` | detail `:109` + events base `:116` + dashboard `:117` + stats `:125` | (same emits as #16) | ✆-stats (acting tab does the rest itself) | ✅ most complete handler in the console |
| 18 | enrichment | publish/reject/edit (adminFetchJson) `:243/:257/:203` | `["admin-enrichment-list"]` base `:203` | none needed (no stats field) | n/a | ✅ (R125-I3) |
| 19 | whatsapp | sessions display ops (adminFetchJson) | manual `loadSessions` | none | n/a | ✅ (design; OpenWA standing order) |
| 20 | login | probe/verify-2fa (pre-auth raw) | n/a | — | n/a | ✅ justified |
| 21 | layout | none (stats + unread-count reads; GlobalSearch reads) | reads keys others invalidate | — | ✆ both | ✅ |

**Matrix verdicts:** double-invalidation = only the 2 subsumed-key nits (B-8); missing-invalidation = products→stats (B-2, the only one with user-visible numbers) + cross-tab tickets/risk lists (B-5). Pages whose list+stats both go stale after a mutation: **none** — every list self-invalidates; only stats lags on products.

---

## F. Pagination / param honesty recheck (mandate 5)

- **pageParam ceilings:** orders/topups/users (R122) + tickets/alerts (R125-I6, `tickets.ts:67`/`alerts.ts:40`) — all 5 offset-paginated admin lists now capped at MAX_PAGE 10 000. ✅
- **Cursor hasMore:** alerts `{hasMore,total}` envelope (FE honors both, `alerts.tsx` infinite) ✅; risk `next_cursor` limit+1 probe now wired (A-4) ✅; enrichment `next_cursor` wired (A-6) ✅. No cursor consumer ignores its envelope anymore.
- **Search debounce + abort:** orders/users/products 300 ms → debounced value into the queryKey (key change auto-aborts via RQ signal: `orders.tsx:620`, `users.tsx:431`, `products.tsx:608`); referrals 300 ms + AbortController + seq (`referrals.tsx:262-266`) + mount double-fetch guard (`:321-324`); security abort+seq (`:133-141`); GlobalSearch 220 ms + abort + scope gates (`layout.tsx:346,445-451`). Topups is client-side by documented design. ✅ — with B-6's missing `limit=` as the only residue.
- **Honest counts:** products/coupons capped-wording ✅; referrals/security window hints (R125-I3/I5) ✅; orders/topups/users/tickets «عرض N» ✅. Remaining dishonesty: referrals **search** silently scoped to the 200-window (B-7).
- **Live param abuse probe:** `?page=100000000` on admin endpoints → 401 before routing (guest); ceiling verified by code read only (UNVERIFIED live — requires admin token).

## G. Generated-client drift verdict (mandate 6)

**IN SYNC at HEAD.** Evidence: (1) the spec's last change (AdminProduct SEO pair, `openapi.yaml:5455-5470`) and the regenerated `shared/api-client-react/src/generated/api.schemas.ts` (+14) + `shared/api-zod/src/generated/api.ts` (+36) landed in the SAME commit `a8d688c`; (2) `git log a8d688c..HEAD -- shared/api-spec shared/api-client-react shared/api-zod` is EMPTY — nothing touched the spec or generated trees since; (3) working tree clean; (4) CI enforces the mirror (`ci.yml:310-321`: regen + `git diff --exit-code`), and R125's round record reports green. Orval was NOT run by this audit (hard rule). UNVERIFIED: CI's actual green state on the last push (no CI query from this box) — the three facts above make drift vanishingly unlikely.

## H. Key-shape + cache-defaults audit (mandate 7) — verdict in B-11

No wrong cross-invalidation; one intentional coupling (alerts family) with a redundant half (B-8); one near-miss naming hazard (risk detail vs list); defaults (60 s/5 min/no-focus/retry-4xx-never) are coherent, documented, and money-safe. Full sweep detail in B-11.

---

## I. Priority counts + fix order

**P0: 0 · P1: 0 · P2: 3 (B-1, B-2, B-3) · P3: 10 (B-4 … B-13)** — 13 findings.

1. **B-1** referrals 401 (1 line) — S. The only contract break found.
2. **B-2** products stats co-invalidation (1 line in `invalidate()`) + CHANGELOG truth fix — S.
3. **B-5** socket handler +3 keys (tickets/risk lists) + stale comment — S. (Cross-lane: already R126-A2's #1 — dedupe into one lane task.)
4. **§D batch 1** (17 spec entries, regen, contract rows, loader flips) — M, the lane's main course; rides §C batch C.
5. **§C batch A** (7 raw→generated migrations) — M, do immediately after (or interleaved with) batch 1 — it needs no spec work.
6. **B-6** GlobalSearch `&limit=5` ×3 — S.
7. **B-9** 401 quiet-catch on 8 generated onError sites — S.
8. **B-8/B-11** key nits, **B-7** referrals SQL search, **B-12** dry_run param, **B-13** test pins — S batch.

**Verdict: SHIP-WORTHY.** No P0/P1; the money console's data layer is coherent (uniform 401 except one low-traffic page, single-fire invalidations everywhere, honest pagination envelopes end-to-end, idempotency discipline intact, spec↔generated in sync). The three P2s are one-liners plus the deliberately-scoped spec backlog — none block today's deploy.
