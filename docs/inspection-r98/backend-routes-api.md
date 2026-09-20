# R98-A1 — Backend HTTP Surface Completeness Audit (routes / mounting / validation / guards / errors / hygiene)

Agent: R98-A1 · Scope: `backend/src` Express HTTP surface (read-only audit) · Date: 2026-09-2x
Repo state audited: `main` @ SubNation2 (Express **5.2.1** — verified in `pnpm-lock.yaml` / `backend/node_modules/express-rate-limit` peer info; async handler rejections ARE forwarded to the error middleware in Express 5, which materially changes the async-error audit posture vs. Express 4).

---

## 0. Executive summary

- **48 route files** under `backend/src/routes/**` (+ routers composed in `app.ts`, `routes/index.ts`, `routes/admin/index.ts`, `routes/admin/copilot/index.ts`; Socket.IO surface in `lib/socket.ts` mounted by `server.ts`).
- **48/48 exported routers are mounted — zero orphan routers, zero duplicate (method+path) registrations.** One *middleware* (`riskHardBlockMiddleware`) is exported but intentionally unmounted (flag-locked phase-3, P3-3).
- **1 × P1**: `authLimiter` instance double-mounted on overlapping path prefixes → express-rate-limit **ERR_ERL_DOUBLE_COUNT** hard-500s two live auth routes (`POST /api/admin/login/verify-2fa`, `GET /api/auth/telegram/callback`) *and* double-burns their budget. Verified against the installed library source, not assumption.
- **5 × P2**: metrics auth bypasses admin-session revocation; login-CSRF window on the CSRF-skipped session-mint endpoints; `/auth/providers/unlink` last-identity logic bug + type-laundering silent success; `PUT /risk/config` unvalidated nested shapes.
- **14 × P3** polish items (stale comments, unbounded generated zod strings, inconsistent enum-filter validation, etc.).
- Overall the route surface is in **excellent shape** for its size: uniform Arabic error envelope, zod/manual validation on every money path, 3-layer idempotency on all 4 money-mutating routes, RBAC scope gates with self-escalation guards, strict `intParam` parsing, per-user/per-IP/per-session rate budgets, and catalog DTO leak-tests. The defects found are composition/edge-case level, not architectural.

---

## 1. Middleware composition (mount order — verified end-to-end)

`app.ts` order (line refs):

| # | Middleware | Line | Notes |
|---|---|---|---|
| 1 | Permissions-Policy header | 143 | |
| 2 | helmet (CSP/HSTS/COOP/COEP) | 151 | Firebase-tuned |
| 3 | `trust proxy = 1` | 269 | |
| 4 | strong ETag | 283 | |
| 5 | `cloudflareClientIp` | 294 | EARLY — before rate limiters/logging ✓ |
| 6 | canonical-host 301 (www→apex) | 313 | skips `/api/healthz*` ✓ |
| 7 | compression | 326 | |
| 8 | CORS origin gate (403 clean) + cors | 373–383 | gate kills the `cors` error-path 500 class ✓ |
| 9 | correlation, instrumentation isolation | 619–620 | |
| 10 | pino-http (autolog ignores healthz/cwv) | 623 | |
| 11 | metricsMiddleware | 659 | |
| 12 | cookieParser, json(1mb), urlencoded(1mb) | 661–663 | |
| 13 | bodyParserRecovery | 671 | salvages form-encoded w/ wrong CT; clean 400 otherwise |
| 14 | **CSRF Origin/Referer gate** | 800 | POST/PUT/DELETE/PATCH; exact-origin URL compare; fail-closed in prod; skip-list: firebase session/refresh, cwv, webhook prefix, `/health` (dead entry) |
| 15 | auth limiters (per-path) | 804–823 | authLimiter ×6 mounts, whatsappStartAuthLimiter ×1 — **see P1-1 overlap** |
| 16 | couponValidateLimiter | 826 | before generic /api limiters ✓ |
| 17 | apiLimiter (600/min/IP, skip authed) | 827 | |
| 18 | userLimiter (1200/min/user, skip anon) | 828 | |
| 19 | `/api` router | 829 | |
| 20 | `/api` JSON 404 | 832 | AFTER routers, BEFORE static ✓ |
| 21 | seoRouter (root) | 839 | robots/sitemap |
| 22 | static `/assets` (1y immutable) + static + share-card + SPA fallback | 843–963 | share-card DB-backed, bot-UA only |
| 23 | Sentry Express error handler | 973 | before custom handler ✓ |
| 24 | global error handler | 982 | SyntaxError→400, ZodError→400(+issues), `.errors[]`→400, else 500 Arabic `INTERNAL_ERROR`; **no err.message passthrough** ✓ |

`server.ts`: boot gate (503 "starting" until bootstrap; business routes never answer mid-migration), `requestTimeout 60s/headersTimeout 65s`, `initSocket(httpServer)`, graceful drain. 

**Correctness of ordering** (auth before handler, CSRF before mutating handlers, limiters before router): verified for every route below — no violations found except P1-1 (limiter overlap) and P2-2 (CSRF skip on session-mint endpoints).

---

## 2. Complete route table (~167 /api registrations + ~6 root-level + Socket.IO)

