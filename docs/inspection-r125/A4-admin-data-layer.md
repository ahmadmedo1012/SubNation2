# R125-A4 — Admin Console DATA-LAYER Audit

**Scope:** the data plumbing behind all 21 admin pages (`frontend/src/pages/admin/*.tsx`): how each fetches (generated orval hook vs generated fetcher vs `adminFetchJson` vs raw `fetch()`), caches, invalidates, polls, paginates, and searches — plus whether the backend routes serving them (`backend/src/routes/admin/`, 24 routers) are efficient and contract-honest. This is the data-flow complement to the R124 A1/A2/A3 UX audits.

**Method:** full read of the data-layer sections of all 21 pages (~19k lines), `shared/api-client-react/src/{custom-fetch.ts,generated/api.ts}` (83 fetchers + hooks/keys), `lib/admin-session.ts`, `lib/idempotency.ts`, `App.tsx` QueryClient config, `SocketInitializer.tsx`, all 24 backend admin routers, and the Drizzle schema (`shared/db/src/schema/`). Static analysis only at HEAD `09857fc` (clean tree); no production probes, no builds/tests run. Predecessors: `docs/inspection-r124/A6-admin.md` (§B #7 pagination/polling, #11 double-refetch) + the R123/R124 "Deferred" blocks in `CHANGELOG.md`.

**File:line evidence is at HEAD 09857fc.** Effort scale: S ≤ 1h, M ≤ half-day, L > 1 day.

---

## A. Verified-held (checked and confirmed in good shape)

1. **A6 #11 (orders bulk double-refetch) — FIXED and held.** `orders.tsx:856-865`: the explicit `refetch()` is gone; a single base-key `invalidateQueries({ queryKey: getListAdminOrdersQueryKey() })` fires one refresh, with the R124-I5 comment explaining why.
2. **Topups search — landed in R124 and verified.** `topups.tsx:395-407` (300 ms debounce) + `:610-631` (client-side filter over accumulated pages, honest count at `:954-957`). The client-side choice is documented: the list route has no `?search=` (`backend/src/routes/admin/topups.ts:56-104` reads only `status/page/limit`) — see B-6 for the server-side gap this leaves.
3. **QueryClient defaults are disciplined — no refetch-on-focus storms.** `App.tsx:202-228`: `staleTime: 60_000`, `gcTime: 5 min`, `retry` 1× retryable-only (TypeError/5xx via `isRetryableQueryError`, `:255`), `refetchOnWindowFocus: false`, `refetchOnReconnect: false`. No mutation defaults → mutations default `retry: 0` (correct for money). customFetch adds a 20 s per-request timeout + cold-start 503 boot-gate retry (`custom-fetch.ts:367-398`) and a global 401 observer chain (`:614-629`).
4. **Query-key hygiene is sound where it matters.** Hand-built infinite keys deliberately keep the generated URL-first prefix — `["/api/admin/orders","load-more",{…}]` (`orders.tsx:629`), `["/api/admin/topups","load-more"]` (`topups.tsx:478`), `["/api/admin/users","load-more",{…}]` (`users.tsx:423`), `["/api/admin/tickets","load-more",{…}]` (`tickets.tsx:180`) — so the socket handler's prefix invalidations (`SocketInitializer.tsx:82-88, 96-100`) and page mutations (`getListAdminOrdersQueryKey()` base = `["/api/admin/orders"]`, `generated/api.ts:5585-5587`) prefix-match every params variant incl. the dashboard's `{limit:8}`. The generated-key shape `[url, params?]` vs hand-key `[url, "load-more", params]` cannot collide (element 2 is `"load-more"` vs a params object).
5. **Idempotency is layered and mostly per-intent.** `lib/idempotency.ts` (UUID v4 CSPRNG + fallback) with the usage doctrine in its docblock. Money sites: users save = per-INTENT via `saveIntentKeyRef` (mint once, reuse across retries, keep on `IDEMPOTENCY_IN_FLIGHT`, clear on terminal — `users.tsx:605-607, 649, 669-670`); topups single approve/reject = key as mutation variable per click (`topups.tsx:669, 679` — React Query variable reuse covers internal retries); orders bulk + topups bulk loops = per-CLICK/per-ITEM (`orders.tsx:801`, `topups.tsx:733, 830` — the topups per-item choice is correctly argued at `topups.tsx:719-727`: a shared key would replay the first response for items 2..N). Tested: `lib/__tests__/idempotency.test.ts` + header assertions in `topups-approve-confirm.test.tsx:147`, `users-wallet-confirm.test.tsx:245`.
6. **Backend efficiency hardening from prior rounds holds.** `/admin/stats` = 10 aggregates behind a 30 s `cacheWrap` (`routes/admin/stats.ts:69-137`); chart = per-(days, day-bucket) 30 s cache (`:150-152`); admin products list = page-scoped aggregates + 200 cap + one `inArray` variants query (`routes/admin/products.ts:88-168`); users list = order-counts scoped to page ids (`routes/admin/users.ts:63-76`); orders list no longer decrypts credentials (B6-03: `routes/admin/orders.ts:283-295`, per-order audited reveal at `/orders/:id/credentials`); risk dashboard's 3 aggregates run concurrently (`routes/admin/risk.ts:721-742`).
7. **Index coverage matches every admin filter/sort.** orders: `status+created`, `created DESC`, `user+created`, `product`, `variant` (`schema/orders.ts:101-116`); wallet_topups: `status+created`, `user+created DESC`, unique payment_reference (`schema/wallet_topups.ts:61-70`); users: phone **trigram GIN** for the phone-search LIKE (`schema/users.ts:84`) + email + created; auth_activity: user/identifier/action/created-DESC (`schema/auth_activity.ts:30-34`); admin_alerts: `created DESC` (the R118-A6 F-4 index, `schema/admin_alerts.ts:46-53`) + dedupe composite; referral_events: `(referrer_id, created_at DESC)` + status CHECK (`schema/referral_events.ts:41-49`); products: category, active+category, slug unique, name trigram (`schema/products.ts:103-117`); support_tickets: `status+updatedAt DESC` (`schema/support_tickets.ts:36`). No missing index found for any admin list query I traced.
8. **Auth/401 handling is uniform for 17/21 pages.** Two solid idioms cover the console: (a) generated hooks → customFetch 401 observer → `handleAdminUnauthorized` (registered once via `useAdminHeaders`, `hooks/use-admin-headers.ts:62-66`); (b) raw/adminFetch call sites → `adminFetch`/`adminFetchJson` throws `AdminSessionExpiredError` after the global toast+redirect (`lib/admin-session.ts:208-243`) and every catch stays quiet on it. The additive-observer registry prevents admin/storefront handler clobbering (`custom-fetch.ts:47-78`).
9. **Error/empty-state plumbing from the data layer up is consistent on the RQ pages.** All 6 infinite pages + products/system/risk/enrichment/destructure `isError/error`, render distinct error-card / stale-banner / true-empty states, and never coerce failures into `[]` (pinned by e.g. `orders-false-empty-pagination.test.tsx`). 13 pages use the session-aware `adminFetchJson`; `alerts.tsx` is the best-in-class mutation page (optimistic `onMutate` + rollback + `cancelQueries` + envelope, `:238-334`).

---

## B. Findings (P0–P3)

### B-1. [P2] R123 deferred "orders raw-fetch → hook migration" is still open, and it generalizes: 18 raw `fetch()` call sites across 11 pages, 7 of which have generated equivalents today

**Evidence** (every true `fetch(` in the 21 pages; `adminFetch*`/`customFetch` excluded):

| Page:line | Endpoint | Why raw (today) | Generated exists? | Verdict |
|---|---|---|---|---|
| orders.tsx:574 | GET `/api/admin/orders/:id/credentials` | history | **`getAdminOrderCredentials`** (`api.ts:5722+`) | **migrate** — S, low risk (same 401 semantics via ApiError; keep local cache) |
| orders.tsx:799 | PATCH `/api/admin/orders/bulk-status` | custom 207 parse + idem key | **`bulkUpdateOrderStatus`** (`api.ts:5879`) — 207 union type already generated | **migrate** — S/M: carry the `BulkUpdateOrderStatusPartial` branch into the existing 207 toast; keep `withIdempotencyKey` header threading |
| products.tsx:913 | DELETE `/api/admin/products/:id` (bulk loop) | mid-loop 401 break | **`deleteProduct`** (`api.ts:7203`) | **migrate** — S (catch `ApiError` `status===401` instead of `isAdminUnauthorized(r)`) |
| products.tsx:957 | PATCH `/api/admin/products/:id` is_active (bulk loop) | same | **`updateProduct`** (`api.ts:7098`) | **migrate** — S |
| promotions.tsx:214 | DELETE `/api/admin/flash-sales/:id` | history | **`deleteFlashSale`** (`api.ts:6686`) | **migrate** — S |
| referrals.tsx:348 | POST `/api/admin/referrals/:id/credit` | idem key | **`creditReferral`** (`api.ts:6776`) | **migrate** — S |
| users.tsx:632 | PATCH `/api/admin/users/:id` | per-intent idem key + `describeSaveError` | **`updateAdminUser`** (`api.ts:8309`) accepts options incl. headers | **migrate** — S/M: pass `withIdempotencyKey(jsonHeaders, intentKey)`; the 409-IDEMPOTENCY_IN_FLIGHT key-retention logic must survive verbatim |
| topups.tsx:731, 827 | POST approve/reject (bulk loops) | fresh key per item + Response-level 401 break | `approveTopup`/`rejectTopup` exist (single mutations already use them, `:534, 577`) | migrate — M: error shape flips Response→ApiError; per-item 401 becomes `err.status===401` catch. Defer unless touching anyway |
| referrals.tsx:255 | GET `/api/admin/referrals` | **endpoint not in OpenAPI** | no | keep raw today; expose op first (B-7) |
| security.tsx:85, 116 | GET `/api/admin/auth-stats/summary`, `/auth-activity` | not in OpenAPI; also still the OLD hand-rolled ok/parse (pre-R123 holdout — not even `adminFetchJson`) | no | **minimum now:** swap to `adminFetchJson` (S, mechanical — kills ~40 lines of duplicated guard code); spec exposure later |
| settings.tsx:966 | GET `/api/admin/settings` + `/settings/auth` (local `fetchJsonOrNull` with `"__unauthorized__"` string sentinel) | not in OpenAPI | no | swap to `adminFetchJson` + `AdminSessionExpiredError` (S) |
| system.tsx:414, 431 | observability GETs (local `fetchAdminJson` + `"SESSION_EXPIRED"` sentinel); `/api/healthz/ready` | not in OpenAPI; healthz/ready has special 503-degraded contract | healthCheck is `/api/healthz`, not `/ready` | observability GETs → `adminFetchJson` (S); `/ready` **keep-with-reason** (503 = data, not error) |
| dashboard.tsx:344 | GET `/api/admin/chart-data?days=` | not in OpenAPI; `canSeeMoney` gate | no | expose op later; fix the missing abort NOW (B-4) |
| login.tsx:53, 131 | `/api/admin/probe`, `/api/admin/login/verify-2fa` | pre-auth (no token to build headers from); verify-2fa deliberately undocumented (`api.ts:8423` comment) | no | **keep-with-reason** (pre-auth pages can't ride `useAdminHeaders`; spec exposure optional) |

10 pages have **zero** raw fetches (admins, alerts, coupons, enrichment, layout, pricing, risk, risk-event, tickets, whatsapp). The R123 ledger named orders specifically; reality: orders has exactly 2 sites, both with existing generated fetchers — the migration is small, and the repo-idiom for it already exists (`topups.tsx:523-536` calls a generated fetcher inside `useMutation` with an idempotency header).
**Why it matters:** every raw site re-implements ok-guard/401/JSON-parse that `adminFetchJson`/customFetch own — the drift surface R123-E3 spent a whole round collapsing.
**Fix sketch:** (1) migrate the 7 "generated exists" sites (S each, ~½ day total); (2) `adminFetchJson`-ify security/settings/system loaders (S); (3) file the spec-exposure list (B-7) for a follow-up. **Effort M total.**

### B-2. [P2] R123 deferred SEO gap — CONFIRMED exactly as deferred: the admin list payload still cannot display existing overrides

**Trace:** DB columns exist (`products.seoTitle/seoDescription`, written by POST/PATCH — `routes/admin/products.ts:232-233, 326-333`). `GET /api/admin/products` uses an explicit projection (`:88-105`) that omits them and a response mapper (`:194-216`) that omits them. `AdminProduct` in OpenAPI (`shared/api-spec/openapi.yaml:5422-5461`) has no `seo_title`/`seo_description`. Frontend `startEdit` seeds `seo_title: ""` with the honest comment "the admin list row does not carry the current SEO overrides — seed empty and OMIT on submit while untouched" (`products.tsx:750-785`), and `handleSubmit` omits untouched fields via `seoTouched` (`:842-843`).
**Impact:** an operator opening a product that HAS an override sees empty SEO fields (looks like "no override"); they cannot view, edit, or deliberately clear an existing override through the UI — clearing requires typing anything then deleting to force `null`. The `seoTouched` omission guard prevents data LOSS (held invariant, pinned by `products-seo-submit.test.tsx`) but caps the editor at write-only.
**Fix sketch (small, additive):**
1. `routes/admin/products.ts` GET: add `seoTitle/seoDescription` to the select projection and `seo_title: p.seoTitle ?? null, seo_description: p.seoDescription ?? null` to the response (2+2 lines).
2. `openapi.yaml` `AdminProduct`: add both as `["string","null"]` (not `required`).
3. Regen orval+zod (CI drift gate enforces); contract suite 21/21 must be re-pinned for the new fields.
4. `products.tsx` `startEdit`: seed `seo_title: product.seo_title ?? ""` (+ description) and drop the "cannot see" comments; `seoTouched` guard then only guards genuine no-change saves (keep it — it still prevents `null`-clearing on untouched saves… actually with visible values the guard becomes redundant-but-harmless; keep until a follow-up decides explicit-clear UX).
**Effort S/M. Risk: low** (additive; the storefront never reads AdminProduct).

### B-3. [P2] Missed co-invalidations: 4 mutation families leave dashboard/layout stats stale for up to 300 s

`admin-stats-update` is emitted ONLY by orders bulk + topup approve/reject (`routes/admin/orders.ts:568, 703`; `services/topup.service.ts:201, 619, 685`), and `/admin/stats` has no write-side cache invalidation (documented 30 s staleness contract, `stats.ts:129-133`). But these admin mutations change stats-consumed numbers and invalidate nothing but their own list:
- **tickets status/reply** (`tickets.tsx:296, 322`): `open_tickets` lives in stats (`stats.ts:113-116`); the layout badge prefers the server number over the page's fresh count (`layout.tsx:783-785`) — closing a ticket leaves the badge lagging ≤5 min.
- **users wallet save** (`users.tsx:676`): `total_wallet_balance` changes; only the users key is invalidated.
- **products create/update/delete + stock set-count** (`products.tsx:644, 665, 686, 179`): `available_stock`/`unsold_rows` change; only the products key is invalidated (self-heals via the 60 s products poll? — no, that's the products list key, not stats).
- **risk-event label** (`risk-event.tsx:106-110`): invalidates only its own detail key — the `/admin/risk` list (`["admin-risk-events", filter]`) and dashboard (`["admin-risk-dashboard"]`, whose `unresolved` count the label changes) are not invalidated; back-nav shows stale chips for up to the 60 s global staleTime / 30 s dashboard poll.
**Fix sketch:** one line each — add `qc.invalidateQueries({ queryKey: ["/api/admin/stats"] })` (and the risk list keys) to those onSuccess handlers; or teach the backend to emit `admin-stats-update` on those writes (socket path already invalidates all 4 families). **Effort S. Risk: low.** (Alerts already does this right — `alerts.tsx:233-236` co-invalidates the unread-count key.)

### B-4. [P3] Dashboard chart fetch still has no abort/race guard (A6 #9, unfixed in R124) + a mini double-refetch

`dashboard.tsx:322-363`: `fetchChart` is a plain `fetch` — a slow 7-day response can still overwrite a fast 90-day one (chips say 90, data says 7). The repo recipe exists (GlobalSearch `layout.tsx:335-390` abort+stale-drop; referrals `fetchSeqRef`). Also `handleRefresh` (`:374-378`) calls `refetch()` AND `invalidateQueries(getGetAdminStatsQueryKey())` — the invalidate re-fetches the active stats query, so a refresh click fires stats twice (the exact class A6 #11 killed on orders; here it's the refresh button only). **Fix:** AbortController on `chartDays` change + drop the explicit `refetch()`. **Effort S.**

### B-5. [P3] Polling policy divergence is real but smaller than A6 #7 implied; it still deserves one documented table

Measured cadences (all `refetchIntervalInBackground: false`): products **60 s** (products.tsx:621) · orders/topups/users **300 s** + socket (641/496/442) · dashboard stats+recent-orders **300 s** + socket (289/315) · layout stats **300 s** + socket, alerts-unread **300 s** + socket, `staleTime 15 s` (756/723/726) · alerts inbox **20 s** + socket (alerts.tsx:228) · risk dashboard **30 s** (risk.tsx:102) · system: healthz/diagnostics/summary **60 s**, alerts-recent/scheduler **90 s**, metrics **15 s** (446-560) · tickets/promotions/coupons/admins/whatsapp/referrals/security/enrichment/pricing/settings **none**.
**Assessment:** the 300 s family is deliberate (socket-first demotion, documented per-site). The outliers: (a) alerts 20 s — its freshness need is already served by the `admin-alert-new` socket push (`SocketInitializer.tsx:101-108` invalidates both alert keys), so 20 s is belt-and-braces at 3 req/min/tab; harmless today (admin-only) but it is 15× the badge cadence. (b) products 60 s — no socket event covers catalog writes; the 60 s is the actual freshness mechanism (fine at 1-3 operators). (c) metrics 15 s is the fastest poll in the console (ops page, defensible, undocumented).
**Fix sketch:** add a "list polling policy" table to the admin docs (page → cadence → why → socket-covered?) and either drop alerts to 60 s or document "20 s chosen because operators treat the inbox as a live feed." **Effort S (doc) / S (one number).**

### B-6. [P3] Server-side pagination exists but is not used (or not usable) on 4 surfaces; 2 of them silently truncate

| Surface | Backend supports | Frontend does | Gap |
|---|---|---|---|
| risk events | `limit`(≤200)+`level`+`page`-style cursor + **`hasMore`** envelope (`routes/admin/risk.ts:117-124, 191-194`) | fixed `limit=100` plain `useQuery`, no load-more (`risk.tsx:113-122`) | events #101+ unreachable in UI; `hasMore` ignored |
| referrals list | `LIMIT 200` hardcoded, **no page param** (`routes/admin/referrals.ts:58`); `?search=` filtered **in JS after the LIMIT** (`:97-101`) | renders whatever arrived; no «عرض N» on the list (stats cards show true totals) | (a) referral #201+ invisible forever; (b) search silently misses anything outside the newest 200 — the *appearance* of server-side search (`referrals.tsx:254` sends `?search=`) with post-LIMIT semantics |
| security timeline | `.limit(100)`, no page param, no count (`routes/admin/security.ts:60-67`) | renders everything returned, no count/load-more (`security.tsx:108-136` renders `data.activities`) | A6 #17 called this "unbounded" — it is actually a silent 100-cap presented as the whole log |
| enrichment queue | `limit`(≤50)+**cursor** param (`routes/admin/enrichment.ts:72-90`) | fixed `limit=25`, no load-more (`enrichment.tsx:85-90`) | drafts #26+ invisible; mitigated by `pending_count` display |

Contrast the 6 done-right pages: orders/topups/users/tickets accumulate load-more over a real `page` param; alerts is the only one with an honest `hasMore`+`total` envelope (`routes/admin/alerts.ts:139-151`); products/coupons are capped with honest wording (200). admins/promotions/whatsapp/settings are naturally-small sets (acceptable).
**Fix sketch (honesty first):** add «عرض N (الأحدث أولاً)» + a capped-window note to referrals list + security timeline (S); wire risk load-more onto the existing envelope (S/M); referrals backend: move the search into SQL (ILIKE on the joined phones, trigram index on users.phone already serves it) or document the 200-window (M). **Effort S-M.**

### B-7. [P3] Spec blind spot: 12 live admin endpoints are absent from OpenAPI, so ~⅓ of the console can never ride generated bindings

Not in `shared/api-spec/openapi.yaml` (vs the 24 mounted routers): `/api/admin/alerts*` (list/unread-count/read/read-all/delete/delete-read — the whole alerts surface), `/api/admin/tickets*` (admin list/detail/reply/status — spec has only public `/support/tickets`), `/api/admin/referrals` (list), `/api/admin/auth-activity` + `/auth-stats(/summary)`, `/api/admin/settings(+/auth)`, `/api/admin/session`, `/api/admin/probe`, `/api/admin/login/verify-2fa`, `/api/admin/chart-data`, `/api/admin/observability/*`, `/api/admin/diagnostics/*` (only `/diagnostics/inventory-health` is spec'd), `/api/admin/enrichment/*`, `/api/admin/risk/*`, `/api/admin/forecast`, `/api/admin/admins*`, `/api/admin/whatsapp` (admin OTP ops), `/api/healthz/ready`.
**Why it matters:** these pages must keep hand-rolled fetch+guard code (B-1's tail), contract tests can't pin them, and the orval drift gate is blind to their drift. **Fix sketch:** batch-expose the high-traffic ones first (alerts, tickets, chart-data, auth-activity, settings, referrals list) — each is a path+schema+regen; alert/ticket envelopes are stable and already consumed by tests. **Effort M-L (batched over rounds); risk: low (spec-only, no behavior).**

### B-8. [P3] Admin DTO over-fetch: only one hot spot worth acting on — GlobalSearch fans out full list payloads to render 12 rows

- **GlobalSearch** (`layout.tsx:361-371`): per debounced keystroke-pause it fetches `/api/admin/orders?search=q` + `/users?search=` + `/products?search=` — 3 × default-100-row responses (products has **no limit param at all**: hard-coded `limit(200)` with full variant trees, `routes/admin/products.ts:88-118`) — to slice 4 each. Worst case ~300 full rows (user rows carry wallet/loyalty/identity; product rows carry variant trees) to render 12 lines. **Fix:** add `?limit=` to the admin products list (mirror orders' clamp) and send `&limit=5` from GlobalSearch on all three (S; orders/users already accept `limit`).
- **Admin products list generally:** full variant trees per row are *consumed* (variants dialog `products.tsx:1546+`, pricing selector `pricing.tsx:516-526` ride the embedded rows — no second fetch), catalog is ~45 products, and admin traffic is 1-3 operators. **Verdict: no projection needed** — the storefront's `?fields=list` exists because it's public traffic (17,445 B vs 79,762 B live-measured in R124); the admin surface at 200 rows × ~5 variants ≈ 1,000 rows worst-case ≈ a few hundred KB, refreshed 1×/min by ≤3 tabs. Document the verdict, don't build it.
- **users list SQL:** `select()` pulls every users column (incl. hash columns at the DB boundary) but maps a subset (`routes/admin/users.ts:41-58, 78-109`) — the products route's explicit-projection discipline (with its "future column before migration" rationale, `products.ts:90-93`) should be mirrored. **S.**

### B-9. [P3] Stale comment + redundant widening: `open_tickets` IS in the generated bindings

`layout.tsx:768-770`: "the generated AdminStats type predates the open_tickets field (regenerating orval bindings is a follow-up)" — false at HEAD: the spec declares `open_tickets`/`unsold_rows` (`openapi.yaml` AdminStats block) and the generated schemas carry them (`api-zod …/api.ts:1636`, `api-client-react …/api.schemas.ts:1088`). The `layoutStatsWide` cast and the comment should go. **S.**

### B-10. [P3] Data-layer test coverage: solid on pagination/search/error honesty; gaps on the socket invalidation set, key shapes, and idempotency per-intent retention

**Pinned today** (`frontend/src/pages/admin/__tests__/` + lib): orders false-empty pagination + bulk-status key invalidation (`orders-bulk-status.test.tsx`, `orders-false-empty-pagination.test.tsx`); topups queue-search (client-side filter) + approve-confirm Idempotency-Key + approve-all + bulk-note; users wallet-confirm key+note; products error/bulk + SEO-submit-omission (the B-2 guard); alerts load-more (key + optimistic invalidations); dashboard chart scope gate (finance); pricing console keys; global-search (abort/scope); layout alerts badge; socket RESYNC path invalidates exactly the 4 admin families once (`components/__tests__/socket-initializer-resync.test.tsx:85-95`); lib idempotency unit tests; custom-fetch timeout/cold-start.
**Gaps for A10 to pick up:** (1) the PRIMARY real-time path — `admin-stats-update` socket handler's 4-key invalidation — has **no test** (only the RESYNC fallback does); (2) no test pins the infinite-key *shape* `["/api/admin/users","load-more",…]` — a refactor that drops the URL-first prefix would silently sever every socket/page invalidation and stay green; (3) no test pins users-save **per-intent retention** (key kept on `IDEMPOTENCY_IN_FLIGHT`, cleared on success — the 99-M3 property a per-click regression would break); (4) no test pins polling cadences (a stray `refetchInterval` change is invisible); (5) tickets risk none — `tickets-error-state` covers errors only.

### B-11. [P3] `lib/idempotency.ts` docblock contradicts the (correct) topups bulk-loop practice

Docblock: "Bulk operations: ONE key per logical bulk… not per item" (`idempotency.ts:34-36`). The topups bulk loop deliberately mints **one key per item** with a first-principles argument (per-(admin,route,key) dedup would replay item 1's response for items 2..N — `topups.tsx:719-727`), and orders' true bulk endpoint correctly uses one key per click because it IS one HTTP call. Both implementations are right; the docblock's blanket rule is wrong for per-item loops. Amend the docblock to distinguish "one HTTP call → one key" from "N HTTP calls → N keys (per-record guards cover retry-safety)". **S (comment-only, money-module doc honesty).**

---

## C. The 21-page data-contract table

Key: **mech** = pagination mechanism · **cap** = server cap · **honest** = honest-count UI · **LM** = load-more · **poll** = refetchInterval (s) · ✆ = socket-invalidated (`admin-stats-update`/`admin-alert-new`) · **search** = how search works.

| # | Page | Endpoint(s) | Hook or raw | mech | cap / honest / LM | poll | search | Invalidations after mutations |
|---|---|---|---|---|---|---|---|---|
| 1 | dashboard | `/admin/stats`, `/admin/orders?limit=8`, `/admin/chart-data` (raw) | generated hooks ×2 + raw chart | fixed 8 rows | n/a / n/a / — | 300 ✆; chart on mount+click (no abort, B-4) | — | socket ✆ covers stats/orders; manual refresh double-fires stats (B-4) |
| 2 | products | `/admin/products` (list, POST, PATCH, DELETE, variants, inventory) | **generated hook+mutations** (`useListAdminProducts`, `useCreate/Update/DeleteProduct`); bulk loops raw (B-1); inventory `adminFetchJson` | none | 200 / capped-wording ✓ / no (backend has no page param) | 60 | server `?search=` (debounced 300 ms, in key, aborts) | own base key ✓; **stats ✗** (B-3) |
| 3 | orders | `/admin/orders`, `/:id/credentials` (raw), `/bulk-status` (raw) | generated fetcher in hand-rolled `useInfiniteQuery`; 2 raw sites | accumulate (100/page, full-page heuristic) | 200/page / «عرض N» ✓ / ✓ | 300 ✆ | server `?search=` (debounced, key, abort) + client status/date tabs (documented: preserves tab counts) | base orders key ✓ (single fire, A6#11 fixed); stats via socket ✆ ✓ |
| 4 | topups | `/admin/topups`, `/:id/approve|reject` | generated fetcher in infinite query; generated `approveTopup/rejectTopup` in useMutation; bulk loops raw | accumulate (100/page) | 200/page / ✓ / ✓ | 300 ✆ | **client-side** over accumulated pages (R124; backend has no `?search=` — B-6 sibling) | own base key ✓; stats via socket ✆ ✓ |
| 5 | users | `/admin/users`, PATCH `/:id` (raw) | generated fetcher in infinite query; raw PATCH | accumulate (100/page) | 200/page / ✓ / ✓ | 300 ✆ | server `?search=` = **phone-only** LIKE (trigram idx), debounced + client sort/tier filter | users base key ✓; **stats ✗** (B-3) |
| 6 | tickets | `/admin/tickets*` (all raw-family `adminFetchJson`) | hand infinite + `adminFetchJson` | accumulate (100/page) | 200/page / ✓ / ✓ | none (manual + reply refetch) | none (status tabs server-side via key) | detail refetch + full-list `refetch()`; **stats ✗** (B-3) |
| 7 | alerts | `/admin/alerts*` (list via `customFetch`, mutations via `adminFetchJson`) | hand infinite + customFetch | accumulate (50/page, **`hasMore` envelope** — the only one) | 200/page / ✓+total / ✓ | **20** ✆ | none (filters client-side) | own 2 keys ✓ incl. optimistic rollback (best-in-class) |
| 8 | coupons | `/api/coupons/admin` | manual `adminFetchJson` (no RQ) | none | 200 / capped-wording ✓ / no | none | none (200-row cap, no search — A6 #14 noted) | manual `fetchCoupons()` re-call |
| 9 | referrals | `/admin/referrals` (raw GET), `/:id/credit` (raw POST) | raw ×2 | none | **200 hardcoded, silent** / list has no count / no | none | `?search=` sent server-side but backend filters **post-LIMIT in JS** (B-6) | manual `fetchData()` |
| 10 | security | `/admin/auth-stats/summary`, `/auth-activity` | raw ×2 (old pattern, B-1) | none | **100 silent** / ✗ / no | none (manual) | filters server-side (action/success/dates) | manual `refreshAll` |
| 11 | admins | `/admin/admins`, `/scopes`, `/session` | `adminFetch` (Response-level) ×3 | none | unbounded (naturally tiny table) / n/a / — | none | none | manual `reload()` |
| 12 | promotions | `/admin/flash-sales` (list+create+activate), DELETE raw | `adminFetchJson` + raw DELETE | none | singleton-active design / n/a / — | none | none | manual `load()` |
| 13 | pricing | `/admin/pricing/config`, `/recompute`, products list | **generated** (`useGetAdminPricingConfig`, `useUpdateAdminPricingConfig`, `useRecomputeCatalogPrices`, `useListAdminProducts`) | none | 200 / n/a / — | — (rides products key) | — | config key + products base key ✓ (`:374, 403`) |
| 14 | settings | `/admin/settings(+/auth)`, 2FA, telegram-test | raw loader + `adminFetchJson` mutations | n/a (config) | n/a | none | none | manual reload |
| 15 | system | `/api/healthz/ready` + `/admin/diagnostics` + `/admin/observability/{summary,alerts/recent,metrics,scheduler}` | 6 `useQuery` (2 raw fetchers, 4 customFetch/adminFetchJson) | n/a | 500 (inventory-health) | 60/60/60/90/**15**/90 | none | manual refetchAll |
| 16 | risk | `/admin/risk/dashboard`, `/events` | `useQuery` + `adminFetchJson` | none | limit=100 requested, `hasMore` **ignored** / ✗ / no (B-6) | dashboard 30 | level filter in key (server) | none on this page (manual) |
| 17 | risk-event | `/admin/risk/events/:id`, `/label` | `useQuery` + `useMutation` | n/a (detail) | n/a | none | — | **own detail key only — list/dashboard ✗** (B-3) |
| 18 | enrichment | `/admin/enrichment/list?state=drafted&limit=25`, publish/reject/edit | `useQuery` + `useMutation`s | cursor exists, unused | 50 max / pending_count shown / no (B-6) | none | none | own list key ✓ (publish/reject/edit) |
| 19 | whatsapp | `/admin/diagnostics/whatsapp/*` | `adminFetchJson` | n/a (sessions) | unbounded (tiny) | none | none | manual `loadSessions` |
| 20 | login | `/admin/probe`, `/login/verify-2fa` | raw ×2 (justified: pre-auth, B-1) | n/a | n/a | — | — | n/a |
| 21 | layout | stats + `/admin/alerts/unread-count` (generated + `adminFetchJson` in RQ), GlobalSearch (`adminFetchJson`, abort) | generated + hand RQ | n/a | n/a | 300 ✆ both; alerts staleTime 15 s | GlobalSearch: 3× server `?search=`, 220 ms debounce, abort, scope-gated, **over-fetches full pages** (B-8) | reads keys others invalidate; alerts mutations co-invalidate both keys ✓ |

---

## D. Priority counts

**P0: 0 · P1: 0 · P2: 3 (B-1, B-2, B-3) · P3: 8 (B-4 … B-11)** — 11 findings.

## E. Suggested fix order

1. **B-3** (missed co-invalidations, one-liners ×4) — S; the only findings with user-visible staleness on money-adjacent screens.
2. **B-2** (SEO list payload, R123 deferred item) — S/M; closes a deferred ledger entry end-to-end (route + spec + regen + seed).
3. **B-1 steps 1-2** (migrate the 7 ready raw sites + `adminFetchJson`-ify security/settings/system) — M; shrinks the raw-fetch count from 18 to ~7, all of which then have a keep-reason or a spec ticket.
4. **B-4** (chart abort + refresh double-fire) — S, two one-liners.
5. **B-6** (honest counts for referrals/security + risk load-more) — S-M, honesty first, envelope wiring second.
6. **B-8 GlobalSearch `limit` + users explicit projection; B-9; B-11** — S batch (comments/limits).
7. **B-5** (polling policy doc) — S; do it in the same docs pass as B-6's wording.
8. **B-7** (spec exposure batch) — M-L across future rounds; B-10's test gaps (socket handler pin, key-shape pin, per-intent retention pin) ride along as each surface is exposed.
