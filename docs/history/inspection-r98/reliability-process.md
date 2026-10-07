> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r98/reliability-process.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R98-A6 — Reliability / Process Deep Audit (backend)

- Agent: R98-A6 (read-only; only this file + worklog touched)
- Date: 2026-10-30
- Scope: outbound-call inventory, cold-start budget, graceful shutdown, unhandled paths, in-process memory, timeout coverage, retry logic, env validation, logging hygiene, metrics endpoint.
- Environment assumed (verified in `render.yaml`): Render **free** (sleeps ~15 min idle, SIGTERM on deploy/spin-down), Neon PG free (autosuspend ~5 min, wake ~1.8 s), **no Redis** (REDIS_URL absent → PG-lease scheduler fallback), no workers, single web instance. Free-tier inviolables respected by every proposed fix (no new services, no pings, no Redis).
- Prior rounds NOT re-reported: timers taxonomy (unref'd in-memory / PG-lease 20 s / dormant), 60 s alerting evaluator existence + dormant rules, daily-cron + one-shot-only scheduler posture, customFetch 503-wake POST-safety, migrate.ts probe fix, live cold-start chain test.

---

## 1. Outbound-call inventory (backend, non-test code)

| # | Destination | Site | Timeout | Retry | POST-safe on retry? | Error classification | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Telegram `sendMessage` (business notify) | `src/telegram.ts:388` | 5 s `AbortSignal.timeout` | 2 attempts; honors `retry_after` (clamp 5 s); 500 ms network backoff | n/a — duplicate notification at worst (same content) | transient = 5xx/429/network; 4xx permanent, no retry | ✅ exemplary |
| 2 | Telegram `{method}` (approval webhook helpers) | `src/lib/telegram-gateway.ts:20-35` | 10 s AbortController | none (never throws; returns `null`) | n/a | swallowed + warn | ✅ |
| 3 | Telegram `sendMessage` (**/start bootstrap reply**) | `src/routes/telegram-webhook.ts:202` | ❌ **NONE** | none (`.catch(() => undefined)`) | n/a | swallowed | 🟠 **F2** — unbounded, awaited |
| 4 | Telegram `sendMessage` (SRE alerting) | `src/services/alerting.service.ts:645` | 10 s `AbortSignal.timeout` | 1 retry after fixed 5 s | duplicate alert page at worst | HTTP-status only; **`body.ok:false` on 200 not detected** | 🟡 F5 |
| 5 | Discord webhook | `src/services/alerting.service.ts:661` | 10 s | 1 retry / 5 s | webhook POST — duplicate at worst | 2xx ok | ✅ |
| 6 | Generic alert webhook | `src/services/alerting.service.ts:685` | 10 s | 1 retry / 5 s | duplicate at worst | 2xx ok; **PII redacted** before send | ✅ |
| 7 | OpenWA gateway (sibling Render service) — ALL calls via `gatewayFetch` | `src/services/openwa.service.ts:560-570` | 8 s `AbortSignal.timeout` | send-text: 3 attempts, 1.5 s/4 s backoff, **only network/5xx** (4xx never retried); session/preflight: no retry | ⚠️ at-least-once: network-timeout retry can double-deliver the same OTP text (F4) | `request_failed` / `non_ok_status`≥500 retryable; 4xx definitive | ✅ modulo F4 |
| 8 | LLM provider `chat/completions` (copilot) | `src/services/copilot/llm-client.ts:110-148` | 60 s AbortController | none per round; up to 4 tool rounds | n/a (LLM read) | throws → route 5xx/SSE close | 🟡 F7 (total budget) |
| 9 | Loopback self-fetch (`admin_request` copilot tool) | `src/services/copilot/admin-request-tool.ts:314-339` | 20 s AbortController | none | forwarded CSRF; confirm-gated by design | mapped to 502 tool error; body capped 12 KB | ✅ |
| 10 | Neon PG via pg Pool + Drizzle | `shared/db/src/index.ts:73-97` | pool acquire 30 s (render.yaml `DB_CONNECTION_TIMEOUT_MS`), server-side `statement_timeout` 15 s, TCP keepalive 30 s | driver-level reconnect; app-level retry only in migrations + OTP insert | transactional money paths | SQLSTATE/errno classified in boot-migrations only | ✅ |
| 11 | Redis (node-redis v5) | `src/lib/redis-client.ts` | boot connect race 8 s; per-command 500 ms via `withRedisCommandTimeout` on hot paths | socket auto-reconnect backoff `min(retries*50, 500)` | n/a | degraded-mode counters + Sentry | 🟡 F3 — **5 raw unbounded commands remain**; DORMANT today (no `REDIS_URL`) |
| 12 | Firebase Admin `verifyIdToken` | `src/services/firebase-auth.service.ts` via `src/lib/firebase-admin.ts` | SDK-managed (no app-level wrapper) | SDK-internal | n/a | route maps to 401/503 | note only |
| 13 | Sentry ingest | `src/instrument.ts`, `src/lib/sentry.ts` | SDK-managed; `Sentry.close(2000)` on shutdown + uncaught | SDK queue | n/a | `captureSubsystemException` | ✅ |

**"Does Telegram-slow hang a handler?"** — No for money/UX paths: every `notify*()` helper is fire-and-forget with a fully-internal try/catch (`void dispatch`, `src/telegram.ts:347-354`, call sites `checkout.service.ts:729`, `topup.service.ts:178`, `orders.ts:286`, `wallet.ts:334`). Only two *awaited* Telegram calls exist: the admin diagnostic ping (by design, 5 s bound) and the **/start webhook reply (F2, unbounded)**.

**"Does bot send block the alerting loop?"** — Yes, but bounded: the evaluator `await`s `dispatchAlert` per fired rule; each channel send is 10 s-capped with one 5 s retry ⇒ ≤25 s per fired rule (channels parallel). The real defect is the *overlap* this creates (F1).

---

## 2. Cold-start budget (boot chain, file by file)

1. `src/index.ts:1` — env loader reads `.env` files (sync fs, no network). **No env-schema validation here** — validation is distributed (see §8).
2. `src/index.ts:3` — top-level `await import("./server")`.
3. `src/server.ts:5` — `instrument.ts`: `Sentry.init` synchronous; no network until first event. Also installs uncaught/unhandled handlers.
4. Module graph loads: `@workspace/db` **constructs the Pool but connects nothing** (pg lazy); `app.ts` builds middleware (CORS/CSRF lists, 5 rate-limiters with in-process MemoryStore since `REDIS_URL` unset), routers, static SPA. No DB I/O at import.
5. `src/server.ts:25` — `instrumentDbPool(pool)` patches query/connect.
6. **`src/server.ts:266` — `listen()` binds the port BEFORE any bootstrap await** (B7-P1-8). A gate middleware answers until `bootReady`:
   - `/api/healthz*` → `503 {"status":"starting"}` (Render healthCheckPath sees "starting", not conn-refused);
   - everything else → 503 `SERVICE_UNAVAILABLE` (never serve mid-migration).
7. `bootstrap()` (`server.ts:126-186`):
   - `initRedisClient()` — no `REDIS_URL` → one warn line + immediate resolve (0 ms; no 8 s race because the race only starts when the URL exists).
   - `bootMigrations()` — writability probe wakes Neon (~1.8 s); ~129 guarded statements (`migrate.ts`, 2 485 lines, all IF NOT EXISTS-style); worst-case wait `MIGRATION_WRITE_WAIT_MAX_MS=120 s` + transient re-runs at 5/15/45 s with lock-TTL refresh; critical failure → `process.exit(1)` in production (fail-fast, operator escape hatch `DISABLE_BOOT_MIGRATIONS`). Live-tested clean in the prior round.
   - `startWebSchedulers()` — PG-lease acquire (+ lazy `CREATE TABLE IF NOT EXISTS`), ≤2 queries; **11 boot one-shots fire strictly SEQUENTIALLY and fire-and-forget** (cold-start query-storm guard, `web-scheduler.ts:127-140`) — they never block `bootReady`.
   - `logTelegramBootStatus()` — sync, one log line.
8. `bootReady = true` → gate opens; `registerShutdown` wired.

**Answer to "listen then lazy-init DB?": already implemented.** Nothing blocks `listen()`; the DB first touch is the migration probe, deliberately inside the gated window (schema must reconcile before serving). Residual: `render.yaml:16 healthCheckPath: /api/healthz` receives 503 "starting" for the whole bootstrap window — a deploy whose boot legitimately waits out a Neon failover (up to ~120 s) can be marked failed by Render's health-check patience before the process recovers. Accepted posture (fail-loud); documented, no action required.

---

## 3. Graceful shutdown (SIGTERM / SIGINT)

`src/server.ts:202-261`, order (all awaited inside one async, 10 s force-exit `unref`'d):

1. `schedulers.stop()` → `web-scheduler.ts:326-339`: stops heartbeat (also removes heartbeat's own `process.on("SIGTERM")` listener, `worker/heartbeat.ts:117-122`), `alertingService.stop()` (clears the 60 s interval), `cronJobs.stop()` (real node-cron handles), then `leadership.release()` → **PG-lease row deleted** (`scheduler-coordinator.ts:435-447`, compare-and-delete, failures swallowed with the 60 s lease TTL as backstop; Redis path bounded 2 s/op).
2. `io.close()` — drops Socket.IO clients so they don't pin `server.close`.
3. `httpServer.close()` + `closeIdleConnections()` — drains in-flight HTTP.
4. `pool.end()` — drains DB connections.
5. `Sentry.close(2000)` — flush.
6. `exit(0)` (or force `exit(1)` at 10 s).

**Bot polling:** webhook mode — there is no polling loop to stop; the webhook route is stateless. ✅
**Timers:** all long-lived intervals are either stopped here (heartbeat, evaluator, cron, coordinator refresher/retry) or `unref`'d and irrelevant post-exit (CWV sessionCaps sweep `routes/cwv.ts:151-156`, socket cap sweep `lib/socket.ts:746-752`, per-socket reverify timers cleared on disconnect, redis ping watchdog only-with-Redis).
**Data-loss scenarios on Render SIGTERM/SIGKILL:**
- Mid-**checkout** transaction: every money mutation is in a Drizzle transaction (verified by `checkout-inventory-corrupt`, `checkout-idempotency` tests) → kill = rollback, no partial write; the idempotency claim rows ride the **same transaction** → retry re-runs cleanly.
- Mid-**OTP** send: `whatsapp-otp.service.ts:171-173` sends *before* inserting the row → a kill mid-send leaves no dead row; the phone's cooldown/hourly counters were read pre-send, so retry is honest.
- Fire-and-forget notifications (order/topup Telegram messages, socket emits) can be lost on spin-down — accepted (non-critical, operator-visible in admin drawer/DB).
- Gap: the 10 s drain budget is shorter than known legitimate paths (OTP worst case ≈ settle 20 s + preflight 8 s + 3×8 s sends + 5.5 s backoff; copilot up to minutes) → force `exit(1)` cuts them mid-flight. Deliberate trade-off (B7-P1-6 comment: "a hung connection must not wedge the deploy"); consequences are retry-safe (above). No action.

---

## 4. Unhandled paths & floating promises

- `process.on("uncaughtException")` → Sentry flush → `console.error` → `exit(1)` (`src/instrument.ts:30-43`). Crash-loop policy: genuine crash → Render restart; a boot-time env crash (§8) would loop, but the fail-fast set is small and operator-actionable (documented posture).
- `process.on("unhandledRejection")` → flush + log, **stay up** (documented: logical bug, not process-fatal) — avoids Render crash-loop spin/suspend on a bad promise. ✅
- Floating promises: audited every `.then(` and bare helper call in non-test src (17 sites). All carry `.catch` (`admin/orders.ts:208/232/332/344`, `notify.ts:42`, `alertLogger.ts:150`, `socket.ts:737`, `logAdminAlert` socket fan-out) or route through internally-safe `void dispatch()` / `observeWhatsAppChannel()` wrappers that never throw. `fireOneShotsSequentially`, `opportunistic.fireThrottledMaintenance`, `recordReadySince` warm-up timer — all `try/catch`'d with warn logs. **No unguarded fire-and-forget found.** ✅

---

## 5. In-process memory (long-lived Render instance)

| Store | Site | Bound | Eviction |
|---|---|---|---|
| generic cache LRU | `lib/cache.ts:36` | 5 000 entries | LRU + TTL ✅ |
| session-liveness validity cache | `lib/session-liveness.ts:22` | active sessions (+ ≤499 stale) | opportunistic prune every 500 calls ✅ |
| Telegram replay hashes | `lib/telegram-replay.ts:54-93` | 5 000 entries | TTL prune every 250 + oldest-evict ✅ |
| CWV per-session caps | `routes/cwv.ts:136` | sessions in 60 s window | 60 s `unref`'d sweep ✅ |
| copilot rate-limit windows | `lib/copilot/rate-limit.ts:56` | keys = admin count | arrays windowed (no key delete — negligible) ✅ |
| alerting rule baselines | `services/alerting.service.ts:310-311` | 10 rules × buckets | overwrite per tick ✅ |
| OpenWA settle/warm gates | `services/openwa.service.ts:337-346` | 1 epoch per session | re-arm deletes previous epoch's keys ✅ |
| alertLogger DB-failure throttle | `jobs/alertLogger.ts:73` | 500 keys | coarse clear ✅ |
| socket connection tracker + per-IP | `lib/socket.ts:540-560,746` | live connections | sweep vs live set ✅ |
| opportunistic throttle registry | `lib/opportunistic.ts:56` | fixed key set | n/a ✅ |
| risk-config singleton | `services/risk-config-cache.service.ts:43` | 1 | TTL 60 s ✅ |
| prom-client registry | `lib/metrics.ts` + `middlewares/metrics.ts:26` + `routes/cwv.ts:45-108` | route = Express pattern / bounded CWV table | label sets are closed unions ✅ |
| express-rate-limit MemoryStores (5) | `app.ts:455-602` | IPs/users per window | ERL-managed sweep ✅ |
| whatsapp-watch episode state | `services/whatsapp-watch.ts:100-107` | scalars + ≤ tokens | reset on episode end ✅ |

**Verdict: no unbounded growth vector found.** ✅ (This was the round's biggest fear — histograms/counters all have closed label cardinality; every Map has a cap, prune, or fixed key set.)

---

## 6. Timeout coverage

- Express/HTTP server: `requestTimeout=60 s`, `headersTimeout=65 s` (`server.ts:93-94`). `keepAliveTimeout` left at Node default 5 s → F6.
- DB: pool acquire 30 s (`render.yaml:35`), server-side `statement_timeout` 15 s on every pooled connection, TCP keepalives (`shared/db/src/index.ts:37-89`). A slow Neon wake (1.8 s) or even a stalled statement cannot pin a pool client. Long checkout on slow Neon: 1.8 s wake + 15 s statement ceiling ≪ 60 s request budget → **Express never times out before Neon wakes.** ✅
- Per-layer bounds: OpenWA 8 s, Telegram 5 s/10 s, LLM 60 s, loopback 20 s, healthz per-check 5 s + aggregate 8 s, Redis 500 ms. Every `await` in an outbound path is covered **except** F2 (webhook /start) and the 5 raw Redis commands (F3).
- No per-response Express timeout by design — replaced by per-dependency deadlines; acceptable on a single-instance free tier.

---

## 7. Retry logic inventory (homegrown, excluding customFetch)

| Loop | Max attempts | Backoff | Jitter | Retries 4xx? | Herd risk |
|---|---|---|---|---|---|
| boot migrations (`lib/boot-migrations.ts:492-575`) | 3 (+120 s write-wait) | 5/15/45 s | no | ❌ (4xx → critical) | none — single leader under NX lock; lock TTL refreshed pre-retry |
| telegram notify (`src/telegram.ts:385-473`) | 2 | retry_after clamp 5 s / 500 ms | no | ❌ (5xx/429 only) | none — one operator chat |
| OpenWA send (`services/openwa.service.ts:852-917`) | 3 | 1.5 s/4 s | no | ❌ (`isRetryableSendFailure`: network or ≥500) | low — bounded per request |
| alerting channel (`alerting.service.ts:587-624`) | 2 | fixed 5 s | no | ❌ (status check) | none |
| OTP row insert (`whatsapp-otp.service.ts:259-263`) | 2 | immediate | no | ❌ (catch-all → `store_failed` + 30 s cooldown) | none |
| healthz failure counters | n/a | fire-and-forget | n/a | n/a | none |

**Thundering herd on Neon wake:** `DB_POOL_MAX=8` caps concurrent statements; boot one-shots are sequential; frontend wake-retry already verified POST-safe. Burst protection adequate. ✅

---

## 8. Env validation (boot vs first-use)

| Var | Validated | Where | Missing-env behavior |
|---|---|---|---|
| `DATABASE_URL` | ✅ boot, hard | `shared/db/src/index.ts:9-15` | import throw → `exit(1)` |
| `SESSION_SECRET` | ✅ boot (≥32) | `lib/jwt.ts:4-20` | throw → exit(1) |
| `ADMIN_JWT_SECRET` | ✅ boot in prod (≥32, ≠ SESSION_SECRET) | `lib/jwt.ts:52-80` | throw → exit(1) |
| CORS/CSRF origins | ✅ boot in prod | `app.ts:103-114` (SEC-92-01) | throw → exit(1) |
| `ENCRYPTION_KEY` | ❌ **lazy, at first encrypt/decrypt** | `lib/encryption.ts:9-13` | reads → `safeDecrypt` warn + null; writes → 500 per request while healthz stays 200 → **F8** |
| `TELEGRAM_*` | soft by design | boot log line (`telegram.ts:103-111`), call-time skip | skip + `telegram_sends_total{skip}` ✅ |
| `TELEGRAM_WEBHOOK_SECRET` | soft | `routes/telegram-webhook.ts:167-172` | 503 at use ✅ |
| OpenWA (`WHATSAPP_OTP_*`) | soft | `readGatewayConfig()` → warn at use | `not_configured` verdict ✅ |
| Copilot provider (4 keys) | soft, set-check | `provider-config.ts` | "unavailable" reply ✅ |

Crash-loop posture: the hard set (4 vars + origins) throwing at boot → Render restart loop → deploy suspended — this is the documented fail-loud posture (env-loss is a *demonstrated* failure mode at this operator, round-5); keep, but see F8 for the one inconsistency.

---

## 9. Logging hygiene

- Levels: debug=success, warn=transient, error=final — consistent across telegram/openwa/alerting/migrations. ✅
- Volume: `pinoHttp` autoLogging **skips `/api/healthz*` and `/api/cwv`** (`app.ts:636-641`); healthz is also rate-limit-skipped. Request serializers log only id/method/url-path (`app.ts:642-655`). Correlation id on every line + `x-request-id` echo. ✅
- Redaction: pino `redact.paths` is the audited, test-pinned list (top-level + nested + one-seep wildcards; `lib/logger.ts:63-169`). Sentry has a second deep-sanitizer. ✅
- `console.*` in production code: only error-path instrumentation (`metrics.ts`, `alerting.service.ts`, `instrument.ts`, `sentry.ts`) — negligible. ✅
- **PII gap: F9** (phone-bearing `chatId` in OpenWA warn logs). Note (accepted): `auth_activity` stores full phone identifiers **in the DB** (90-day retention, business-justified audit trail — `whatsapp-otp.service.ts` `safeLog` identifier `wa:${phone}`); Telegram messages to the operator intentionally carry phones (that is their function).

---

## 10. `/api/metrics` endpoint

- Auth: admin JWT (2FA temp token explicitly rejected) **or** `METRICS_ADMIN_TOKEN` constant-time compare; fail-closed 401 (`routes/metrics.ts:30-62`). ✅
- Cost: single `registry.metrics()` render; series count bounded by closed label unions (§5); CWV route labels normalized through a fixed table (SEC-92-05). No time-window aggregation on this endpoint (cumulative counters — Prometheus semantics); the admin JSON snapshot (`lib/metrics-snapshot.ts`) is a pure transform of the same registry, no extra state. ✅
- Memory: histogram/counter storage = one cell per label-set; no ring buffers. ✅

---

## Findings

### [P2] F1 — Alerting evaluator lacks a re-entrancy guard; with Redis absent, dedup AND global rate-limit are inert → overlapping 60 s ticks double-page the operator
- **Where:** `backend/src/services/alerting.service.ts:167-201` (setInterval + `evaluateRules` sequential, no in-flight flag), `:703-742` (`isDeduped`/`isRateLimited` return false immediately when `getRedisClient()` is null — the current production shape).
- **Evidence:** a fired rule's channel dispatch can legally take 25 s (10 s timeout × 2 attempts + 5 s retry delay, `:587-624`); 3+ rules firing together (the normal outage cluster: `neon_connection_failure` + `api_5xx_rate_high` + `api_p95_latency_high` + `redis_disconnect` — registry `:68-139`) ⇒ >60 s per tick; `setInterval` starts the next `evaluateRules` while the previous is still dispatching. Both ticks pass `isDeduped` (no Redis) and both send. `dispatchAlert` is also invoked from the admin test route with a bypassing dedupe key by design.
- **Failure scenario (Telegram slow / Neon outage):** sustained incident → each 60 s tick overlaps the previous → 2 concurrent dispatch cycles → duplicate Telegram pages per rule per minute for the whole incident; the very channels meant to carry the outage signal are the ones being spammed. Memory is safe (bounded promises), noise is not.
- **Minimal fix (free-tier):** (a) add `private evalInFlight = false` guard mirroring `whatsapp-watch.ts:96` (skip tick when set); (b) add a bounded in-memory fallback in `isDeduped` — `Map<dedupKey, expiry>` capped at, say, 128 with TTL 300 s (mirrors `telegram-replay.ts`'s capped store) so the no-Redis shape keeps the 5-min dedup contract. No service, no timer.

### [P2] F2 — Webhook /start reply: raw `fetch` to Telegram with NO timeout, awaited inside the handler
- **Where:** `backend/src/routes/telegram-webhook.ts:199-215` (line 202).
- **Evidence:** every sibling Telegram call in the same route goes through `telegram-gateway.ts`'s 10 s AbortController; this one is a bare `fetch(...).catch(() => undefined)` that the route **awaits** before `res.json({ok:true})`.
- **Failure scenario (Telegram slow):** the `/api/webhook/telegram` request hangs until `httpServer.requestTimeout` (60 s) destroys the socket → Telegram registers a failed delivery and re-posts the same update (their retry policy) → repeat pressure on the exact endpoint that must stay cheap. Also burns a socket/handler slot for a minute on a bootstrap nicety.
- **Minimal fix:** swap to a plain `sendMessage` helper in `telegram-gateway.ts` (reuse `apiCall`) or add `signal: AbortSignal.timeout(10_000)` — one line, no behavior change otherwise.

### [P3] F3 — R2 discipline gaps: 5 raw (unbounded) Redis commands outside `withRedisCommandTimeout`
- **Where:** `alerting.service.ts:711` (`redis.set` NX/EX dedup), `:731-734` (`redis.incr`, `redis.expire` rate-limit), `risk-config-cache.service.ts:72` (`redis.get`), `telegram-replay.ts:108` (`redis.set` claim).
- **Evidence:** the repo's own R2 rule (redis-client.ts header; `alerting.service.ts:280-286` even documents fixing "the one raw unbounded redis.get left") — these four sites predate/escaped it. All are try/catch'd, so *rejections* are handled; the hazard is a "ready-but-black-holed" socket where node-redis queues the command forever and the promise never settles.
- **Failure scenario:** only reachable when `REDIS_URL` is set (currently absent → dormant). If Redis is ever re-provisioned: a hung dedup check stalls an alert dispatch tick (compounds F1); a hung replay claim stalls `/api/auth/telegram` login; a hung risk-config read stalls risk scoring.
- **Minimal fix:** wrap each with `withRedisCommandTimeout("<label>", ...)` exactly like the neighboring bounded calls (mechanical, 5 sites).

### [P3] F4 — OpenWA send-text retry is at-least-once: ambiguous network failure can double-deliver the OTP text
- **Where:** `services/openwa.service.ts:838-917` (`isRetryableSendFailure` treats `request_failed` — which includes the 8 s AbortSignal timeout — as retryable on POST send-text).
- **Evidence/failure scenario:** first POST is delivered by the gateway but the response is lost/slow → 8 s timeout → retry re-POSTs the same text → user receives the identical OTP message twice. Security impact: none (same code, generated once pre-send, `whatsapp-otp.service.ts:171-173`; no double-charge). UX-only.
- **Minimal fix:** none required (documented at-least-once semantics). If desired later: per-recipient in-flight dedup of the *same text hash* for 60 s — one small Map. Free-tier compatible.

### [P3] F5 — Alerting Telegram send treats HTTP 200 with `body.ok:false` as delivered
- **Where:** `alerting.service.ts:645-655` — checks `response.ok` only; `src/telegram.ts:18-25` documents that Telegram can answer 200 with `ok:false` (e.g. "message is too long").
- **Failure scenario:** oversized/deformed alert text → alert silently marked `delivered`, counter shows green while no page was sent.
- **Minimal fix:** parse the JSON body like `telegram.ts:403-420` does and throw on `!body.ok` (feeds the existing retry path).

### [P3] F6 — `keepAliveTimeout` left at Node default (5 s) while `headersTimeout` was tuned (65 s)
- **Where:** `server.ts:93-94` sets request/headers timeouts only.
- **Evidence/failure scenario:** Render's LB (documented ~100 s idle kill) holds server keep-alive sockets; Node closing them at 5 s creates the classic close-race where the LB reuses a socket the server just closed → sporadic 502s at the Cloudflare→Render hop under reuse.
- **Minimal fix:** `httpServer.keepAliveTimeout = 61_000;` (and optionally `maxRequestsPerSocket`) next to the existing two lines. Pure socket knob, free.

### [P3] F7 — Copilot total request budget is unbounded (4 × 60 s LLM + 20 s loopback tools) vs Render's ~100 s proxy ceiling and the 10 s drain budget
- **Where:** `services/copilot/llm-client.ts:18-19` (`MAX_TOOL_ROUNDS=4`, `REQUEST_TIMEOUT_MS=60_000`), `admin-request-tool.ts:60` (20 s).
- **Failure scenario:** a slow provider: round-trip chain up to ~4-5 min; Render cuts the proxied/SSE connection around 100 s while the handler (and LLM tokens) keep burning on a 0.5-CPU free instance; a SIGTERM during it force-exits at 10 s (acceptable — tools are preview-gated, no writes without confirm).
- **Minimal fix:** give `copilotChat` a shared deadline `AbortController` (e.g. 90 s total) that aborts remaining rounds; one small wrapper in `postChatCompletion`.

### [P3] F8 — `ENCRYPTION_KEY` validated lazily (first use), breaking the boot fail-fast posture
- **Where:** `lib/encryption.ts:9-13` (throw inside `getKey()`), vs boot-time peers (`lib/jwt.ts`, `shared/db/src/index.ts`).
- **Failure scenario (cold start / env-loss):** a wiped/typo'd `ENCRYPTION_KEY` (the operator's demonstrated failure mode) boots GREEN, healthz 200, then every encrypted-field write 500s per request and every read silently nulls via `safeDecrypt` — a half-healthy instance that is harder to diagnose than a crash, and on Render free it never restarts into visibility.
- **Minimal fix:** a 5-line boot assertion in `bootstrap()` (hex, 32 bytes) — fail-fast consistent with SESSION_SECRET.

### [P3] F9 — Phone PII (`chatId` = `218…@c.us`) in stdout logs
- **Where:** `services/openwa.service.ts:879, 888-896, 981-984` (warn-level gateway failures log full chatId; pino redact list has no `chatId` path).
- **Failure scenario:** Render's retained log stream accumulates user phone numbers on every gateway hiccup (OTP path = every login attempt during channel trouble).
- **Minimal fix:** mask in the log call (`chatId.slice(0,5) + "…"` style — the file already truncates OTP-adjacent bodies deliberately); keep the full value out of logs, it remains in DB tables where retention is governed.

---

## Counts

- **P0: 0 · P1: 0 · P2: 2 · P3: 7** (F1–F9; F4 is a documented-semantics note with an optional fix)
- Verified-clean areas (no findings): listen-first boot gate, migration runner safety, graceful-shutdown ordering incl. PG-lease release and transactional write safety on kill, uncaught/unhandled policy, floating-promise hygiene, all 14 in-process stores bounded, per-layer timeout coverage, retry classification (no retry-on-4xx anywhere), env validation for the hard set, log volume/redaction pipeline, metrics endpoint auth + cardinality.

## Files audited (static read, full or targeted)

`backend/src`: `index.ts`, `server.ts`, `instrument.ts`, `app.ts`, `migrate.ts` (statement survey), `telegram.ts`, `notify.ts`, `worker/heartbeat.ts`, `lib/`: `env.ts`, `logger.ts`, `jwt.ts`, `encryption.ts`, `http.ts`, `redis-client.ts`, `cache.ts`, `session-liveness.ts`, `telegram-replay.ts`, `telegram-gateway.ts`, `opportunistic.ts`, `boot-migrations.ts`, `pg-leader-lease.ts`, `scheduler-coordinator.ts`, `web-scheduler.ts`, `metrics.ts`, `metrics-snapshot.ts`, `socket.ts` (timers/tracker), `firebase-admin.ts`, `copilot/rate-limit.ts`; `middlewares/`: `metrics.ts`, `idempotency.ts`; `routes/`: `health.ts`, `metrics.ts`, `cwv.ts`, `telegram-webhook.ts`, `index.ts`, `products.ts` (cache TTL); `services/`: `alerting.service.ts`, `openwa.service.ts`, `whatsapp-otp.service.ts` (log/retry survey), `whatsapp-watch.ts`, `topup.service.ts` (notify sites), `checkout.service.ts` (notify sites), `risk-config-cache.service.ts`, `copilot/llm-client.ts`, `copilot/admin-request-tool.ts`, `copilot/preview-store.ts`; `jobs/`: `cron.ts`, `alertLogger.ts`, `stockWatcher.ts` (notify sites); `shared/db/src/index.ts`; `render.yaml`; plus repo-wide greps for fetch/axios/`.then(`/`process.on`/`console.*`/`setInterval`.

## Recommended fix order (all free-tier-compatible, no new infra)

1. F1 (evaluator guard + in-memory dedup) — operator-facing noise during incidents.
2. F2 (webhook fetch timeout) — one line.
3. F8 (ENCRYPTION_KEY boot assertion) — closes the half-healthy-instance failure mode.
4. F6, F5, F9 — small, independent hardening.
5. F3, F7, F4 — dormant/optional; do when Redis ever returns / copilot latency matters.