Legend — Auth: `pub`=public, `user`=requireUser, `admin`=requireAdmin (+RBAC scope where mounted), `metrics`=requireMetricsAuth. Validation: `z`=zod/generated schema, `m`=manual runtime checks, `int`=strict intParam/stringParam. RL: dedicated rate limit.

### 2.1 Public infra
| METHOD path | Auth | Validation | RL | Notes |
|---|---|---|---|---|
| GET /api/healthz | pub | HealthCheckResponse.parse | skipped from apiLimiter | |
| GET /api/healthz/live | pub | — | skipped | no I/O |
| GET /api/healthz/summary | pub | — | skipped | status discriminator only; 15s cache |
| GET /api/healthz/ready|firebase|redis|neon|worker|socket | admin | — | apiLimiter(user) | infra detail, admin-gated ✓ |
| GET /api/metrics | metrics (static token const-time OR admin JWT) | — | apiLimiter | **P2-1**: JWT path skips sid/isActive revocation |
| POST /api/cwv | pub | hand-rolled validator (name/value/route≤512/UUID v4 session/ts) + normalized Prometheus label table + 30/min/session cap | apiLimiter(IP) | route-scoped express.text 8kb; CSRF-skipped (beacon) |
| POST /api/webhook/telegram | pub + secret header (timing-safe) + TELEGRAM_ADMIN_IDS allowlist | callback regex `topup_(app\|rej):\d+` | apiLimiter(IP) | CSRF-skipped; always-200 for Telegram retry semantics |
| GET /robots.txt, GET /sitemap.xml | pub | — | static | 60s in-memory cache |

### 2.2 Auth (user-facing)
| METHOD path | Auth | Validation | RL |
|---|---|---|---|
| POST /api/auth/firebase/session | pub (mint) | id_token string required; referral/link token optional strings | authLimiter 10/15m; **CSRF-skipped (P2-2)** |
| POST /api/auth/firebase/refresh | pub (mint) | id_token string | authLimiter; CSRF-skipped |
| POST /api/auth/telegram | pub (mint) | verifyTelegramAuth (hash/id/auth_date freshness) + replay claim | authLimiter |
| POST /api/auth/telegram/webapp | pub (mint) | initData string + WebApp HMAC + replay claim (25h TTL) | authLimiter (via prefix mount) |
| GET /api/auth/telegram/callback | pub (mint) | same widget verification; redirect-only outputs | authLimiter ×2 mounts — **P1-1** |
| POST /api/auth/whatsapp/start | pub | phone string; orchestration cooldown/hourly/attempt caps | whatsappStartAuthLimiter 20/15m (CGNAT) |
| POST /api/auth/whatsapp/verify | pub | phone+code strings; referralCode ≤16 | authLimiter |
| GET /api/auth/probe | pub | 200-always contract | apiLimiter(IP) |
| GET /api/auth/providers | pub | — | apiLimiter(IP) | secrets masked ([SET]/bot_id derivation) |
| POST /api/auth/logout | user | — | userLimiter |
| POST /api/auth/logout-all-devices | user | — | userLimiter |
| GET /api/auth/me | user | — | userLimiter | private,max-age=30 |
| GET /api/auth/sessions | user | — | userLimiter | |
| DELETE /api/auth/sessions/:id | user | string param; ownership-scoped delete; 404 honest | userLimiter |
| GET /api/auth/providers/linked | user | — | userLimiter | |
| POST /api/auth/providers/unlink | user | presence-only (**P2-3/P2-4**) | userLimiter |
| POST /api/auth/onboarding/complete | user | — (no body) | userLimiter |

### 2.3 Catalog (public)
| METHOD path | Auth | Validation | Notes |
|---|---|---|---|
| GET /api/products | pub | query: category/search strings (parameterized, ILIKE), available_only=="true", sort whitelist, limit 500 | s-maxage 60/SWR 300; DTO leak-tested (cost_price/sku excluded) |
| GET /api/products/stats · /flash-sale · /catalog/stats · /flash-sale (aliases) | pub | — | edge-cache; sweep triggers |
| GET /api/products/by-slug/:slug | pub | slug trim/lower/≤160 | P3-10 inactive-product exposure |
| GET /api/products/:id | pub | intParam strict | same as above |
| GET /api/products/:id/recommendations | pub | intParam strict | |

### 2.4 User money/state paths
| METHOD path | Auth | Validation | Money guards |
|---|---|---|---|
| GET /api/orders | user | limit clamp [1,200] | no-store; credentials only while completed; refund-null aware |
| POST /api/orders | user | CreateOrderBody (z, generated) + coupon_code typeof string | riskSoftBlockGuard → idempotency(routeKey orders.create) → CheckoutService (in-tx claim, PRODUCT_STALE, coupon atomic, INVALID_PRICE) |
| GET /api/orders/:orderCode | user | stringParam | ownership-scoped |
| GET /api/wallet | user | — | no-store; delivered creds status-gated |
| GET /api/wallet/topups | user | — | limit 200; admin_note is the user-facing rejection channel (verified intended: TopupWaitingModal renders it) |
| POST /api/wallet/topups | user | CreateTopupBody (z) + ref ≤100 trim + amount (0,10000] + network/lypay conditionals + Libyan phone normalization | riskSoftBlockGuard → idempotency → advisory-lock tx + MAX_PENDING=3 + auto-reject heuristic |
| GET /api/support/tickets | user | — | ≤200 + DISTINCT ON latest reply |
| POST /api/support/tickets | user | CreateTicketBody (z: title≤255, message≤4000, category enum) | ticketCreateLimiter 5/h/user |
| GET /api/support/tickets/:id | user | intParam | ownership |
| POST /api/support/tickets/:id/reply | user | TicketMessageBody (z, ≤4000) | ownership + closed-check + ticketReplyLimiter 30/h/user |
| GET /api/loyalty · /loyalty/referrals | user | — | phone masking ✓ |
| POST /api/loyalty/convert-points | user | exact int-or-digit-string, ≥min, multiple-of, tx + optimistic lock + ledger row | 409 on conflict |
| POST /api/coupons/validate | user | ValidateCouponBody (.strict) | couponValidateLimiter 10/min (per-user key, ipKeyGenerator fallback) |
| GET /api/notifications · POST /read-all · POST /:id/read | user | intParam; honest 404 | no-store |

