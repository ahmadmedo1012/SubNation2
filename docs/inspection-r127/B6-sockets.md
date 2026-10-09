# R127-B6 — Socket.IO real-time layer, full-stack audit

**Agent:** R127-B6 (read-only auditor) · **Tree:** `f53a886` (clean; production subnation.ly) · **Date:** 2026-10-09
**Scope:** `backend/src/lib/socket.ts` + all 27 emission call sites · `frontend/src/lib/socket.ts` + `lib/socket-events.ts` + `hooks/use-socket.ts` + `components/SocketInitializer.tsx` + `components/SessionActivityManager.tsx` + every consumer (`rg "useSocket|socket.on"`) · duality (socket vs polling) · failure honesty.
**Method:** static only — full reads of both socket cores and all consumers, contextual reads of every emit site (tx position, `.catch`, payload), lazy-load/bundle posture from R126-A5, `node_modules` inspection of `@socket.io/redis-adapter@8.3.0` for the emit-failure path, tests read (`socket-resync.test.ts`, `socket-initializer-resync.test.tsx`, `admin-stats-emit.test.ts`). No test runs, no production probes, no writes.

---

## Executive summary

The socket layer's **backend half is genuinely hardened** (origin allowlist + dual-JWT handshake + DB-liveness re-verify every 5 min + 2FA-temp rejection + per-IP/total connection caps + explicit ping/timeout/maxHttpBufferSize + server-driven rooms), and its **emission discipline is clean**: all 27 sites fire *after* commit (checkout uses the signal-object pattern; the alertLogger dedupe tx ends before the emit), every dynamic-import emit is `.catch`ed to a warn log, payloads are honest pokes that the frontend answers with query invalidations.

The **freshness plumbing on the reconnect/park paths is where the truth leaks**. Three P2s, all in the same family: (1) the mid-connection alert-room **scope reconciliation is dead code** — the guard tests `liveness.ok` on a path that only runs when `liveness.ok` is false, so a revoked `support` scope keeps streaming alert PII until reconnect; (2) the admin **park→revive window has no admin-family resync** — the code comments claim SessionActivityManager covers it, but it invalidates only storefront keys, and tickets/risk have no polls to fall back on; (3) **`SOCKET_RESYNC_EVENT` is a no-op for storefront sessions** (pinned as intended by a test), so the exact money-screen blip recovery R96-M5 built is gone for wallet/order-detail while the module docblock still claims it works. Plus 5 P3s (silent `connection_limited` on the admin branch, no socket teardown on admin logout, products list key missing from the invalidation set, amount-keyed toast dedupe, and zero surfaced connectivity state).

**Counts: P0 0 · P1 0 · P2 3 · P3 5** (+2 informational notes). No money-loss path, no auth bypass. All fixes are small and surgical.

---

## §1 Inventory (what the layer actually is)

**Backend** (`backend/src/lib/socket.ts`, 1,147 L):
- Handshake gate (`io.use`, :857-937): layer 0 per-IP/total cap pre-check → layer 1 origin allowlist (with the R107 Origin-less same-origin Host fallback, :208-240) → layer 2 JWT (cookies first, `auth.userToken`/`auth.adminToken` fallback; 2FA **temp token rejected** at :310) → layer 2b DB liveness (`verifySocketIdentityLive` :398-470 — sessions row / admin_sessions sid / `is_active`).
- Rooms: `user:<verified-userId>` + `admin-room` (every active admin) joined **server-side** at connect (:982-1010); `admin-alerts-room` (support-scope gated, :114-127) joined via a best-effort async permission read at connect (:992-1008). Client `join-user`/`join-admin` are defensive idempotent no-ops (:1046-1087).
- Mid-session re-verify every 5 min (`SOCKET_REVERIFY_INTERVAL_MS`, :112): dead component → room left + identity stripped; fully dead → hard disconnect (`reverifyAndEnforce` :742-803).
- Connection caps: 5 per client-IP (CF-aware `resolveSocketClientIp` :688-714), 2,000 total, 60 s tracker sweep (:129-146); a capped socket gets a polite `connection_limited` event + disconnect 250 ms later (:963-969).
- Transport config, explicit: `pingInterval 25_000`, `pingTimeout 20_000`, `connectTimeout 30_000`, `maxHttpBufferSize 64KB`, `cors: allowedOrigins | true` (:808-832). Redis adapter only when `REDIS_URL` set (:834-844) — **unset in production** (docs/deployment/FINAL_PRODUCTION_ENV.md:70,165), single-instance by documented design.
- Emitters `emitToUser`/`emitToAdmins`/`emitToAdminAlerts` (:1119-1146): null-safe (`if (io)`), fire-and-forget, metrics-counted.

