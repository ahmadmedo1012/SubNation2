# R127-B7 — Cron / Jobs / Scheduler Deep Audit

- **Agent:** R127-B7 (read-only auditor; only writes = this file + one worklog append)
- **Tree audited:** `f53a886` (= production at https://subnation.ly, verified vs worklog round-126-push + live-verify entries)
- **Scope:** every scheduled job (node-cron, boot one-shots, setInterval sites, opportunistic throttled sweeps, host-level cron), overlap/reentrancy, failure isolation, missed-run semantics, time correctness vs Africa/Tripoli, data-volume trajectory + index support, and the two R126 additions (products stats emits ×8, zombie-polling close).
- **Method:** line-read `jobs/cron.ts`, `jobs/boot-one-shots.ts`, `lib/web-scheduler.ts`, `lib/scheduler-coordinator.ts`, `lib/opportunistic.ts`, `lib/pg-leader-lease.ts` (API-level), `lib/redis-client.ts` (watchdog), `lib/socket.ts` (both timers), `lib/admin-session.ts`, `server.ts`, `worker.ts`, `worker/heartbeat.ts`, `services/alerting.service.ts`, `services/whatsapp-otp.service.ts` (prune), all 15 `jobs/*.ts`, `routes/cwv.ts`; grep-swept `setInterval|setTimeout|cron.schedule` across `backend/src` (complete inventory below); cross-checked prune predicates against `shared/db/src/schema/*` **and** `backend/src/migrate.ts` (the live-DB index source of truth); read worklog R5/97-A1/R126-R1 heritage + CHANGELOG knowns first.

---

## 1. Executive verdict

**The scheduling core is fundamentally sound and heavily hardened by rounds 92–108**: single-leader election with PG-lease fallback, SINGLE_INSTANCE_MODE ungated schedulers (the deployed shape), per-job try/catch + per-job Sentry tags on every cron slot, sequential idempotent boot one-shots shared by both scheduler owners, throttled+re-entry-guarded opportunistic sweeps, re-entrancy guard on the alerting evaluator, DB-level advisory-lock dedupe on every alerting path, ctid-batched bounded DELETEs everywhere. **No P0, no P1.** The material residue is (a) one P2 — six prune predicates have **no index support** in either the schema or `migrate.ts`, turning any retention catch-up purge into repeated full seq scans (an incident-amplifier on attacker-grown tables), and (b) three P3s (boot-chain failure capture gap + a false log claim; restart clears the in-memory alert dedupe in the no-Redis production shape; a boot/throttle boundary comment inaccuracy).

## 2. Complete schedule table (production shape: `SINGLE_INSTANCE_MODE=true`, `REDIS_URL` unset, `WORKER_TIER` unset)

### 2a. node-cron registrations — `backend/src/jobs/cron.ts` (leader-gated via `startWebSchedulers`; in SINGLE_INSTANCE_MODE = every container boot; every registration passes `{ timezone: "UTC" }`)

| # | Slot (UTC) | Job | Purpose | Active in prod? | Boot one-shot twin? |
|---|---|---|---|---|---|
| 1 | `0 0 * * *` | admin-alert retention | unread>14d → auto-read; read>30d → delete (`alertLogger.ts`) | ✅ | ✅ `alert-retention` |
| 1c | `0 0 * * *` | idempotency_keys retention | rows >48h (`idempotency-retention.ts`) | ✅ | ✅ `idempotency-retention` |
| 1a | `5 0 * * *` | TOTP security advisory | weekly nudge via `admin:no-totp` 7d dedupe (`security-advisories.ts`) | ✅ | ✅ `security-advisories` |
| 6 | `15 2 * * *` | forecast runner | gated `WORKER_TIER`+`FORECAST_RUNNER_ENABLED` | ⛔ dormant (worker-tier env unset by design — ENVIRONMENT_MATRIX:30,53) | ➖ |
| 5 | `30 3 * * *` | risk_events retention | unlabeled>90d / labeled>97d / orphan labels>30d (`risk-retention.ts`) | ✅ | ✅ `risk-retention` |
| 7 | `35 3 * * *` | forecast retention | guarded `if (process.env.WORKER_TIER !== "true") return;` (cron.ts:340) | ⛔ dormant | ➖ |
| 8 | `50 3 * * *` | enrichment runner | gated `WORKER_TIER`+`ENRICHMENT_RUNNER_ENABLED` | ⛔ dormant | ➖ |
| 9 | `0 4 * * *` | enrichment retention | guarded `WORKER_TIER` (cron.ts:381) | ⛔ dormant | ➖ |
| 10 | `30 4 * * *` | auth_activity retention | rows >90d (`cleanup-auth-activity.ts`) | ✅ | ✅ `auth-activity-retention` |
| 1b | `0 5 * * *` | **5-job retention slot** (independent try/catch per prune, R110-H): sessions expired-prune; admin_sessions (exp>24h/revoked>30d); notifications (read>90d/unread>180d); login_attempts (idle>7d); audit_logs (>180d) | table-size control | ✅ | ✅ all five (`session-prune`, `admin-session-prune`, `notifications-retention`, `login-attempts-retention`, `audit-logs-retention`) |

Removed historically (known): hourly heartbeat log, hourly OTP prune, hourly copilot reaper, `*/10` keep-alive self-ping — cron.ts:241-265 documents the 2026-09-20 free-infrastructure retirement.

### 2b. Boot one-shots — `backend/src/jobs/boot-one-shots.ts` (17 entries, strictly sequential, fire-and-forget, **+7 s after leadership** via `BOOT_ONE_SHOT_DELAY_MS` default, web-scheduler.ts:285-289; fired on **every** leader start = every Coolify deploy/restart under SINGLE_INSTANCE_MODE)

`session-prune` · `security-advisories` · `alert-retention` · `risk-retention` · `auth-activity-retention` · `idempotency-retention` · `notifications-retention` · `login-attempts-retention` · `audit-logs-retention` · `coupon-sweep` · `stock-sweep` · `orphan-inventory-report` · `copilot-reaper` · `whatsapp-otp-prune` · `admin-session-prune` · `flash-sale-catchup` · `reencrypt-v1-credentials` (last, R118-B1c — five `NOT LIKE 'v2:%'` prefiltered SELECTs per boot, 5000-row/column cap with next-boot continuation).

Shared with `worker.ts` (R101) so the `DISABLE_WEB_SCHEDULERS=true` migration path keeps the restart-gap protection (worker path dormant — no worker service deployed).

### 2c. setInterval inventory — every site in `backend/src` (non-test)

| Site | Interval | Purpose | Live in prod? | Cleanup | Overlap guard |
|---|---|---|---|---|---|
| `services/alerting.service.ts:276` | 60 s | alert-rule evaluator (in-memory counters; Telegram/webhook dispatch) | ✅ (leader) | `stop()` on demote/shutdown | ✅ `evalInFlight` skip (F1) + per-rule try/catch |
| `worker/heartbeat.ts:99` | 15 s | `worker:heartbeat` SETEX TTL 60 s | ⛔ never (needs Redis; `REDIS_URL` unset) | stop fn + SIGTERM | SETEX idempotent |
| `lib/web-scheduler.ts:246` | 30 s | heartbeat re-attach poll for PG-lease leader | ⛔ skipped when `REDIS_URL` unset (AG1-2) | cleared in `stopLeaderJobs` | once-only attach |
| `worker.ts:121` | 30 s | worker degraded-boot Redis recovery poll | ⛔ dormant (no worker service) | cleared on recover | — |
| `lib/scheduler-coordinator.ts:296` | 25 s (env-tunable) | leader-lease TTL refresher | ⛔ dormant under SINGLE_INSTANCE_MODE | `stopRefresher()` | demote-on-loss |
| `lib/scheduler-coordinator.ts:468` | 20 s | leadership acquire retry | ⛔ dormant | `stopRetryTimer()` | — |
| `lib/redis-client.ts:339` | 30 s | Redis ping watchdog | ⛔ never starts (no client) | `stopPingWatchdog()` | Promise.race bounded |
| `lib/socket.ts:727` | 5 min / socket | mid-session identity re-verification (DB probe) | ✅ per connected socket | `stopIdentityReverification` on disconnect (socket.ts:784,1090) | per-socket |
| `lib/socket.ts:848` | 60 s | connection-cap tracker sweep (memory) | ✅ | unref'd; io close | — |
| `routes/cwv.ts:157` | 60 s | `sessionCaps` beacon-map sweep (memory, module-level) | ✅ | `.unref()` | — |
| `server.ts:304` | 2 s | drain-time idle-keep-alive-socket sweeper | only during SIGTERM | `clearInterval` at exit (server.ts:359) | — |

### 2d. Opportunistic throttled sweeps — `lib/opportunistic.ts` (per-process throttle from run START + `inFlight` re-entry guard; fire-and-forget; never throws)

| Key | Min interval | Trigger sites |
|---|---|---|
| `flash-sale-sweep` | 10 min | `routes/products.ts:577` (public flash surface) |
| `flash-sale-sweep` | 5 min | `routes/admin/flash-sales.ts:174` (admin promotions panel) |
| `stock-sweep` | 10 min | `routes/orders.ts:348` (checkout), `routes/admin/products.ts:637` (set-count), `:909` (stock upload), `routes/admin/orders.ts:594` (refund) |
| `coupon-sweep` | 15 min | `routes/coupons.ts:118` (apply) |
| `coupon-sweep` | 5 min | `routes/coupons.ts:274` (admin list) |
| `whatsapp-otp-prune` | 60 min | `services/whatsapp-otp.service.ts:205` (`startOtp` only — r110 comment-truth fix) |
| `copilot-reaper` | 60 min | `routes/admin/copilot/ask.ts:399` |

### 2e. Host-level (outside the app image)

`scripts/backup-cron.sh` — VM crontab **03:15 UTC daily**, gzip dumps to `/var/backups/subnation/`, keep 14 (OPERATIONS_RUNBOOK.md:716). No minute collision with any in-app slot (nearest: 02:15 forecast-dormant, 03:30 risk retention — backup of a small DB completes in minutes).

**Table size: 10 cron registrations (6 active slots / 4 dormant) + 17 boot one-shots + 7 opportunistic trigger sites (5 keys) + 11 interval-timer sites (4 classes live in prod) + 1 host cron.**

## 3. Overlap & reentrancy — verdict per class

- **node-cron dailies:** all cadences ≥24 h — self-overlap impossible unless a run takes >24 h (inconceivable at batch ≤1000/statement). Cross-fire (cron slot + boot one-shot concurrently when a deploy lands at slot time, or dual-leader drain window) is **safe by construction**: every prune re-evaluates its age predicate per batch; `logAdminAlert` serializes same-key writers with `pg_advisory_xact_lock` (alertLogger.ts:134, 99-R3).
- **Double alert / double telegram:** stock/coupon/flash/TOTP all carry restart-surviving `dedupeKey`s and gate the Telegram send on `!outcome.suppressed` (stockWatcher.ts:63-71, couponWatcher.ts:105-113, flashSaleWatcher.ts:50-65 incl. the F5 7-day key). DB-failure side channel is throttled to 1/hour/identity (F9). Verified no double-send path.
- **Alerting evaluator:** `evalInFlight` makes an overrunning cycle a SKIP (alerting.service.ts:298-303); dispatch is 5-min deduped (§P3-2 residual) + globally rate-limited ≤30/60 s; Redis errors fail open deliberately.
- **Opportunistic sweeps:** `inFlight` prevents twin-stacking of a hung run (opportunistic.ts:78); boot one-shots do NOT route through the throttle registry (→ P3-3, harmless but the comment overpromises).
- **Heartbeat:** SETEX overwrite — idempotent under any overlap.
- **Boot chain:** strictly sequential (`fireOneShotsSequentially`), so the chain itself cannot self-overlap; a demote mid-chain is impossible under SINGLE_INSTANCE_MODE (and `pendingOneShot` is cleared on demote otherwise, web-scheduler.ts:174-177).

## 4. Failure modes

- **Per-slot isolation:** every cron callback wraps its body in its own try/catch with `captureSchedulerFailure(<job_name>, …)` + distinct Sentry tag (cron.ts:71,105,129,161,176,195,216,233,299,323,345,368,386,414); the 05:00 slot splits into five independent try/catches (R110-H) so one prune failure can't skip siblings. One job's crash cannot kill the loop (node-cron ticks independent; `unhandledRejection` caught in instrument.ts).
- **Job-internal captures:** stockWatcher:100, couponWatcher:127, flashSaleWatcher:74, reportOrphanInventory:172 — all capture internally. **Gap:** the boot chain's outer catch is warn-only and uncaptured (→ P3-1).
- **Sentry:** `lib/sentry.ts:520` `captureSchedulerFailure` attaches the `subsystem: "scheduler"` tag set. Present and used on every cron path.
- **Retry semantics:** cron slots retry next day (idempotent); boot one-shots retry next restart; opportunistic sweeps retry on next trigger past the throttle window. No exponential backoff anywhere — acceptable for idempotent housekeeping.

## 5. Missed-run semantics (Coolify redeploy mid-schedule)

- **Dailies have no node-cron catch-up by design** (B7-P2-12) — but **every active slot has an idempotent boot one-shot twin** (verified 1:1 in the table §2a/§2b), so a redeploy that straddles a slot loses at most the hours between slot and restart, closed at next boot. This is the correct answer to "missed runs": *caught up on next leader start, not silently skipped*.
- **One-shot idempotency across restarts:** verified per entry — age-predicate DELETEs re-evaluated per batch; `checkExpiringCoupons`/`deactivateExpiredFlashSales` re-apply their own predicates; alert dedupe keys survive restarts; `reencrypt-v1-credentials` uses optimistic `WHERE id=$1 AND <col>=$old` guards (concurrent writer never clobbered) + 5000-row cap for continuation.
- **Dormant slots** (forecast/enrichment, WORKER_TIER-gated): no boot twin — consistent with their tables being runner-fed and the runners being dormant (no route writes `enrichment_drafts`/`enrichment_runs`/`inventory_forecasts` — only runners + tests insert). Known-adjacent (97-A1 #10 note); no production gap today.
- **Crash-loop amplification:** every restart fires the 17-job chain ~7 s after start — all bounded/idempotent; the only steady-state per-boot cost is the reencrypt prefilter scan (documented, tiny tables).

## 6. Time correctness

- **Every one of the 10 cron registrations passes `{ timezone: "UTC" }` explicitly** (F6 fix — verified in source at each `schedule(...)` call) and the runtime image pins `TZ=UTC` (Dockerfile:203-209, "belt to that suspender"). Whose midnight? **UTC midnight = 02:00 Libya** (documented in cron.ts:142 "05:00 UTC = 07:00 Libya, before the daily traffic peak" and idempotency-retention's "02:00 Libya" note). Deliberate and consistent.
- **DST traps: none.** Africa/Tripoli has had no DST since 2013 (EET, UTC+2 year-round); all cron slots are UTC-locked anyway. The JS-side relative-window arithmetic (`idempotency-retention.ts:42-43` `setHours(getHours()-48)`, `auth-audit-retention.ts:28-32`, `notifications-retention.ts:29-32` `setDate`) is process-local-time dependent, which is UTC in the container — an hour of slop would be irrelevant to 48h/7d/90d/180d windows even under a hypothetical TZ injection. Non-issue; noted for completeness.
- **Clock sources:** prunes split between JS `Date.now()` cutoffs and DB `now()` (`risk-retention`, `admin-session.ts:191`, `copilot-reaper:59`) — both absolute timestamptz comparisons; no wall-clock/drift coupling between scheduler ticks and predicates. node-cron drift is bounded by its per-minute evaluation; nothing accumulates.

## 7. Data-volume trajectory (2027) + index support matrix

Live-DB index source of truth = `migrate.ts` boot migrations + `shared/db/src/schema/*` (both checked; schema-declared indexes all have migrate twins for the tables below).

| Prune predicate | Predicate column(s) | Index support | Growth driver / steady-state shape |
|---|---|---|---|
| sessions — `expires_at < now()` (session-prune.ts:39) | expires_at | ❌ **none** (only `idx_sessions_user_id`) | 1 row/login; steady state ≈ 30-day login window |
| admin_sessions — `expires_at < now()-24h OR revoked_at < now()-30d` (admin-session.ts:191-192) | expires_at, revoked_at | ❌ **none** (only `idx_admin_sessions_admin`, migrate.ts:656) | 1 row/admin-login; tiny but unindexed |
| login_attempts — `last_attempt < cutoff` (auth-audit-retention.ts:51) | last_attempt | ❌ **none** (only `UNIQUE(identifier)`, migrate.ts:2660) | **attacker-controlled**: 1 upsert per `phone:ip`/`username:ip` pair — IP-rotating stuffing grows it linearly with distinct pairs |
| idempotency_keys — `created_at < cutoff` (idempotency-retention.ts:53) | created_at | ❌ **none** (only `idx_idempotency_keys_order`, migrate.ts:619) | 1 row/guarded purchase; steady state ≈ 48 h of purchase volume |
| notifications — `(is_read AND created_at<r) OR (!is_read AND created_at<u)` (notifications-retention.ts:42-43) | created_at (+is_read) | ❌ **none usable** (only `(user_id, created_at DESC)` — leading column doesn't match) | 1 row/user-event; steady state ≈ 90–180 d of events |
| whatsapp_otps — `created_at < cutoff` (whatsapp-otp.service.ts:986) | created_at | ❌ **near-miss**: `idx_whatsapp_otps_expires_at` EXISTS (migrate.ts:2745) but the predicate doesn't use it | 1 row/OTP start; steady state ≈ 24 h of OTP volume |
| admin_alerts — `is_read AND created_at<cutoff` | created_at | ✅ `idx_admin_alerts_created` | deduped, small |
| audit_logs — `created_at < cutoff` | created_at | ✅ `idx_audit_logs_created` | 180 d window |
| auth_activity — `created_at < cutoff` | created_at | ✅ `idx_auth_activity_created` | 90 d window |
| risk_events — `created_at < …` (+label EXISTS) | created_at | ✅ `idx_risk_events_created_id_desc` | 90/97 d window |
| copilot_previews — `expires_at < NOW()-24h` | expires_at | ✅ `idx_copilot_previews_expires` | usage-driven |

At today's volume (R111 live counts: login_attempts 3 rows, audit_logs 25 rows; catalog 45 products) the missing indexes are invisible — a prune with zero victims costs one seq scan of a small table. The risk is the **catch-up-purge amplifier**: the ctid-batch loop costs one seq scan per 1000-row batch, so a backlog B on a table of size S costs ~O(B×S/1000) row visits on a 0.25 CU Neon compute. Worked incident case: a credential-stuffing burst from rotating IPs at 10k distinct pairs/hour for a week leaves ~1.7M login_attempts rows (7-day retention steady state) → the next 05:00 prune + every boot one-shot then runs ~1,700 consecutive full scans of 1.7M rows **while the DB is already under attack**, and keeps Neon permanently awake. Same shape, milder, for the other five. Will the jobs still *finish* in 2027? Yes — but progressively slower and with a self-DoS amplifier precisely when the platform is worst-placed to afford it. → **P2-1**.

## 8. R126 additions — scheduler interaction check

- **Products stats emits ×8 (commit `b0a9267`/round lane):** all 8 sites are fire-and-forget `emitToAdmins("admin-stats-update", …)` socket emissions + `bumpCatalogCache()` on admin write routes (5 in `routes/admin/products.ts` at :301, :397, :442, :625, :897 + 3 in `product-variants.ts`). **No scheduled job fires, consumes, or is consumed by them** — the emit family is purely event-driven on the HTTP write path; no cron/watcher/one-shot references `admin-stats-update` or the stats surface. Coexistence with the opportunistic stock-sweep on the same routes (admin/products.ts:637/:909) is clean: both are fire-and-forget, the sweep is throttle-guarded, the emit is null-safe. No double-emit, no scheduler coupling.
- **Zombie-polling close (commit `f53a886`):** diff re-read in full — it changes ONLY frontend query gates (`dashboard.tsx:418-425` `enabled: !!adminToken && canSeeMoney`, `layout.tsx:889-897` `enabled: !!adminToken && canSeeFinanceBadge`) + docs + the two pinning tests. The retired zombie was a client-side React Query `refetchInterval: 300_000` against the now-finance-gated `/api/admin/stats` — **not a scheduler job; nothing in cron/watchers/one-shots/opportunistic was touched; no job was orphaned.** Backend `/api/admin/stats` remains and is still polled by finance-scoped sessions every 5 min (intended).

## 9. Findings

### P0 — none. P1 — none.

### P2-1 · Six prune predicates have no index support — catch-up purges degrade to repeated full seq scans (incident amplifier)
**Confidence 5** (schema + migrate.ts verified exhaustively) · impact confidence 4.

Verbatim:
- `backend/src/jobs/session-prune.ts:35-40` — `DELETE FROM sessions / WHERE ctid IN ( / SELECT ctid FROM sessions / WHERE expires_at < now()` — and `shared/db/src/schema/sessions.ts:17` shows the table's only index: `userIdIdx: index("idx_sessions_user_id").on(t.userId),`
- `backend/src/lib/admin-session.ts:191-192` — `WHERE expires_at < now() - interval '24 hours' / OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')` — only `idx_admin_sessions_admin` exists (`backend/src/migrate.ts:656`)
- `backend/src/jobs/auth-audit-retention.ts:51` — `WHERE last_attempt < ${cutoff}` — only `CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier);` (`migrate.ts:2660`)
- `backend/src/jobs/idempotency-retention.ts:53` — `WHERE created_at < ${cutoff}` — only `idx_idempotency_keys_order` (`migrate.ts:619`)
- `backend/src/jobs/notifications-retention.ts:42-43` — `WHERE (is_read = true AND created_at < ${readCutoff}) / OR (is_read = false AND created_at < ${unreadCutoff})` — only `(user_id, created_at DESC)` (`migrate.ts:1435-1436`)
- `backend/src/services/whatsapp-otp.service.ts:986` — `WHERE created_at < ${cutoff}` — while `migrate.ts:2745-2746` already ships `CREATE INDEX IF NOT EXISTS idx_whatsapp_otps_expires_at / ON whatsapp_otps(expires_at);` (unused by this predicate)

**Why it matters:** §7 — each 1000-row batch costs a full scan without an index; attacker-grown `login_attempts` is the worst case (1.7M-row scenario → ~1,700 consecutive scans of 1.7M rows per prune, repeated at every boot one-shot, on the smallest Neon compute, during an active incident). The ctid-batch design (B7-P2-5/F11) bounds LOCK footprint but not SCAN footprint.

**Fix directives (one new V1-Mxx migration, all `CREATE INDEX CONCURRENTLY` — or plain `IF NOT EXISTS` in a boot migration per house style since boots are single-instance; add the schema twins):**
1. `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);` (optionally partial `WHERE expires_at < now()` is pointless — use plain)
2. `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);` + `…_revoked_at ON admin_sessions(revoked_at) WHERE revoked_at IS NOT NULL;`
3. `CREATE INDEX IF NOT EXISTS idx_login_attempts_last_attempt ON login_attempts(last_attempt);` ← the important one
4. `CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);`
5. `CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);`
6. whatsapp_otps: **either** switch the predicate to `expires_at < now() - interval '23 hours'` (uses the existing index; 23 h ≥ OTP TTL + margin keeps the 24 h-created-at semantics a superset) **or** add `idx_whatsapp_otps_created_at`. The predicate switch is the one-liner.
Write-amplification note: these are hot-INSERT tables — each new index adds a small per-insert cost; sizes are modest, and the login_attempts one defends precisely the attack path. Alternatively cap write cost with a partial index where natural (`revoked_at IS NOT NULL`).

### P3-1 · Boot one-shot chain: failures are warn-only (no Sentry) and the message promises a cron slot 7 of 17 entries don't have
**Confidence 5.** `backend/src/jobs/boot-one-shots.ts:62-69`:
```ts
      } catch (err) {
        logger.warn(
          { err, category: "monitoring" },
          `[scheduler] ${name} boot one-shot failed (will run again at its cron slot)`,
        );
```
Seven entries have **no cron slot** — `coupon-sweep`, `stock-sweep`, `orphan-inventory-report`, `copilot-reaper`, `whatsapp-otp-prune`, `flash-sale-catchup` (opportunistic/boot only) and `reencrypt-v1-credentials` (boot only, next retry = next deploy). For `copilot-reaper` and `whatsapp-otp-prune` and `reencrypt-v1-credentials` there is also **no internal `captureSchedulerFailure`** (unlike stockWatcher/couponWatcher/flashSaleWatcher/reportOrphanInventory), so a DB failure at boot surfaces only as a warn log — invisible to Sentry, contradicting the per-job Sentry-tag contract every cron slot honors. The file does not import `captureSchedulerFailure` at all (imports at :28-43).
**Fix:** add `captureSchedulerFailure(name, err, { trigger: "boot_one_shot" })` inside the chain catch; reword the message to "(will re-run at its next trigger: cron slot, opportunistic traffic, or next boot — per job)".

### P3-2 · In-memory alert dedupe clears on restart — a deploy mid-incident re-pages the operator once per active rule
**Confidence 4.** `backend/src/services/alerting.service.ts:846-848`:
```ts
  private async isDeduped(dedupKey: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return claimDedupInMemory(dedupKey);
```
With `REDIS_URL` unset (the deployed shape, ENVIRONMENT_MATRIX:24) the 5-min dedup contract lives in a bounded 128-key in-process map; a container restart mid-incident (exactly when deploys happen) drops the claims, so the new leader's first evaluator tick can re-dispatch a Telegram page for a still-true rule that was paged <5 min earlier. Bounded (≤10 rules, one extra page per restart), deliberate per the F1 comment ("the memory store is only for 'no Redis at all'"), and the counter-baseline side is already fixed (99-R2 clear-on-start, alerting.service.ts:273-274). **Fix (optional):** persist the last-dispatched timestamp per rule key in `system_settings` as the no-Redis dedupe backstop, or accept the documented single-instance trade-off and note it in OPERATIONS_RUNBOOK.

### P3-3 · `opportunistic.ts` boot-catch-up comment overpromises throttle dedupe across the boot boundary
**Confidence 4.** `backend/src/lib/opportunistic.ts:41-44` — "Boot catch-up: jobs/cron.ts + web-scheduler.ts still fire the retention one-shots at leader start (idempotent), so a mostly-sleeping service still converges — the throttle keys below simply dedupe the first post-boot trigger within its window." — but the boot one-shots call the sweep functions **directly** (`boot-one-shots.ts:133-142` — `["coupon-sweep", checkExpiringCoupons]` etc., not routed through `fireThrottledMaintenance`), so the registry is empty at boot and the first traffic trigger a second later fires a second sweep. Harmless (idempotent, DB-deduped, throttled thereafter), but the comment claims a dedupe that doesn't exist across the boundary. **Fix:** either route the five sweep one-shots through `fireThrottledMaintenance(key, window, fn)` at boot (populates the registry — one-line each) or reword the comment to "the throttle dedupes triggers *after* the first post-boot pass".

## 10. Known items — NOT re-reported (pointer table)

| Known item | Source | Status at f53a886 |
|---|---|---|
| Alert dedupe heritage (dedupe_key, 24 h window, stale-read 14 d, prune 30 d, spam consolidation) | Round-5 (b299cfb) | live; advisory-lock upgrade 99-R3 |
| Retention 00:00 + session-prune 05:00 + boot one-shots at leader start | Round-5 / B7-P2-12 | live; roster now 17 |
| Unbounded raw Redis commands on login/money paths (risk-aggregate, telegram-replay, account-link-consent, observability) | 97-A1 #1 | moot in prod (no Redis) but code-level open |
| "Dark schedulers" blindness (healthz green while schedulers dead) | 97-A1 #2 | largely defused by 97-F1 PG-lease fallback + SINGLE_INSTANCE_MODE (no election to lose) |
| web-scheduler heartbeat-decision one-shot / recovery loop | 97-A1 #3 | **fixed** (R101 poll :246-258, skipped when no REDIS_URL) |
| alerting counterBaseline survives stop/start | 97-A1 #4 | **fixed** (99-R2 clear-on-start :273-274) |
| Hourly tables without `timezone:"UTC"` (F6 leftovers) | 97-A1 #5 | **moot** — all sub-hourly crons removed 2026-09-20; remaining 10 all pass UTC |
| cron.ts comment drift (02:15/:45 rationale, duplicated "8.") | 97-A1 #6 | **fixed** (R101 comment-truth pass, cron.ts:307-315, 241-265) |
| alertLogger SELECT-then-INSERT twin rows | 97-A1 #7 | **fixed** (pg_advisory_xact_lock :134) |
| scheduler-coordinator SIGTERM-during-acquire orphan lock | 97-A1 #8 | **fixed** (R101 orphan-lock guard :438-464, 501-510) |
| web-scheduler one-shot pruneExpiredSessions-only asymmetry | 97-A1 #9 | **fixed** (admin-session-prune in boot chain :141) |
| worker path missing one-shots | 97-A1 #10 | **fixed** (R101 shared `boot-one-shots.ts`, worker.ts:157) |
| redis-client dead export requireRedisClient | 97-A1 #11 | not re-checked (out of scope) |
| Per-job try/catch+Sentry, ctid-batched ≤1000, no unbounded scans, sub-hourly jobs opportunistic | R110-R111 hardening | verified live at HEAD |
| forecast/enrichment retention lacks boot one-shot (dormant WORKER_TIER family) | 97-A1 #10 note | still true; consistent (runners dormant; no route writes those tables) — re-verified §5 |
| Keep-alive self-ping / hourly OTP+copilot crons removed for free-tier economics | 2026-09-20 round | verified (cron.ts:241-265) |

## 11. Next actions (ordered)

1. **P2-1** — ship the six-index migration (+ whatsapp predicate one-liner choice); prioritize `idx_login_attempts_last_attempt`.
2. **P3-1** — Sentry-capture + message truth-up in `fireOneShotsSequentially` (5-minute fix).
3. **P3-3** — route boot sweeps through the throttle registry or fix the comment.
4. **P3-2** — operator decision: accept (document in runbook) or persist dedupe timestamps in `system_settings`.
5. Optional hygiene: when `WORKER_TIER` is ever armed for real, add boot one-shots for `runForecastRetention`/`runEnrichmentRetention` so the catch-up contract stays uniform.

— R127-B7, 2026-10-09. Read-only throughout: zero source mutations, zero commits, zero production requests fired (this audit touched only the repo tree + worklog).