### 2.5 Cart
| METHOD path | Auth | Validation |
|---|---|---|
| GET /api/cart | user | — (30s flash-sale cache) |
| POST /api/cart/items | user | m: product_id number, variant_id number|null, quantity int [1,99]; product/variant existence+active+membership |
| PATCH /api/cart/items/:id | user | int param + quantity int [1,99] + ownership |
| DELETE /api/cart/items/:id · DELETE /api/cart | user | int param + ownership / scoped |

### 2.6 Admin (all under /api/admin; chain = requireAdmin [sid row + isActive + permissions] → scope gate → handler)
Public-by-design: POST /login (AdminLoginBody z + IP+username lockout, argon2, temp-token 10m), POST /login/verify-2fa (temp token HS256 + isTemp + isActive + per-admin 2FA lockout) — **both behind authLimiter; verify-2fa double-mounted (P1-1)**; GET /probe (200-always, sid-checked).

| Router (mount) | Routes | Scope | Extra guards |
|---|---|---|---|
| admin/auth (root) | GET /session, POST /logout (revokes sid), POST /change-password (old-pw + lockout + revoke-all), PATCH /profile (username 3–100; **display_name unbounded**), POST /2fa/setup (re-auth gate when disabling), POST /2fa/verify-setup | — (admin) | audit rows on all |
| admin/stats (root) | GET /stats, GET /chart-data (days 1–365) | — (admin) | 30s cacheWrap |
| copilot | POST /copilot/ask (phase1), POST /copilot/draft (phase2), GET /copilot/previews/:id, POST …/cancel, POST …/confirm (phase3 + risk tiers), POST …/double-confirm (phase3 high-risk), GET /copilot/history, GET/PATCH /copilot/settings (admins\|settings for PATCH) | per-leaf | copilotRateLimit; secret-scan on output; preview ownership by adminId; handoff for wallet/refund |
| risk (users scope) | GET /events (limit 1–200, level/eventType/from/to/userId, cursor), GET /events/:id (shown_at stamp), POST /events/:id/label (VALID_LABELS, notes ≤1000), POST /events/bulk-label (ids ≤100, filtered), GET /rules, PUT /rules/:id (DSL parse), GET/PUT /config (**P2-5 unvalidated nested**), GET /dashboard (hours 1–720), POST /risk/synth (dev-only 403 in prod) | users | audit rows |
| forecast (inventory) | GET /forecast/at-risk (limit 1–50), GET /forecast/products/:id | inventory | read-only |
| enrichment (inventory) | GET /enrichment/list (state whitelist, cursor), POST /enrichment/:id/publish (final_text optional), POST /enrichment/:id/reject (reason ≤500) | inventory | state machine 409 |
| topups (finance) | GET /topups (status enum z, page/limit clamp), POST /topups/:id/approve, POST /topups/:id/reject (TopupActionBody .strict, note ≤500) | finance | **idempotency** on both; ServiceError→status mapping |
| products (inventory) | GET /products (search ≤100), POST (CreateProductBody z), PATCH /:id (UpdateProductBody z), DELETE /:id (soft archive, honest 404), GET /:id/inventory (dedup preview; password excluded), POST /:id/inventory/set-count (int 0–100k, never fabricate), POST /:id/inventory (entries kind-checked, ≤500, server dedup, GCM at insert) | inventory | audit + sitemap bump + stock sweep |
| product-variants (inventory) | GET/POST /products/:id/variants, PATCH/DELETE /:id/variants/:variantId | inventory | label uniqueness probe; order-count delete guard 409; display-price refresh |
| pricing-calculator (inventory) | POST /pricing/calculate | inventory | product_id/price number; simulate_referred ===true |
| pricing-config (inventory) | GET/PUT /pricing/config, POST /pricing/recompute | inventory | **P3-7 Number() coercion**; service bounds 0.1–1000 / 0–10000% |
| flash-sales (inventory) | GET/POST /flash-sales, PATCH/DELETE /:id | inventory | discount 0–95, duration 5m–30d, singleton 23505→409, audit |
| users (users) | GET /users (page/limit), PATCH /users/:id (loyalty int 0–10M CAS 409; wallet via AdjustmentService w/ mandatory note; idempotency) | users | ledger + audit |
| referrals (users) | GET /referrals, POST /referrals/:id/credit (status-guarded tx; idempotency) | users | notification |
| tickets (support) | GET /tickets (status enum z, page/limit), GET /:id, POST /:id/reply (AdminReplyBody .strict ≤4000), PATCH /:id/status (whitelist, honest 404) | support | |
| alerts (support) | POST /test, GET /new, GET /unread-count, GET /, PATCH /read-all, PATCH /:id/read, DELETE /read, DELETE /:id, DELETE / | support | audit on dispatch; honest 404 |
| security (admins) | GET /auth-activity (NaN-date 400), GET /auth-stats, GET /auth-stats/summary | admins | |
| admins (admins) | GET /, POST / (username ≥3, password ≥8, sanitizePermissions + all-grant guard), PATCH /:id (self-edit ban, last-admins guard), POST /:id/disable, /:id/enable (re-enable ["all"] requires acting "all"), GET /scopes | admins | H9 self-escalation guards ✓; role string unvalidated (P3) |
| settings (settings) | GET /settings | settings | |
| observability (settings) | GET /summary, /alerts/recent, /deploys/recent, /sentry/summary, /metrics, /scheduler | settings | caches |
| diagnostics (settings) | GET /inventory-health, GET /, GET /sentry-debug, GET/POST /whatsapp/sessions, POST /:id/start, POST /:id/pair-code, GET /:id/qr, DELETE /:id, POST /telegram-test | settings | audit rows; gateway error mapping |
| orders (orders) | GET /orders (status enum, search, page/limit), PATCH /orders/bulk-status (ids dedup+validation, refunded via RefundService per-order, state-machine guards, honest counts, idempotency) | orders | F-005/F-008 closed |
| auth-settings admin (mounted at /api/admin/settings) | GET /auth, PATCH /auth/:id (per-provider field schema .strict, lengths ≤500/4000, audit keys-only) | admin+settings | masked secrets |