**Emission sites (all verified post-commit, all `.catch`ed where dynamic-imported):**

| Site | Event(s) → target | Payload |
|---|---|---|
| `notify.ts:41-47` | `notification-new` → user | `{id, type}` |
| `jobs/alertLogger.ts:177-187` | `admin-alert-new` → alerts room | `{id, type, title, message}` |
| `routes/admin/orders.ts:155-163, 540-553, 566-575, 689-705` | `notification-new` / `order-updated` → user; `admin-stats-update` → admins | `{id, status, order_code}`; `{type, status, succeeded, failed}` |
| `routes/admin/products.ts:299-303, 395-399, 440-443, 623-631, 895-898` | `admin-stats-update` ×5 | `{type, product_id[, removed]}` |
| `routes/admin/product-variants.ts:219-224, 339-344, 395-400` | `admin-stats-update` ×3 | `{type, product_id, variant_id}` |
| `routes/admin/tickets.ts:261-266, 312-316` | `admin-stats-update` ×2 | `{type[, status]}` |
| `routes/admin/risk.ts:355-360, 436-441` | `admin-stats-update` ×2 | `{type[, applied]}` |
| `routes/admin/users.ts:415-419` | `admin-stats-update` | `{type}` |
| `services/topup.service.ts:196-201, 614-619, 680-685` | `topup-updated` → user; `admin-stats-update` → admins (static import) | `{id, status, amount}` |
| `lib/socket.ts:963` | `connection_limited` → the capped socket | Arabic message |

Poke-vs-payload verdict: user-facing events carry enough to render (toast + targeted invalidation); admin events are deliberate pokes answered by the 7-key invalidation set. No event ships data the client renders without a refetch — no stale-payload-on-screen class.

**Frontend:**
- `lib/socket.ts` — module singleton, dynamic `import("socket.io-client")` (13.3 KB gz lazy chunk, R126-A5-verified), `autoConnect:false`, `reconnectionAttempts: 10`, `reconnectionDelayMax: 10_000` (:110-135), `withCredentials:true`; dispose-generation race guard for teardown-vs-import (:100-108); `wasDisconnected` bookkeeping → `SOCKET_RESYNC_EVENT` fired exactly once per non-deliberate disconnect→connect cycle (:80-98); park/revive primitives (:216-243); identity-switch teardown for user sessions (:164-181).
- Mount points: **admin** — `DeferredSocketInitializer` (App.tsx:910-932, adminToken-gated + 3.5 s deferral) → `SocketInitializer` (admin-room listeners + resync listener); **storefront, page-scoped** — `useSocket(me?.id)` on `wallet.tsx:762` and `order-detail.tsx:171` only (R104 policy); presence lifecycle — `SessionActivityManager` (park when hidden ≥15 min / foreground-idle ≥30 min, revive on interaction/visible/online, visibility resync throttled 30 s).
- Consumers: `NotificationBell` (60 s poll + `NOTIFICATION_NEW_EVENT`), AdminLayout (badge queries 300 s + alert-toast poller with its own visibility catch-up, layout.tsx:1034-1090), per-page `refetchInterval`s (products 60 s; stats/orders/topups/users/dashboard/layout 300 s; risk dashboard 30 s; alerts inbox 20 s; system 15-90 s; **tickets none**).

