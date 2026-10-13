# Lane E findings — R142 (backend APIs & business logic)

Read-only audit @ a9f5e83. Charter: routes/, services/, middlewares/, lib/ (minus cross-cut subjects), app.ts, server.ts, index.ts. Ponytail 6 lenses. Load assumed: production single-instance web + dormant worker tier, Libyan Arabic storefront, admin console = 1-2 operators.

**What this layer does:** an Express + TS API (173 implemented ops, 111 OpenAPI-documented, 89 allowlisted gaps — parity gate re-verified green by lanes A/N this round) serving the built SPA, with cookie-first auth, Redis-backed rate limits + caches with in-memory fallbacks, idempotent boot migrations, and a money core owned by lane G.

---

## Findings (ranked)

### E-1 (P3) — Copilot preview "single-use" enforcement is check-then-act, not an atomic claim; concurrent double-confirm double-executes

- **Files:** `backend/src/services/copilot/preview-store.ts:112-135` (`claimUnconsumedPreview`), `:189-210` (`claimHighRiskForExecute`), `:138-143` (`markConsumed`), `backend/src/services/copilot/executor.ts:49-57, 164-174, 358-362`
- **What this is:** the AI-copilot draft→confirm→execute pipeline. Low-risk confirm: claim preview → staleness check → one tx (product update + `copilot_actions` + `audit_logs`) → `markConsumed` **after** the tx. High-risk double-confirm: same shape, but the `consumedAt` stamp is inside the tx.
- **Problem:** both `claim*` functions are plain `SELECT`s (the doc block at preview-store.ts:8-10 says "Single-use enforcement is encoded in the SQL" and executor.ts:112-115 says "Atomically claim … The caller MUST update the row within the same transaction" — the callers don't). `markConsumed` stamps with a bare `WHERE id = …` (no `AND consumed_at IS NULL`), and the high-risk in-tx stamp at executor.ts:359-362 is likewise unconditional. Two concurrent confirms that both pass the claim SELECT before either commits both run the transaction: the product is written twice (same payload values, so no catalog corruption) but **two `copilot_actions` rows and two `audit_logs` rows are committed for one admin intent** — the audit trail the feature exists to keep is duplicated, and the second execution is invisible as a duplicate. The staleness guard only catches the second request *after* the first commit lands (`updatedAt` moves), so a genuine double-click inside the tx window races through. Defense-in-depth bounds the harm: phase flags default off, `copilotRateLimit` gates clicks, price/cost re-validated at the write boundary (executor.ts:268-290), only catalog fields are executable today.
- **Fix (4 lines):** make the consumed stamp a conditional claim — `markConsumed`: `.where(and(eq(id), isNull(consumedAt)))` + return row count; in both executor txs throw when the stamp matched 0 rows (rollback). The route then honestly 409s the second click. One small test: fire two confirms against one preview, assert one action row.
- **If we skip it:** duplicate audit/action rows on copilot confirm races; no monetary or catalog damage possible today.

### E-2 (P4) — Malformed-body logs ship an 80-char raw body preview that can contain plaintext passwords

- **File:** `backend/src/lib/body-parser-recovery.ts:102-111`
- **What this is:** the defensive handler for un-parseable JSON bodies (bot probes on `/api/auth/*`).
- **Problem:** the warn log carries `bodyPreview: rawBody.slice(0, 80)`. `rawBody` is the *string* the JSON parser failed on — pino's `REDACT_PATHS` (logger.ts:71-177) redacts *object fields* (`body.password`, `*.password`), never substrings inside a string field. A client that sends malformed JSON credentials (`{"password":"hunter2",` — truncated body on a flaky mobile network is the legitimate case) has its password written verbatim to the log stream at warn level.
- **Fix (1 line):** drop `bodyPreview` from the log object (path/method/content-type already identify the probe), or log only `rawBody.length`.
- **If we skip it:** operator-only log exposure; realistic frequency is low (bot probes dominate) but it contradicts the F-012/93-A1 redaction design the rest of the file's neighbors enforce.

### E-3 (P4) — `verify-2fa` catch-all converts DB outages into a silent uniform 401

- **File:** `backend/src/routes/admin/auth.ts:415-419`
- **Problem:** the endpoint's entire body sits in one `try { … } catch { return 401 "جلسة غير صالحة" }`. The catch exists for `jwt.verify` rejections (expected noise), but it also swallows failures from `isValidAdminSession`, the admin row select, `createAdminSession`, and `recordFailedAttempt` — a Postgres blip mid-2FA looks identical to a bad temp token, produces **zero log lines and zero Sentry events**, and the operator sees "session invalid" during a DB outage. Fail-closed direction is correct (401, not 500); the telemetry hole is the finding.
- **Fix (2 lines):** inside the catch, `logger.warn`/`captureSubsystemException("auth", err, { route: "verify-2fa" })` before the 401 — jwt-verify noise is already rate-limited by authLimiter, so volume is not a concern.
- **If we skip it:** DB outages during admin 2FA are unobservable; no security impact (still fails closed).

### E-4 (P4) — executor dead import + a promised "second read" that never happens

- **File:** `backend/src/services/copilot/executor.ts:50-57`
- **Problem:** on claim failure the comment says "Distinguish the three 'not claimable' cases for the route to map to 404/410/409 — the cheaper way is a second read", then does a dynamic `import("@workspace/db")` that is immediately `void`-ed and returns `{ kind: "not_found" }` for consumed/expired/wrong-owner alike. Dead code + comment/behavior mismatch (the route cannot map what it never receives).
- **Fix:** delete lines 53-56 and either do the promised `getOwnedPreview` re-read or fix the comment. (The GET previews route already distinguishes 404/410 with its own read, so behavior is fine.)

### E-5 (P4) — `GET /api/auth/sessions` is the only user list endpoint with no LIMIT

- **File:** `backend/src/routes/auth.ts:805-809`
- **Problem:** every other list on the user surface got the clamp treatment (notifications R128-IMP-5, admin lists R127-L5, coupons AUD103-4-F9); the device list is a bare `select … where userId … order by createdAt desc` — no `limit`. Bounded in practice by the 30-day session expiry filter + authLimiter (10/15 min per IP) on mints, but it's the one unbounded-query outlier of the Scale census, and the route renders every row's UA + IP into the response.
- **Fix (1 line):** `.limit(200)` (matches the sessions UI's use; a user with >200 live sessions has a bug, not a device list).

### E-6 (P4) — support ticket create and reply are two-statement writes without a transaction

- **File:** `backend/src/routes/support.ts:139-153` (ticket + first reply), `:252-264` (reply + status flip)
- **Problem:** POST `/` inserts the ticket then the first reply; a reply-insert failure (constraint, connection) leaves a ticket row with zero replies — an unreachable empty thread the UI renders as created-but-blank. POST `/:id/reply` inserts the reply then flips status to `in_progress`; a status-flip failure leaves the reply stored while the queue still shows `open`. No money, no data loss (all user-authored content), but both are the "writes in the wrong order without rollback" Ponytail shape.
- **Fix (2 wrappers):** wrap each pair in `db.transaction` — both handlers already hold all values locally; nothing else changes.

### E-7 (P4) — dead boolean in the partial bulk-refund response

- **File:** `backend/src/routes/admin/orders.ts:603`
- **Problem:** the 207 branch is only reached when `failures.length > 0`, so `success: failures.length === 0` is statically `false` — a reader must prove the branch condition to know what the field says. The frontend keys off `failed[]` anyway (D lane verified).
- **Fix (1 literal):** `success: false`.

---

## Route inventory truth (all mounts from app.ts → routes/index.ts → admin/index.ts)

Auth column: `public` = no session required (has own guards: HMAC/signature/secret/lockout); `user` = requireUser; `admin(scope)` = requireAdmin + path-scoped requirePermission. Validation = zod (generated `@workspace/api-zod` or local) or digit-exact `intParam`/manual type-guards at the boundary. Rate-limit = app.ts limiter mounts (authLimiter 10/15m, whatsappStart 20/15m, couponValidate 10/min, money-intent 12/min, apiLimiter, userLimiter) + in-route limiters. Tested = route-level suite exists at HEAD (this lane's census).

| Route | Auth | Validation | Rate-limit | Tested |
|---|---|---|---|---|
| GET /api/healthz{,/live,/summary} | public | shape (HealthCheckResponse) | apiLimiter (logged-skip) | health-* suites (M) |
| GET /api/healthz/{firebase,ready,redis,neon,worker,socket} | admin(settings) | — | apiLimiter | health-* suites |
| POST /api/auth/firebase/{session,refresh} | public (id_token verify) | type-guard + service | authLimiter | auth-firebase-* |
| POST /api/auth/telegram (+webapp, callback) | public (HMAC) | service-side | authLimiter | telegram suites (H) |
| POST /api/auth/whatsapp/{start,verify} | public (OTP) | service-side | start/verify split limiters | auth-whatsapp-* |
| GET /api/auth/{providers,probe,me,sessions} | user (probe 200-always) | — | userLimiter | auth-sessions/probe |
| POST /api/auth/{logout,logout-all-devices,onboarding/complete,providers/unlink}, DELETE /api/auth/sessions/:id | user | unlink: type+length guards | userLimiter | auth-unlink |
| GET /api/products{,/stats,/flash-sale,/by-slug/:slug,/:id,/:id/recommendations} + aliases /catalog/stats,/flash-sale | public | intParam/slug | apiLimiter + edge cache | products-* (I) |
| GET/POST/PATCH/DELETE /api/cart{,/items,/items/:id} | user | manual integer/type guards, MAX_QTY 99 | userLimiter | cart (28 ✓ re-run) |
| POST /api/orders, GET /api/orders{,/:orderCode} | user | generated zod (G) | ordersCreateLimiter 12/min + idempotency | orders-* (G) |
| GET /api/wallet{,/topups,/ledger}, POST /api/wallet/topups | user | generated zod (G) | topupCreateLimiter 12/min + idempotency | wallet-* (G) |
| POST /api/loyalty/convert-points, GET /api/loyalty{,/ledger,/referrals} | user | generated zod (G) | convertLimiter 12/min + idempotency | loyalty (G) |
| GET/POST /api/coupons/validate | user | local zod | couponValidateLimiter 10/min | coupons-validate (11 ✓ re-run) |
| {GET,POST,PATCH,DELETE} /api/coupons{/admin/:id} | admin(finance) | generated+zod extend | userLimiter | coupons-schema |
| GET/POST/PATCH/DELETE /api/support/tickets{,/:id,/:id/reply} | user | local zod, 4000-char cap | 5/h + 30/h per-user | support-reply |
| GET /api/notifications{, ?page}, POST {/read-all,/:id/read} | user | intParam, pageParam/limitParam | userLimiter | notifications |
| POST /api/webhook/telegram | public (secret + allowlist) | service-side | apiLimiter | telegram-webhook (L) |
| GET /api/metrics | METRICS_ADMIN_TOKEN / admin-JWT | — | apiLimiter | metrics-auth |
| POST /api/cwv | public | hand-rolled validator + label table | 30/min session cap | cwv |
| GET {/robots.txt,/sitemap.xml} | public | — | — | seo (K) |
| POST /api/admin/login{,/verify-2fa}, GET /api/admin/{probe,session} | public→requireAdmin | AdminLoginBody + bounds | authLimiter | admin-auth-lockout |
| POST /api/admin/{logout,change-password,2fa/*}, PATCH /api/admin/profile | admin | type+length guards + lockout | userLimiter | admin-auth-lockout |
| GET /api/admin/{stats,chart-data} | admin | — | userLimiter | admin-stats-emit |
| GET/PATCH /api/admin/orders{,/:id/credentials}, PATCH /api/admin/orders/bulk-status | admin(orders; +finance for refund) | status zod + intParam + 200-id cap | userLimiter + idempotency + credentials gate | admin-orders-* (13 ✓ re-run) |
| GET /api/admin/topups, POST /api/admin/topups/:id/{approve,reject} | admin(finance) | TopupActionBody + intParam | userLimiter + idempotency | topup suites (G) |
| GET /api/admin/users, PATCH /api/admin/users/:id | admin(users; +finance for money) | manual bounds + note required | userLimiter + idempotency | admin-adjustment-idempotency |
| {GET,POST,PATCH,DELETE} /api/admin/products{,/:id,/:id/inventory,set-count} | admin(inventory) | generated zod + column bounds | userLimiter | inventory-encryption + products suites |
| /api/admin/products/:id/variants{,/:variantId} | admin(inventory) | generated zod (variants) | userLimiter | variant-availability-pricing |
| /api/admin/pricing/{calculate,config,recompute} | admin(inventory) | generated zod | userLimiter | pricing (N cross-cut) |
| {GET,POST,PATCH,DELETE} /api/admin/flash-sales{,/:id} | admin(inventory) | local zod | userLimiter | admin-flash-sales |
| GET /api/admin/referrals, POST /api/admin/referrals/:id/credit | admin(users; +finance at route) | enum filter | userLimiter + idempotency | coupons-referrals-audit |
| GET /api/admin/tickets{,/:id}, POST /:id/reply, PATCH /:id/status | admin(support) | message caps | userLimiter | **NONE (census)** |
| /api/admin/risk/{events,rules,config,dashboard,synth} | admin(users) | zod + DSL parse | userLimiter | admin-risk-config + risk-* (3 files) |
| /api/admin/{auth-activity,auth-stats} | admin(admins) | — | userLimiter | admin-security-summary |
| /api/admin/alerts{,/new,/unread-count,/read-all,/:id/read, deletes} | admin(support) | intParam | userLimiter | alerts-* (2 files) |
| GET /api/admin/audit-logs | admin(admins) | pageParam/limitParam | userLimiter | admin-filters-pagination (partial) |
| {GET,POST,PATCH,DELETE} /api/admin/admins{,/:id,/:id/{disable,enable},/scopes} | admin(admins) | zod + password policy | userLimiter | **NONE (census)** |
| GET/PATCH /api/admin/settings{,/auth/:id} | admin(settings) | per-provider zod | userLimiter | **auth: NONE (census)** |
| /api/admin/{observability,diagnostics}/… (incl. whatsapp sessions, telegram-test) | admin(settings) | intParam | userLimiter | observability (2); diagnostics: **NONE** |
| /api/admin/copilot/{ask,draft,history,settings,previews/:id{,/cancel,/confirm,/double-confirm}} | admin + phase gate + copilot scope/rate | generated zod + intent bounds | copilotRateLimit | copilot-error-envelope + history-contract (execute paths untested — census) |
| /api/admin/{forecast,enrichment}/… | admin(inventory) | intParam | userLimiter | enrichment (2); forecast: **NONE** |

**Validation verdict:** every body-reading route validated at the boundary (generated zod, local zod, or documented manual type-guards with column-aligned bounds); every `:id` route funnels through digit-exact `intParam` (pinned by `intparam-strict.test.ts`) or `stringParam`+enum lookup. The one shape outlier — telegram auth `code: <dynamic reason>` (R125-I6 documented) — is deliberate byte-compatibility.

**Error contract:** all envelopes ride `createErrorResponse` → `{error, code}` with codes from the shared 55-member enum (sync gate green, lanes A/N). Codes emitted but never rendered meaningfully by the frontend: **none found beyond lane N's documented dual-shape notifications family** — every code this lane emits maps to an Arabic string in the frontend `Record<ErrorCode,string>` map (N verified exhaustiveness).

---

## Swallow-catch adjudication (census flagged 11; all located, judged)

| Site | Verdict |
|---|---|
| routes/admin/auth.ts:415 (verify-2fa catch-all → 401) | **E-3 — telemetry hole, fail-closed OK** |
| lib/body-parser-recovery.ts:94 (URLSearchParams salvage fall-through) | OK — falls to the documented clean-400 path |
| routes/health.ts:117 (summary aggregate → 200 degraded) | OK — documented fail-open for the public status page |
| routes/metrics.ts:20 (timingSafeEqual wrapper) | OK — length-mismatch false |
| routes/cwv.ts:203 (JSON.parse → 400 malformed_json) | OK — honest 400 |
| routes/admin/observability.ts:59/94/219 | OK — CachedValue last-known-good + heartbeat-parse degrade, each documented with stale/unhealthy flags surfaced |
| routes/admin/diagnostics.ts:49 (monitorEventLoopDelay) | OK — documented old-Node degrade, null-checked downstream |
| middlewares/risk-{hard,soft}-block.ts:118/210 | OK — audit-write failure logged inside writeAuditLog; blocks stay safe-by-default |
| middlewares/cloudflareClientIp.ts:158 (expandIpv6) | OK — malformed IP → not-CF |
| services/copilot/phase-flags.ts:68 (JSON.parse → all-off defaults) | OK — logged, fails closed (features disabled) |
| services/copilot/admin-request-tool.ts:160/200/300/392 | OK — URL-normalize/decode fallbacks + body-summary fallback + `_raw` passthrough, all bounded and documented |
| services/auth-settings-store.ts:68/96 | OK — JSON.parse → `{}` (R119-B2 history documented) |
| services/risk-scoring.service.ts:123/267, risk-config-cache:123, enrichment/prompts:123 | OK — userTrend→0 / best-effort cache / parse→null, all in never-throw pipelines |

**Zero instances of the dangerous class** (catch → `res.json({success:true})` / false success on a money or data path) in this lane's files.

## Await-in-loop adjudication (census 4 + 1 adjacent)

| Site | Verdict |
|---|---|
| routes/admin/orders.ts:518 (bulk refund loop) | OK — deliberate sequential (documented: optimistic-lock thrash avoidance), bounded 200 ids, RefundError classified per-order, anything else propagates to the 500 handler |
| services/copilot/executor.ts:67/241 (staleness probes per affected id) | OK — affectedIds is a catalog-edit id list (typically 1); could batch with `inArray`, not worth it |
| services/copilot/admin-direct.ts:261 (synonym candidates) | OK — bounded constant table |
| services/risk-rules.service.ts:111 (per-rule DSL eval) | OK — bounded by admin-authored rule rows; errors collected not swallowed |
| services/alerting.service.ts:306 (per-rule condition) | OK — constant rule table (L's lane; engine internals not re-read) |

## Other hunt results

- **Transactions/rollback:** money paths single-tx with durable idempotency (G verified M1-M17); copilot executor dual-write tx verified; the two non-tx two-statement writes are E-6; inventory upload = advisory-lock + single tx (AUD103-4-F1, verified present).
- **N+1:** none remaining — cart H19 batch, support DISTINCT-ON, admin lists page-scoped aggregates (users/products/orders/topups all verified).
- **Unbounded queries:** E-5 is the only user-surface outlier; every admin list carries limit/limit+1/pageParam clamps (verified by grep across risk/stats/audit-logs/alerts/tickets/referrals/admins/security).
- **PII/token leak in logs:** pino-http serializers log `id/method/url` only; REDACT_PATHS exported + nested-complete; sentry deepSanitize + JWT heuristic. The single nick is E-2.
- **Body limits / timeouts:** express.json/urlencoded 1mb; cwv route-scoped 8kb text parser; server requestTimeout 60s / headersTimeout 65s; DB statement timeout 15s (M/db tests); all outbound fetches bounded (L).
- **Boot/readiness:** early-bind gate (503 starting for gated paths, static passes), bootMigrations-before-traffic, production refuses on critical migration failure.
- **OpenAPI parity:** 111 documented = 111 implemented, 89 allowlisted (gate green, lanes A/N); this lane's route enumeration found no undocumented route outside the allowlist families.

## Missing-test census (5 riskiest non-money, non-auth — those lanes own theirs)

1. **routes/admin/admins.ts (477L)** — the RBAC surface (create admin, PATCH permissions, disable/enable). ZERO tests at any level. A permission-escalation or disable-bypass regression ships silent. (Lane D flagged the frontend twin.)
2. **copilot confirm/double-confirm EXECUTE paths** — the transactional executor (E-1's race, the stale-guard, the price re-validation) has zero coverage; existing copilot suites pin envelopes and history only.
3. **routes/admin/tickets.ts** — admin ticket reply/status lifecycle, zero route tests (user-side caps are covered by support-reply).
4. **routes/admin/settings + auth-settings admin PATCH** — provider enablement/credential writes (including Telegram bot token rotation) untested; N-4 (live wrong-status bug) shipped from exactly this family.
5. **routes/auth GET /sessions + DELETE /sessions/:id** — device-list/revocation surface has auth-sessions tests; the unbounded-list shape (E-5) and last-device-revocation semantics are unpinned.

## Not checked (BLOCKED reads — exact list in E.coverage.jsonl)

21 lib files not read this lane (context budget): `lib/{metrics, metrics-snapshot, db-instrumentation, inspection-runner, scheduler-coordinator, pg-leader-lease, pg-advisory-lock, encryption, account-link-consent, risk-dsl, firebase-admin, slugify, loyalty-policy, scheduler-state, audits/neon-audit, audits/context7-audit, audits/ruflo-audit, forecast/*, copilot/ids}` — **highest-risk carryovers: `lib/encryption.ts` (427L, AES-GCM core; tests exist in this inventory: encryption-boot-assert, v2-key-versioning) and `lib/account-link-consent.ts` (449L; test exists)**. Services read only at section/grep level: copilot tools (read/draft/operational bodies), admin-direct body, enrichment/* bodies, forecast/* bodies (dormant), health-checks.service body, catalog detail internals (I lane read them), firebase-auth.service (H spot). Route bodies not read: admin/{risk, admins, product-variants, pricing-calculator, pricing-config, diagnostics, referrals, stats, audit-logs, security, alerts, observability, flash-sales, tickets, enrichment, forecast, copilot leaf handlers}, auth-whatsapp (L covered the service). All 184 co-located test files verified structurally (0 broken imports) — line-level reading BLOCKED.

**Verdict:** the backend API surface is the most consistency-hardened layer of this repo — envelope discipline, boundary validation, no-store parity, and honest-404 patterns hold across every route read, with zero false-success catches on data paths. The rot is small and enumerable: one non-atomic single-use claim on the (dormant, phase-gated) copilot executor, one log-side credential nick, one silent 401-on-outage, and four one-liner hygiene items. No P0/P1/P2.

*Lean: ~15 lines deletable (E-4 dead import, E-7 dead expression).*