### 2.7 Non-HTTP mounted surface
- **Socket.IO** (`initSocket` in `lib/socket.ts`, server.ts): origin allowlist at handshake, user+admin token verify (HS256, separate secrets), DB-backed liveness re-verify (5min), server-driven room join, per-IP (5) + total (2000) connection caps. Out of strict HTTP scope; no gate defects found.
- Root SPA/share-card/static handlers (app.ts 843–963) — bot-UA gated, DB failure falls through to SPA.

---

## 3. Findings

### P0
None found. (P1-1 escalates to P0 the moment TOTP is enabled on the operator account — see below.)

---

### [P1-1] Same `authLimiter` instance double-mounted on overlapping prefixes → ERR_ERL_DOUBLE_COUNT → 500 on two live auth routes
- **Where**: `backend/src/app.ts:808–814`
- **Evidence**:
  ```ts
  app.use("/api/admin/login", authLimiter);            // line 808
  app.use("/api/admin/login/verify-2fa", authLimiter); // line 809 — prefix of 808 ALSO matches this path
  ...
  app.use("/api/auth/telegram", authLimiter);           // line 813
  app.use("/api/auth/telegram/callback", authLimiter); // line 814 — prefix of 813 ALSO matches
  ```
  `app.use(path, mw)` is a **prefix** match: a request to `/api/admin/login/verify-2fa` runs the line-808 limiter AND the line-809 limiter; a request to `/api/auth/telegram/callback` runs both line-813 and line-814 limiters. Same `authLimiter` **instance** → same store + same default `ipKeyGenerator` key.
  Installed library (`node_modules/express-rate-limit/dist/index.cjs`, v8.4.1) — the middleware flow after `store.increment(key)`:
  ```js
  config.validations.singleCount(request, config.store, key);   // throws after the 2nd increment
  ...
  singleCount(request, store, key) {
    ...
    if (keys.includes(prefixedKey)) {
      throw new ValidationError("ERR_ERL_DOUBLE_COUNT",
        `The hit count for ${key} was incremented more than once for a single request.`);
    }
  ```
  `handleAsyncErrors` forwards the throw to `next(err)` → the app.ts global handler (no `.errors` array on ValidationError) → **500 INTERNAL_ERROR**. Validations default to enabled (`parseOptions`: `notUndefinedOptions?.validate ?? true`). The counter is also incremented **twice** per attempt before the throw (2× budget burn).
- **Why it matters**: 
  1. `POST /api/admin/login/verify-2fa` — **every** 2FA completion 500s. With TOTP enabled, admin login (money approvals, refunds) is unavailable. Dormant today only if the single operator has TOTP off; it hard-fails the day it's switched on (and 2FA setup is actively recommended in the codebase).
  2. `GET /api/auth/telegram/callback` — redirect-mode Telegram login ("primary transport" for mobile/in-app browsers per auth-settings.ts:315) 500s on every attempt instead of redirecting to `/auth/callback`.
  3. Invisible to CI: no test imports the full `app` (verified — only `server.ts` imports it); all route tests mount routers standalone, so the composition bug is untested.