---

## §2 Findings (new)

### B6-1 · [P2] The alert-room scope reconciliation in `reverifyAndEnforce` is dead code — a revoked `support` scope keeps streaming `admin-alert-new` until reconnect

**Location:** `backend/src/lib/socket.ts:742-772`

**Evidence (verbatim):**
```ts
  const liveness = await verifySocketIdentityLive(identity);
  if (liveness.ok) return;            // :747 — healthy identity never reaches below
  ...
  // AUD103-3-F2 (r103): reconcile the scope-gated alert room on every
  // pass — a scope granted or removed mid-connection takes effect within
  // one re-verify interval, without waiting for a reconnect. ...
  if (liveness.ok && identity.isAdmin && liveness.adminPermissions) {   // :766
    if (hasAlertScope(liveness.adminPermissions)) socket.join(ADMIN_ALERTS_ROOM);
    else socket.leave(ADMIN_ALERTS_ROOM);
  }
```
The guard at :766 tests `liveness.ok` on a path that is only reachable when `liveness.ok === false` (early return at :747). The reconciliation block can never execute. Note `verifySocketIdentityLive` *does* return `adminPermissions` on the healthy path (:455) — the data was wired for exactly this consumer, which then became unreachable.

**Why it matters:** the alert room is scope-gated precisely because "`admin-alert-new` payloads carry operational content (product names, coupon codes, risk references)" (:114-119). An admin whose `support` scope is revoked (but who stays active — scope revocation ≠ session revocation, so liveness stays `ok`) keeps receiving those payloads on the WS surface for the life of the connection (admin tokens live 8 h; parking/revive keeps the same handshake) while the HTTP side correctly 403s. The symmetric case (scope *granted* mid-connection) silently misses live alerts until a reconnect. This is also a comment-truth violation in a repo with that discipline: the comment promises "takes effect within one re-verify interval".

**Fix directive:** move the reconciliation before the early return, on the healthy path:
```ts
const liveness = await verifySocketIdentityLive(identity);
if (liveness.ok) {
  if (identity?.isAdmin && liveness.adminPermissions) {
    if (hasAlertScope(liveness.adminPermissions)) socket.join(ADMIN_ALERTS_ROOM);
    else socket.leave(ADMIN_ALERTS_ROOM);
  }
  return;
}
```
Add a unit test mirroring the exported pure helpers (the file already exports testables; `reverifyAndEnforce` is the one piece of this gate with no direct test). **Effort S. Confidence: certain** (pure control-flow).

---

### B6-2 · [P2] Admin park→revive window has no admin-family resync — tickets/risk queues can stay stale indefinitely while the code comments claim coverage

**Location:** `frontend/src/lib/socket.ts:224-243` (park docblock), `frontend/src/components/SessionActivityManager.tsx:49-67, 102-110`, `frontend/src/components/SocketInitializer.tsx:46-58`, `frontend/src/pages/admin/tickets.tsx:185-208`

**Evidence (verbatim):**
- park docblock, `lib/socket.ts:233-236`:
  > Disconnect reason is `"io client disconnect"`, which deliberately does NOT arm the resync flag — the catch-up invalidation on the next visibilitychange(visible) (SessionActivityManager) covers events that fired while parked.
- what SessionActivityManager actually invalidates on visible (:57-66):
  ```ts
  function invalidateTransactionalQueries(queryClient) {
    void queryClient.invalidateQueries({ predicate: (q) =>
      typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/orders") });
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  }
  ```
  — the **storefront** families only. `resyncIfDue` (:102-110) runs for admin sessions too (`if (!token && !adminToken) return;`) but calls this same storefront-only set. The admin families (`/api/admin/stats|orders|topups|users|tickets`, `admin-risk-events`, `admin-risk-dashboard`) live exclusively in the `SOCKET_RESYNC_EVENT` handler (SocketInitializer.tsx:51-57) — which, by design, never fires for a park/revive cycle (reason `"io client disconnect"` does not arm `wasDisconnected`).

**Why it matters:** parking triggers on hidden ≥15 min or foreground-idle ≥30 min — an operator's console does this daily. Events emitted while parked are missed. On revive: the socket reconnects, but nothing invalidates the admin queries. The 300 s pages (dashboard/orders/topups/users, layout badges) wait for their next poll tick; **tickets and risk-event lists have no poll at all** (tickets.tsx:185-208 — `useInfiniteQuery` with no `refetchInterval`, `refetchOnWindowFocus` off app-wide), so a ticket another admin answered while this tab was parked stays wrong on screen *indefinitely* — until a new socket event or a manual reload. Contrast: the alert-toast lane *does* catch up on visible (`layout.tsx:1076-1079` "Returning to the tab catches up anything missed while hidden"), which shows the pattern was known — the admin list families just never got it.

**Fix directive (pick one):**
1. In `SessionActivityManager.resyncIfDue`, when `adminToken` is present, also invalidate the 7 admin keys (mirror SocketInitializer's handler — or export one `invalidateAdminFamilies(qc)` from a shared module so both sites share it), **or**
2. Arm the resync for deliberate parks of an admin-connected socket (in `parkSocketIfConnected`, set `wasDisconnected = true` when the singleton currently holds the admin branch) so revive fires `SOCKET_RESYNC_EVENT` naturally.
Extend `session-activity-manager.test.tsx` with an admin-session case. **Effort S-M. Confidence: high** (control-flow + comment/code contradiction; the only judgment call is severity — no poll exists to bound it on tickets/risk).

---

### B6-3 · [P2] `SOCKET_RESYNC_EVENT` is a no-op for storefront sessions — the R96-M5 money-screen blip recovery regressed in the R104 split, and the docblock still claims it works

**Location:** `frontend/src/lib/socket.ts:21-31` (docblock) vs `frontend/src/components/SocketInitializer.tsx:46-48`, pinned by `components/__tests__/socket-initializer-resync.test.tsx:126-134`

**Evidence (verbatim):**
- the docblock (`lib/socket.ts:22-27`):
  > 96-F3 (R96 M5 + A4 §2.1): window CustomEvent fired exactly ONCE per documented disconnect → reconnect cycle. **SocketInitializer listens for it and invalidates the transactional query families (orders / wallet / topups / me)** so events that were emitted WHILE the phone was offline … become visible immediately instead of at the next 5-minute poll.
- the actual handler (`SocketInitializer.tsx:47-48`):
  ```ts
  const handleResyncEvent = () => {
    if (!adminToken) return;          // user-only session: nothing happens
  ```
- the pin (test :126-134): `it("user-only session (adminToken null): resync event is a no-op", … expect(invalidateSpy).not.toHaveBeenCalled();`

**Why it matters:** the two storefront pages that hold a socket are the money screens (`wallet.tsx:762`, `order-detail.tsx:171`), and neither query has a `refetchInterval` (verified: no `refetchInterval` on any storefront page's wallet/orders queries). Network blip while the tab stays visible and active (WiFi↔cellular handoff — the primary market's daily reality): socket drops (reason ≠ `io client disconnect` → flag armed), reconnects, `SOCKET_RESYNC_EVENT` fires… into a handler that returns. Missed `topup-updated`/`order-updated` events are recovered only by a later visibilitychange (SAM, 30 s-throttled), a remount, or — for a pending topup with the modal open — the 3 s poll. A user actively watching their wallet balance after an approval that landed during the 20-second blip sees a stale number with no cue. The R96 fix (M5) was exactly this recovery; R104 moved the socket to page scope and kept the *event* machinery but orphaned the storefront consumer, leaving a docblock that describes the pre-R104 behavior.

**Fix directive:** give the storefront branch its consumer back — either a `token`-gated branch in `SocketInitializer`'s `handleResyncEvent` (invalidate the `invalidateTransactionalQueries` set, reusing SAM's function from a shared module) or move the `SOCKET_RESYNC_EVENT` listener into `SessionActivityManager` (drop SAM's duplication of the same keys; branch on `token`/`adminToken`). Truth-up the `lib/socket.ts:21-31` docblock either way, and update the "no-op" pin to assert the storefront set instead. **Effort S. Confidence: high** on the facts (code + test pin); impact severity is medium because SAM's visibility resync still covers the common background-return path.

---

### B6-4 · [P3] `connection_limited` (and `connect_error`) are unhandled on the admin socket branch — a capped operator loses realtime silently

**Location:** `frontend/src/components/SocketInitializer.tsx:120-121` (only `admin-stats-update` + `admin-alert-new` registered) vs `frontend/src/hooks/use-socket.ts:131-151` (the only `connection_limited`/`connect_error` listeners)

**Evidence:** `use-socket.ts:131-145` registers the R123-E4b toast for `connection_limited` ("عدد الاتصالات مرتفع" …). `SocketInitializer` — the component that owns the *admin* socket, the side that actually collides with the backend's documented CGNAT scenario (`backend/src/lib/socket.ts:133-136`: "Libyan mobile carriers NAT many users behind one address; a shared 5-slot ceiling there degrades to reconnect churn") — registers no such listener and no `connect_error` handler. An admin on mobile data who happens to be the 6th connection behind a carrier IP gets: polite event delivered → ignored → hard disconnect → manager retries → re-capped → 10 attempts → gives up. The console's realtime goes dark with zero feedback; the 300 s polls mask it on the big four queues, but tickets/risk (no polls) simply stop updating. **Fix:** register the same `connection_limited` toast (+ a `console.warn` `connect_error`) in SocketInitializer's setup, mirroring use-socket. **Effort S. Confidence: high.**

---

### B6-5 · [P3] `setAdminToken(null)` never tears the socket down — asymmetric with `setToken`, leaving a ≤5-min zombie admin-room membership after logout/401-expiry

**Location:** `frontend/src/lib/auth.tsx:195-204` (user path) vs `:237-277` (admin path)

**Evidence (verbatim):** `setToken` ends with `disconnectSocket();` (:201) under a comment that names the exact principle — "an identity switch MUST tear the socket down — leaving it connected would keep it in the PREVIOUS user's room". `setAdminToken` performs the alert-cursor reset + admin-query removal but contains **no** `disconnectSocket()`. The admin 401 path (`lib/admin-session.ts:159` → `clearAdminSession?.()`) and `adminLogout` both funnel through it — every admin-session-end route leaves the singleton connected. The server's 5-minute re-verify eventually strips the revoked `adminSessionId` (leaving `admin-room`/`admin-alerts-room`, hard-disconnecting when nothing remains) — so the exposure is: **0–5 minutes of `admin-room` events (live order/topup payloads) delivered to a logged-out browser's transport** (SocketInitializer's listeners are off'd on the adminToken flip, so nothing renders — but the PII crosses the wire), plus reconnect churn if the next admin logs in inside that window (`connectAdminSocket` happily reuses the still-connected zombie; there is no admin-side `identitySwitch` reconnect like `connectSocket`'s :164-181). **Fix:** call `disconnectSocket()` inside `setAdminToken`'s `t === null` branch (mirror the user path). **Effort S. Confidence: high** (asymmetry is verbatim); severity bounded by the ≤5-min server sweep + no-listeners state.

---

### B6-6 · [P3] The products list key is absent from the socket invalidation set, while `products.tsx` claims "socket pushes … prefix-match and refresh it"

**Location:** `frontend/src/components/SocketInitializer.tsx:101-107` (the 7 keys) vs `frontend/src/pages/admin/products.tsx:603-607` (comment) + `:619-627` (query)

**Evidence (verbatim, products.tsx:603-607):**
> the queryKey carries the params (getListAdminProductsQueryKey(params)) so a settled search restarts the query; the base-key invalidations (invalidate() + **socket pushes**) still prefix-match and refresh it.

The socket handler invalidates `["/api/admin/stats"|"…orders"|"…topups"|"…users"|"…tickets"|"admin-risk-events"|"admin-risk-dashboard"]` — **not** `["/api/admin/products"]`. R126-L4 landed 8 `admin-stats-update` emits for the products family, but each refreshes *stats* on other tabs, not the catalog grid. Cross-tab staleness on the products grid is bounded only by its 60 s poll (`products.tsx:623`). Two one-liners: add the products key to `handleStatsUpdate` + the resync handler (8 keys), and truth the comment ("the 60 s poll is the socket-dropout fallback"). **Effort S. Confidence: high.**

---

### B6-7 · [P3] `topup-updated` toast dedupe keys on `amount`+`status`, not the topup id — two same-amount approvals collapse into one toast

**Location:** `frontend/src/hooks/use-socket.ts:113` (`id: \`topup-${data.amount}-approved\``), `:119` (`id: \`topup-${data.amount}-${data.status}\``)

**Evidence:** the payload carries `id: topup.id` (backend `topup.service.ts:615/681`) which the handler ignores. A user with two pending 50-LYD topups (MAX_PENDING=3 makes this legitimate) who gets both approved sees one approval toast; the second is deduped by sonner's stable-id rule. The balance/list still update (invalidations run regardless) — pure notification loss. **Fix:** `id: \`topup-${data.id}-${data.status}\``. **Effort S. Confidence: high** (mechanism certain; frequency low).

---

### B6-8 · [P3] Failure honesty: nothing surfaces socket death mid-session — the only user-visible socket signal in the product is the storefront `connection_limited` toast

**Location:** `hooks/use-socket.ts:147-151` ("Non-critical: … Surface in DevTools for debugging without disturbing the user"), `SocketInitializer.tsx:122-124` (bare `console.warn`), `App.tsx:218/226` (`refetchOnWindowFocus/Reconnect: false` — deliberate, documented)

**Evidence:** `connect_error` → console only; surrender after 10 attempts → console only; admin branch → not even that (B6-4). The admin layout's "last updated" pill (`layout.tsx:932-948`) tracks *badge query* data updates, not socket liveness, and the queues with no poll (tickets, risk-event) render no staleness cue at all. Storefront wallet/orders: silent staleness until visibility/mount resync. This is a defensible product posture for a polling-fallback'd app, but the *socket-primary* surfaces (tickets queue, wallet watching a topup) violate its own premise: the primary freshness mechanism can die with zero symptom. **Fix directive (cheap, non-spammy):** a tiny connectivity sentinel — on the storefront, a subtle "تم فقد الاتصال المباشر" banner state derived from `connect_error`+`reconnect_failed`; on admin, reuse the existing pill to also reflect `socket.connected` (the singleton is importable lazily). Fold with B6-4's listener registration. **Effort S-M. Confidence: medium** (the gap is certain; whether it warrants UI is a product call — recorded as P3 for that reason).

---

### Informational notes (no action required now)

- **Redis-adapter emit failure path:** `@socket.io/redis-adapter@8.3.0` `broadcast()` calls `this.pubClient.publish(channel, msg)` without a `.catch` (dist/index.js:473); with node-redis a rejected publish would surface as an unhandledRejection (instrument.ts:49 swallows it process-wide). **Dormant**: `REDIS_URL` is unset in production (FINAL_PRODUCTION_ENV.md:70 — "Leave unset"), and local `super.broadcast` still delivers on-instance. If Redis is ever attached, wrap the emitters or add a rejection listener — note it in the env matrix.
- **Admin namespace non-goal:** admin events share the default namespace's `admin-room` (socket.ts:72-76 documents `/admin` migration as tracked). Scope-gated rooms already carry the RBAC-sensitive content; no finding.

---

## §3 Known items (NOT re-reported — pointers only)

| # | Item | Status | Pointer |
|---|---|---|---|
| 1 | R96 M1/M5 + §2.1: socket surrenders (was 5 attempts), no resync on reconnect, `refetchOnWindowFocus/Reconnect` off | **CLOSED** (96-F3 → R104): now 10 attempts + capped 10 s backoff (`lib/socket.ts:110-135`), `SOCKET_RESYNC_EVENT`, presence revival via SessionActivityManager; refetch flags remain off **by documented design** (App.tsx:215-226) | docs/history/inspection-r96/admin-backend-mobile.md §M1/§M5; mobile-journeys-whatsapp.md §2.1 |
| 2 | R96 mobile-perf F-5: guests downloaded the socket stack for nothing | **CLOSED** (R104 adminToken-gated `DeferredSocketInitializer`, App.tsx:910-932 + pin test) | docs/history/inspection-r96/mobile-performance-pwa.md F-5 |
| 3 | Alerts inbox 20 s vs badge 300 s divergence on socket dropout + missing cadence rationale | **OPEN (P3, doc/one-number)** | docs/inspection-r125/A3-admin-ops-security.md #7; A1 #54; still-current: alerts.tsx:258 |
| 4 | Socket key-set missed tickets + risk (R125-I6 emits landed nowhere) | **CLOSED** in 70489a2 — 7 keys + stronger tests (`socket-initializer-resync.test.tsx:105-123, 174+`) | docs/inspection-r126/A2-admin-catalog-customers.md #1; A4-admin-data-contracts.md B-5 |
| 5 | Dashboard charts (raw fetch) never socket-refreshed | **OPEN (P3)** | docs/inspection-r126/A1-admin-money-pages.md A1-1 |
| 6 | Coupons/pricing/referrals have no socket push path at all | **OPEN (P3)** | docs/inspection-r126/A1-admin-money-pages.md A1-26 |
| 7 | Redundant `["admin-alerts-unread-count"]` invalidation (prefix-covered) | **OPEN (P3, comment-level)** — still present at SocketInitializer.tsx:113 | docs/inspection-r126/A4-admin-data-contracts.md B-6 |
| 8 | No test pins the infinite-key *shape* `["/api/admin/tickets","load-more",…]` (a dropped URL-first prefix would silently sever every socket/page invalidation) | **OPEN (test gap)** — re-verified absent at HEAD | docs/inspection-r125/A4-admin-data-layer.md B-10 #2; r126 A4 "Still unpinned" #2 |
| 9 | Scoped sessions zombie-403-polling finance-gated `/api/admin/stats` | **CLOSED** in f53a886 (scope-honest `enabled` gates, layout.tsx:898) | inspection-r126/R1-independent-review.md P3-3 |
| 10 | Products family had zero `admin-stats-update` emits (changelog had claimed them) | **CLOSED** in e0fd793 (8 sites + 14-test emit suite) — my B6-6 is the *residual* (list key not in the handler set) | inspection-r126/R1-independent-review.md lane 4; A4 B-2 |
| 11 | Stale "I6's socket-emit gap" comments contradicting shipped emits | **CLOSED** (R126 wave reworded; the one remaining mention, stats-co-invalidation.test.tsx:18, is historically accurate) | docs/inspection-r125/R1-independent-review.md F1 |
| 12 | vendor-socket chunk 42.5 KB gz / 13.3 KB gz — lazy, single dynamic site | **VERIFIED CLEAN** (informational) | docs/inspection-r126/A5-frontend-performance.md (chunk table) |

---

## §4 Duality audit (socket vs polling, coherence)

| Data | Socket path | Poll | Verdict |
|---|---|---|---|
| Admin stats / orders / topups / users lists | `admin-stats-update` → 7-key prefix invalidate | 300 s demoted heartbeat | **Coherent by design** — socket-primary, poll = dropout fallback; one invalidation per event, TanStack coalesces, 1-3 operators → no storm |
| Admin tickets / risk-event lists | same 7-key set (R126-L3) | **none** | Coherent *while the socket lives* — becomes unbounded staleness in the park/revive window (B6-2) and under connection caps (B6-4) |
| Admin alerts (drawer + badge + toasts) | `admin-alert-new` → invalidate + immediate `/new?since=` poll | 20 s inbox, 300 s badge, 300 s toast poll + visibility catch-up | Coherent; the 20 s-vs-300 s divergence + missing rationale is the known P3 (#3) |
| Storefront notifications (bell) | `notification-new` → refetch (seq-guarded, 60 s poll race-hardened) | 60 s | **Coherent** — exemplary: socket poke + poll fallback with last-write-wins guard |
| Storefront topup status | `topup-updated` → invalidate list+wallet | 3 s **only while pending + modal open** | **Coherent** — bounded, foreground-only, socket-accelerated |
| Storefront wallet / orders freshness | page-scoped `useSocket` + visibility resync | **none** | Gap on the active-tab reconnect path (B6-3) |
| Products grid (admin) | emits exist, key absent (B6-6) | 60 s | Bounded by poll; 1-line key addition finishes R126-L4's story |

**Where sockets could safely replace polling:** alerts 20 s → 60 s + one rationale comment (known rec, #3); products 60 s could ride the socket key with the poll kept as fallback (B6-6). **Where polling must stay:** NotificationBell 60 s (most sessions hold no socket by design), TopupWaitingModal 3 s (money-path robustness when the socket is the thing that died), the 300 s demoted family (dropout honesty).

---

## §5 Failure honesty (scope item 4)

What the user sees when sockets die mid-session today: **nothing**, unless the storefront socket is connection-capped (the one surfaced signal, use-socket.ts:131-145). Storefront `connect_error` is console-only; the admin branch doesn't even log it. Staleness recovery depends entirely on where you are: badges/300 s pages self-heal within 5 min; tickets/risk-event hea only on the next socket event or reload; wallet heals on visibility/mount but not on an active-tab reconnect (B6-3). The app has no "live/last-updated" indicator tied to socket state anywhere (the admin pill is query-data-driven). See B6-8 for the minimal sentinel proposal.

---

## §6 Fix directives (priority order)

1. **B6-1** (S): move the alert-room reconciliation onto the healthy path in `reverifyAndEnforce` + unit test — closes the only WS-side RBAC drift.
2. **B6-2** (S-M): admin-family resync on park/revive — shared `invalidateAdminFamilies(qc)` used by SocketInitializer + SessionActivityManager (or arm the resync flag for admin parks); fixes the unbounded tickets/risk staleness.
3. **B6-3** (S): restore a storefront consumer for `SOCKET_RESYNC_EVENT` (or move the listener to SAM); truth the `lib/socket.ts:21-31` docblock; flip the "no-op" pin into a storefront-set pin.
4. **B6-4 + B6-8** (S-M): register `connection_limited`/`connect_error` on the admin branch; optionally the connectivity sentinel.
5. **B6-5** (S): `disconnectSocket()` in `setAdminToken(null)`.
6. **B6-6** (S): add `["/api/admin/products"]` to both socket handlers (8 keys total) + truth the products.tsx comment.
7. **B6-7** (S): toast dedupe on `data.id`.

All are additive, none touch money math, none require schema or contract changes. The layer's bones — auth, rooms, caps, emission discipline, listener hygiene — are sound; these are last-mile wiring truths.