- **Minimal fix**: delete the two redundant explicit mounts (the prefix mounts already cover those exact paths), or mount a *separate* limiter instance per path:
  ```ts
  app.use("/api/auth/telegram", authLimiter);            // covers POST /telegram, /webapp, GET /callback
  // remove: app.use("/api/auth/telegram/callback", authLimiter);
  app.use("/api/admin/login", authLimiter);              // covers POST /login + /login/verify-2fa
  // remove: app.use("/api/admin/login/verify-2fa", authLimiter);
  ```
  Then add a composition test that boots `app` (or replicates lines 804–829) and asserts 200/401 (not 500) for `GET /api/auth/telegram/callback?hash=x` and `POST /api/admin/login/verify-2fa`.

---

### [P2-1] `/api/metrics` admin-JWT path bypasses session revocation, disable, and sid-less rejection
- **Where**: `backend/src/routes/metrics.ts:44–59`
- **Evidence**: 
  ```ts
  const jwt = req.cookies?.admin_token || presentedToken;
  if (jwt) {
    const result = verifyAdminTokenDetailed(jwt);
    if (result.ok && result.payload.isTemp !== true) { next(); return; }
  }
  ```
  No `isValidAdminSession(sid, adminId)` (A8-01 revocation truth), no `admin_users.is_active` check, and sid-less tokens are accepted **in production** — all three checks that `requireAdmin` (middlewares/requireAdmin.ts:75–134) enforces. The route already rejects the 2FA temp token (SEC-92-02) but stopped short of A8-01.
- **Why it matters**: a logged-out, password-changed, or soft-disabled admin keeps full Prometheus telemetry access (`/api/metrics` = every label series, request volumes, DB latencies) for up to the 8h JWT TTL; pre-migration sid-less tokens that `requireAdmin` rejects still pass here. Inconsistent revocation posture across the admin surface.
- **Minimal fix**: reuse `requireAdmin` as the JWT branch (or call `isValidAdminSession` + isActive + prod-sidless-reject inline), keeping the static `METRICS_ADMIN_TOKEN` path first. Note `requireAdmin` needs a DB lookup — acceptable at metrics polling cadence, or cache 60s like session-liveness.

---

### [P2-2] CSRF gate skip on the session-mint endpoints leaves a login-CSRF / session-fixation window
- **Where**: `backend/src/app.ts:700–706` (skipPaths)
- **Evidence**:
  ```ts
  const skipPaths = [
    "/api/auth/firebase/session",
    "/api/auth/firebase/refresh",
    ...
  ```
  A cross-site `<form method="POST">` to `/api/auth/firebase/session` (CORS-simple request, no preflight) carries the hostile page's `Origin` — but the skip runs **before** any origin check, so the gate passes unconditionally. The handler mints a session for whatever Firebase ID token is in the body and `Set-Cookie`s it on the victim's browser.
- **Why it matters**: classic **login CSRF** — an attacker page can silently log the victim into the *attacker's* account. The victim then "tops up" their wallet through the normal UI (which has correct Origin) — depositing real money into the attacker-controlled account (topup approval credits that account). The code comment ("ID-token signature is the real auth; Origin is belt+suspenders") covers token forgery but not the fixation scenario. Note the SPA itself always sends `Origin` on `fetch`, so the skip buys nothing for the legitimate client; it was added for COOP-isolated popup edge cases on *refresh*.
- **Minimal fix**: stop skipping `/api/auth/firebase/session` (require allow-listed Origin/Referer like every other mutating route); keep the skip only for `/refresh` if the popup-edge-case is real, or apply the existing `hasAuthCookie && !origin && !referer → 403` sub-check to skipped paths too (prevents re-binding an already-logged-in victim, the most damaging variant).

---

### [P2-3] `POST /api/auth/providers/unlink` "last auth method" check reads ONE arbitrary identity row → false refusal
- **Where**: `backend/src/routes/auth.ts:224–247`
- **Evidence**:
  ```ts
  const [identity] = await db.select().from(userAuthIdentitiesTable)
    .where(eq(userAuthIdentitiesTable.userId, userId)).limit(1);   // no ORDER BY — arbitrary row
  const hasOtherIdentity =
    identity && (identity.provider !== provider || identity.providerUid !== provider_uid);
  if (!hasOtherIdentity) { ... 400 "لا يمكن فصل آخر طريقة مصادقة" }
  ```
  For a user with ≥2 identities, when the scan-order row happens to be the *target* identity, `hasOtherIdentity` is false and the unlink is refused even though another method exists (e.g. Telegram + Google linked, unlinking Telegram is refused depending on row order).
- **Why it matters**: real functional defect on a user path — unlink is non-deterministically refused; support burden; the check is also simply the wrong query shape.
- **Minimal fix**: count instead of peek:
  ```ts
  const [{ n }] = await db.select({ n: count() }).from(userAuthIdentitiesTable)
    .where(and(eq(userAuthIdentitiesTable.userId, userId),
               not(and(eq(provider), eq(providerUid)))));
  if (n === 0) → 400
  ```

---

### [P2-4] `POST /api/auth/providers/unlink` accepts non-string `provider`/`provider_uid` → silent no-op success (200-for-failure class)
- **Where**: `backend/src/routes/auth.ts:199–206`
- **Evidence**: `const { provider, provider_uid } = req.body as { provider?: string; provider_uid?: string };` followed only by `if (!provider || !provider_uid) 400`. A body `{"provider": 5, "provider_uid": 7}` passes the truthiness gate, flows into `eq(textColumn, 5)` (driver serializes to `'5'`), matches no rows, deletes nothing — and returns `{ success: true, message: "تم فصل مزود المصادقة" }`. The codebase systematically eliminated exactly this class elsewhere ("silent no-op → 404, audit §5"); this route predates it.
- **Why it matters**: client bugs are indistinguishable from success; no type/length validation on either field (a 1MB string also flows straight into the query).
- **Minimal fix**: `typeof provider !== "string" || typeof provider_uid !== "string" || !provider.trim() || !provider_uid.trim() || provider.length > 100 || provider_uid.length > 200` → 400; and check `deleted.count > 0` from `.returning()` → 404 when nothing matched.

---

### [P2-5] `PUT /api/admin/risk/config` persists unvalidated nested shapes (thresholds types, allowlist arrays)
- **Where**: `backend/src/routes/admin/risk.ts:470–560`
- **Evidence**: `body.thresholds?.low` etc. are used with `??` fallbacks and only an ordering comparison (`low < medium < high < critical`) — a string threshold (`"30"`) passes JS coerced comparisons and is persisted into the jsonb column as a string; `allowlist.ips` accepts `Array.isArray` only — items can be objects/numbers and arrays are unbounded in length:
  ```ts
  const allowlist = { ips: Array.isArray(body.allowlist?.ips) ? body.allowlist!.ips : currentAllow.ips, ... };
  const updated = { thresholds, allowlist, ... };
  await db.update(riskConfigTable).set(updated)...;
  ```
- **Why it matters**: every downstream consumer (`getRiskConfig` → scoring comparisons, `isAllowlisted`) trusts these types; a string/NaN threshold silently disables level gating, and a 10k-entry or object-valued allowlist corrupts the allowlist matcher and bloats the singleton row. Admin-only, so not P1, but it's a config-corruption path on the risk pipeline's control surface.
- **Minimal fix**: zod schema for the PUT body (`thresholds: {low/medium/high/critical: number().finite().min(0).max(100)}`, `allowlist: {ips: string().ip().array().max(100)...}`, `requireApprovalUserIds: number().int().positive().array().max(1000)`) — reject on mismatch; then keep the existing ordering invariant check.

---

### P3 findings

1. **[P3-1] Stale rate-limit doc on the WhatsApp router** — `routes/auth-whatsapp.ts:23` claims `app.use("/api/auth/whatsapp", authLimiter)`; the actual mounts are the split start(20/15m)/verify(10/15m) limiters (app.ts:822–823). Doc drift misleads future edits (and invites exactly the P1-1 mistake).
2. **[P3-2] Dead export `requireRole`** — `middlewares/requireAdmin.ts:144` exported, zero callers (grep-verified). The unvalidated `role` string accepted by `POST /api/admin/admins` (admins.ts:115, any string like `"super_admin"`) is cosmetic today *only because* nothing reads role for authorization — remove the dead gate or validate the role enum so the field can't become a silent privilege label later.
3. **[P3-3] `riskHardBlockMiddleware` exported but never mounted** — `middlewares/risk-hard-block.ts:36`; documented as flag-gated phase-3, but there is currently **no route** that consults `hard_block` rows. When `risk_config.autoBlockEnabled.hardBlock` flips true, nothing enforces it — wire it (same money paths as the soft guard, after requireUser) or note the dead flag in the admin UI.
4. **[P3-4] No `iss`/`aud` claims on user/admin JWTs** — `lib/jwt.ts:103–171`. HS256 pinned + separate secrets already prevents algorithm/confusion attacks; adding `iss/aud` (+ verify) would future-proof against a second token audience (e.g. the worker tier or socket-only tokens).
5. **[P3-5] Generated zod bodies lack string bounds** — `CreateProductBody`/`UpdateProductBody` (`name/description/image_url/category/usage_terms` no min/max), `AdminLoginBody` (`username/password` unbounded). Bounded by the 1MB JSON limit and argon2's own handling, but `name: ""` inserts a product with fallback slug and 1MB description text lands in the catalog row. Add OpenAPI `maxLength`/`minLength` and regenerate.
6. **[P3-6] `CreateOrderBody` has no integer constraint** — `product_id: z.number()` (generated, api.ts:439–448); `1.5`/`2**53` pass zod and fall through to a 404 from the int column comparison. Cheap win: `.int().positive()`.
7. **[P3-7] `PUT /pricing/config` stringly-typed numbers** — `admin/pricing-config.ts:45–46`: `round2(Number(body.usd_to_lyd))` accepts `"10"` (string) as 10. Service bounds catch out-of-range but not silent string coercion; use `typeof === "number"` or a zod schema.
8. **[P3-8] `PATCH /api/admin/profile` display_name unbounded** — `admin/auth.ts:550–551` (username is bounded 3–100; `displayName` only `.trim()`ed).
9. **[P3-9] `CreateCouponBody` is not `.strict()`** — `coupons.ts:27–41` strips unknown keys silently while `PatchCouponBody`/`ValidateCouponBody` (same file) are `.strict()`. Inconsistent posture within one router.
10. **[P3-10] Inactive-product detail exposure** — `products.ts:348–353` & `416–427` filter `isArchived=false` but not `isActive=true` (the list endpoint filters both). A deactivated product's full detail (description/faq/pricing) is fetchable by id/slug; frontend renders an is_active state and checkout refuses (verified checkout.service.ts:167), sitemap excludes. Consistency gap only.
11. **[P3-11] Inconsistent query-enum validation in risk events** — `admin/risk.ts:76–90`: invalid `?level=` is *silently ignored* (unfiltered result) while invalid `?eventType=` 400s. Also `admin/referrals.ts:13–35` `?status=` unvalidated (parameterized, so safe — just silent-empty).
12. **[P3-12] `alerts.ts` `req.log` without fallback in 4 handlers** — `admin/alerts.ts:140,152,165,175` use `req.log.error` directly while `/test` and `/new` (lines 76, 108) deliberately added `(req.log ?? logger)` for bare-router consumers. Same inconsistency class they already fixed once.
13. **[P3-13] `GET /api/coupons/admin` unpaginated** — full-table select; fine at current scale, but every sibling admin list clamps page/limit.
14. **[P3-14] Dead CSRF skip entry `/health`** — `app.ts:705`: no `/health` route exists (only `/healthz*`); harmless but masks intent (probes skip CSRF anyway for GET).

---

## 4. Audit-area verdicts (requested checks)

**2. Mounting** — All 48 exported routers mounted (cross-checked every `export ... Router` against mounts in `routes/index.ts`, `routes/admin/index.ts`, `routes/admin/copilot/index.ts`, `app.ts`). No orphan routers. No duplicate method+path registrations (the `/api/admin/settings` dual-mount of `adminSettingsRouter` + `authProviderAdminRouter` is complementary, no overlap). Express route-order pitfalls handled (`/by-slug` before `/:id`, `/read-all`+`/read` before `/:id`, `/stats`+`/flash-sale` before `/:id`). Middleware order correct everywhere except P1-1 (limiter overlap) and P2-2 (CSRF skip list).

**3. Zod/validation completeness** — Every POST/PATCH/PUT body is validated *somewhere* (zod, generated schemas, or manual runtime checks); the gaps are enumerated above (P2-4, P2-5, P3-5…P3-9, P3-11). `.strict()` used on 6 of ~15 zod schemas (inconsistent — P3-9). Coercion edges: negative numbers rejected everywhere money is involved (amount>0, quantity ≥1, cost ≥0.01, loyalty 0–10M, discount 0–95); arrays-where-object-expected all handled (`Array.isArray` guards in bulk-status, unlink (P2-4), risk config (P2-5), cwv, telegram initData); unicode accepted everywhere (Arabic-first product), with locale-correct uppercase only on coupon/referral codes. Query params: clamped/whitelisted on all paginated admin routes; enum filters validated except P3-11.

**4. Auth guard matrix** — Public: healthz/live/summary, probe, providers, all mint endpoints, cwv, webhook(secret), catalog. User: everything in §2.2–2.5 — every one ownership-scoped by `userId` in WHERE (verified per route; no route trusts a client-sent role or userId). Admin: everything behind requireAdmin + scope, with three hardening layers verified (sid revocation, isActive, permissions re-read per request; self-escalation guards on `admins` router; last-admin guards). Exceptions found: metrics auth (P2-1). JWT: HS256 **pinned** on every verify (A8-08), separate ADMIN_JWT_SECRET with prod fail-fast, 32-char minimums, temp-token rejected at 3 separate gates (requireAdmin, metrics, admin probe). Cookie-first, Bearer fallback consistently on requireUser/requireAdmin/probe/metrics. No client-side role trust anywhere. iss/aud absent (P3-4).

**5. Error contract** — Uniform `{error (Arabic), code (ErrorCode), details?}` via `createErrorResponse` on ~95% of paths; global handler guarantees the shape for anything thrown (SyntaxError→400, ZodError→400 with issues, `.errors[]`→400, else 500). Status code usage is deliberate and mostly correct: 400 input, 401 auth, 403 CSRF/scope, 404 missing (honest-404 pattern applied to 8 routes), 409 conflicts (TOCTOU, idempotency key reuse, singleton flash sale, refunded-terminal), 422 unused (fine), 423 soft-block guard, 429 rate/lockout, 502/503/504 gateway semantics on whatsapp paths, 207 partial bulk-refund. One 200-with-error-ish shape: telegram-webhook always-200 (intentional, Telegram retry semantics). Message leakage: global handler never passes `err.message`; admin-only diagnostics surfaces (`/healthz/ready`, observability `/metrics`) do (acceptable, admin-gated). Firebase/OtpError mappers return localized copy, never raw provider messages.

**6. Async error handling** — Express **5.2.1**: rejected promises from async handlers are forwarded to the error middleware natively — the Express-4 crash class is structurally closed. Fire-and-forget paths audited: `fireThrottledMaintenance` (internal try/catch ✓), `void dispatch(...)` telegram notifies (retry loop with per-attempt catch ✓), `scoreEventFireAndForget` (self-catching by contract), wallet's inline telegram approval IIFE (full try/catch ✓), socket emits wrapped in `.catch` ✓. `void writeAuditLog(...)` — writeAuditLog has its own internal catch (per its comments; consistent with tests). No unguarded floating promise found that could trigger Node's unhandled-rejection crash.

**7. Response hygiene** — Verified: no password hashes or `passwordHash` anywhere in responses; `cost_price`/`sku` confined to admin DTOs (public variant projection excludes them — leak-tested); delivered credentials decrypted only for `status==="completed"` and nulled by refund lifecycle; user-facing orders/wallet/support scoped + `no-store`; `admin_note` on user topups is the *intended* rejection-reason channel (verified against TopupWaitingModal). No mutable object references returned (all responses are fresh literals/`map` results). HEAD/OPTIONS: Express default (HEAD→GET, OPTIONS→Allow) + `cors()` preflight ahead of the CSRF gate. Unknown `/api/*` subpaths → JSON 404 (app.ts:832) — never the SPA. Share-card HTML is entity-escaped. Sessions list exposes the user's own UA/IP only.

---

## 5. Counts

| Severity | Count |
|---|---|
| **P0** | 0 |
| **P1** | 1 (P1-1) |
| **P2** | 5 (P2-1…P2-5) |
| **P3** | 14 (P3-1…P3-14) |
| **Total** | **20** |

## 6. Files audited (read end-to-end or targeted)

**Composition**: `backend/src/app.ts`, `server.ts`, `index.ts`, `routes/index.ts`, `routes/admin/index.ts`, `routes/admin/copilot/index.ts`
**Middlewares**: `requireUser.ts`, `requireAdmin.ts`, `idempotency.ts`, `risk-soft-block.ts`, `risk-hard-block.ts` (unmounted), `requireCopilotPhase.ts`/`requireCopilotPermission.ts` (mount-verified), `cloudflareClientIp.ts`, `correlation.ts`, `instrumentation-isolation.ts`, `metrics.ts` (mount-level)
**Route files (all 48)**: `auth.ts`, `auth-settings.ts`, `auth-whatsapp.ts`, `telegram-webhook.ts`, `products.ts`, `orders.ts`, `wallet.ts`, `cart.ts`, `coupons.ts`, `loyalty.ts`, `notifications.ts`, `support.ts`, `health.ts`, `metrics.ts`, `cwv.ts`, `seo.ts`; `admin/auth.ts`, `admin/topups.ts`, `admin/orders.ts`, `admin/users.ts`, `admin/referrals.ts`, `admin/tickets.ts`, `admin/alerts.ts`, `admin/stats.ts`, `admin/security.ts`, `admin/settings.ts`, `admin/flash-sales.ts`, `admin/products.ts`, `admin/product-variants.ts`, `admin/pricing-config.ts`, `admin/pricing-calculator.ts`, `admin/forecast.ts`, `admin/enrichment.ts`, `admin/observability.ts`, `admin/diagnostics.ts`, `admin/admins.ts`, `admin/risk.ts`; `admin/copilot/ask.ts`, `draft.ts`, `previews.ts`, `history.ts`, `settings.ts`, `index.ts`
**Supporting libs verified for claims**: `lib/jwt.ts`, `lib/errors.ts`, `lib/http.ts`, `lib/permissions.ts`, `lib/lockout.ts`, `lib/opportunistic.ts`, `lib/body-parser-recovery.ts`, `lib/socket.ts` (handshake model), `telegram.ts` (notify fire-and-forget), `services/checkout.service.ts` (isActive guard), `shared/api-zod/src/generated/api.ts` (CreateOrderBody/CreateTopupBody/CreateProductBody/UpdateProductBody/AdminLoginBody), `node_modules/express-rate-limit/dist/index.cjs` (singleCount/ValidationError), `pnpm-lock.yaml` (express 5.2.1)
**Tests consulted (not run)**: `routes/__tests__/catalog-security.test.ts`, `metrics-auth.test.ts`, `body-schema-400s.test.ts`, `intparam-strict.test.ts`, `auth-whatsapp-settling.test.ts`, plus grep-level survey of the rest.

— End of report —

---

## CORRECTION (post-audit experimental verification, 2026-09-20 round-98 fix wave)

**P1-1 severity corrected: P1 → P2.** The finding's core (same `authLimiter` instance double-mounted on overlapping prefixes → the limiter runs twice per request) was verified TRUE, and the fix (removing the two redundant mounts) is correct and landed. Two stronger claims were **experimentally disproven** against the installed express-rate-limit 8.4.1 + Express 5.2.1:

1. **No hard 500.** The library's validation wrapper (`getValidations` → `wrappedValidations[name]` → `catch (error) { logger.error(error) }`) catches its own ValidationError and never re-throws it — `ERR_ERL_DOUBLE_COUNT` cannot reach the global error handler.
2. **Not even a logged ERR_ERL_DOUBLE_COUNT.** The middleware calls `config.validations.disable()` at the end of EVERY invocation (dist line ~974) — so by the time the second mount's wrapper runs (same request), all validations are already off; `singleCount` executes only once per limiter lifetime (the first invocation).

**The verified real defect:** double budget burn — one request increments the key twice (verified: `used=2` after a single request; a 10/15min budget behaved as 5/15min on `/api/admin/login/verify-2fa` and `/api/auth/telegram/callback`). The regression guard (`routes/__tests__/limiter-composition.test.ts`) pins the double-burn invariant behaviorally (limit 2: one caller exhausts it) instead of a 500. The "escalates to P0 the day TOTP is enabled" note is void — with the fix landed, 2FA completion works normally.
