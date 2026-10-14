# Lane L14 (R143) — Scheduled jobs & external integrations audit

**Repo:** SubNation2 @ `528ef39` (HEAD clean; read-only lane — no modifications, no WhatsApp/OpenWA/Telegram production touches).
**Scope:** R142 L-1/L-2/L-3 verification · full scheduler inventory · L-3-class residual hunt · Telegram dispatch/topup-card round-trip · OpenWA contract · Sentry both sides · job observability · startup ordering · clock/timezone.
**Runs at HEAD:** `telegram-dispatch-retry` 7/7 green · `whatsapp-otp-daily-cap` + `boot-one-shot-failure-capture` 7/7 green · full `src/jobs` suite **36 files / 281 tests green** · scheduler-coordinator/web-scheduler-demotion/web-scheduler-single-instance 33/33 green.

---

## R142 fix verification

| Fix | Status | Evidence |
|---|---|---|
| **L-1** telegram dispatch retry tests | **VERIFIED** | `backend/src/lib/__tests__/telegram-dispatch-retry.test.ts` (239 lines) exists and passes 7/7 at HEAD. Pins: env-unset → skip/zero fetches (line 63); `200 ok:false` → permanent, exactly 1 fetch (77-103); 500→200 retry on attempt 2 (105-133); 429 `retry_after:99` clamped to 5s with a 4_999/5_000 boundary probe (135-170); network abort retry (172-193); double-500 and double-network permanent (195-238). The file's own header documents the R98-A6/F5 body-ok history. |
| **L-2** opportunistic bounded `inFlight` + visible skip log | **PARTIALLY VERIFIED — code yes, promised test NO** | Code present: `backend/src/lib/opportunistic.ts:66` `export const HUNG_RUN_FLOOR_MS = 10 * 60_000` (hung-run re-arm floor), `:90-95` the visible debug skip log, `:103-107` entry-object capture so a stale `finally` can't clear a re-armed flag. **But no unit test exists anywhere in the tree**: `rg "HUNG_RUN_FLOOR_MS|fireThrottledMaintenance"` across all `*.test.ts(x)` finds only a *comment* (`routes/__tests__/coupons-validate.test.ts:43-44`). The export's own doc says "Exported for the unit test" — zero consumers. `docs/engineering/R142/lanes/IMPL-wave-report.md:34` claims the test column is "opportunistic suite" — no such file exists. → **L14-1** below. |
| **L-3** captureSchedulerFailure on copilot-reaper + whatsapp-otp-prune | **VERIFIED** | `backend/src/jobs/copilot-reaper.ts:74-78`: internal catch → `captureSchedulerFailure("copilot_reaper", err)`. `backend/src/services/whatsapp-otp.service.ts:841-848`: `pruneExpiredOtps` wraps `pruneExpiredOtpsInner` with `captureSchedulerFailure("whatsapp_otp_prune", err)`. Both fire on *every* trigger path (the internal catch is the one the opportunistic warn-only catch used to shadow). `whatsapp-otp-daily-cap.test.ts` gained the `execute` mock to match (commit `2df0a62`). |

---

## Findings

### L14-1 · P3 · L-2's claimed regression test does not exist — the opportunistic throttle still has zero direct tests, and the R142 wave report overstates what landed
- **Evidence:** `backend/src/lib/opportunistic.ts:59-66` — "L-2 (R142): … Exported for the unit test." / `export const HUNG_RUN_FLOOR_MS = 10 * 60_000;` — yet `rg -l "HUNG_RUN_FLOOR_MS|fireThrottledMaintenance" --glob "**/*.test.ts*"` over backend+frontend+shared returns only `routes/__tests__/coupons-validate.test.ts` (a comment at lines 43-44, not an import). `docs/engineering/R142/lanes/IMPL-wave-report.md:34` — "| L-2 P3 | hung-run floor (10 min) + visible skip log | lib/opportunistic.ts | **opportunistic suite** |" — no such suite exists in the tree.
- **Root cause:** The implementation wave landed the code half of L-2 (and *more* than recommended — the predecessor explicitly said "Do not add a timer bound without a real case") but not the test half; the wave report's test column was written from the fix plan, not from the tree.
- **Impact:** The predecessor's exact concern stands unguarded: a regression in the re-entry guard, the throttle window, the new 10-min hung floor, or the stale-`finally`/re-arm interaction ships green. Five retention/sweep jobs' *only* recurring trigger rides on ~40 lines of stateful logic with no failing test. The report inaccuracy is itself a process defect (a future auditor trusting IMPL-wave-report.md would mark L-2 fully closed).
- **Proposed fix:** (a) Add `backend/src/lib/__tests__/opportunistic.test.ts` (~80 lines, fake timers): first call runs; second inside window is a no-op; a failed run still throttles; a thrown body never rejects to the caller; in-flight skip logs debug + returns false; a run older than `HUNG_RUN_FLOOR_MS` re-arms; a stale promise settling after a re-arm cannot clear the new flag. (b) Correct IMPL-wave-report.md:34 to "code only — test not landed".
- **Test requirement:** the file above is the requirement.
- **Risk:** none (test-only + doc correction).

### L14-2 · P3 · `checkAdminTotpAdvisory`'s internal catch swallows failures BEFORE both outer Sentry captures — the TOTP advisory fails log-only (warn) on BOTH of its triggers (remaining L-3-class site)
- **Evidence:** `backend/src/jobs/security-advisories.ts:84-87` — `} catch (err) { // Advisory-only — a failure here must never affect boot. logger.warn({ err, category: "security" }, "security-advisories: TOTP check failed"); }` — no `captureSchedulerFailure`. The cron slot *looks* covered — `backend/src/jobs/cron.ts:127-131`: `} catch (err) { … captureSchedulerFailure("totp_advisory", err, …)` — but the function **never throws** (the internal catch returns normally), so this capture is unreachable dead code for any error raised inside the body. Same for the boot chain: `boot-one-shots.ts:120` `captureSchedulerFailure(name, err, { trigger: "boot_one_shot" })` can never fire for the `"security-advisories"` entry (`boot-one-shots.ts:168`).
- **Root cause:** Same class the R142 L-3 fix closed for copilot-reaper/whatsapp-otp-prune: an internal best-effort catch that pre-empts the per-trigger capture contract. Every sibling retention job body (session-prune, risk-retention, idempotency-retention, notifications-retention, auth-audit-retention — verified: zero internal catches) correctly propagates to the cron/boot captures; this is the one body that doesn't.
- **Impact:** A slow-growing DB failure (permission error on the advisory SELECT/insert) makes the weekly TOTP nudge silently dead for weeks on a no-deploy instance — pino warn only, zero Sentry signal, exactly the observability asymmetry L-3 described. Materiality is lower than L-3's (advisory nudges, not table retention), hence P3 not higher.
- **Proposed fix:** One line — add `captureSchedulerFailure("totp_advisory", err, { trigger: "advisory" });` inside the internal catch (the exact pattern L-3 used in copilot-reaper.ts:76), keeping the non-throwing contract.
- **Test requirement:** extend `boot-one-shot-failure-capture.test.ts` (or the security-advisories suite) with one case: body throws → Sentry helper called + caller unaffected.
- **Risk:** none.

### L14-3 · P3 · The WhatsApp channel-death alert tells the operator to check **Render** — the platform retired 2026-10-05 — during a gateway outage
- **Evidence:** `backend/src/services/whatsapp-watch.ts:132` — the unreachable-gateway alert copy: `"تعذّر الوصول إلى بوابة WhatsApp (probe فشل) منذ ~${minutes} دقيقة — لا يمكن تحديد حالة الجلسة. افحص خدمة البوابة على Render ثم لوحة الإدارة (قسم WhatsApp)."` ("check the gateway service on Render"). `.hermes.md:28` — "render.yaml / vercel.json were REMOVED 2026-10-05 (Vercel/Render fully retired…)". `docs/WHATSAPP_OPERATIONS.md:8-12` — the old Render gateway "موقوفة نهائيًا… **لا تحاول استئنافها**؛ مسار الإنتاج هو Coolify حصرًا" (permanently suspended; production path is Coolify only, gateway at `http://openwa:2785` internal).
- **Root cause:** Stale platform reference in live alert copy — same family as O-4 (docs claiming Telegram/Sentry absent) but this one renders into the admin alert drawer at the worst possible moment.
- **Impact:** When the OpenWA container is unreachable (the exact condition that arms this alert), the operator is directed to a dead platform's dashboard — wasted outage minutes on the OTP login channel; the correct action (check the `openwa` service health/logs in the Coolify panel) is only implied.
- **Proposed fix:** Replace the instruction with: «افحص خدمة openwa في لوحة Coolify (Healthcheck/السجلات — `http://openwa:2785/healthz` داخليًا) ثم لوحة الإدارة (قسم WhatsApp)». One string.
- **Test requirement:** a one-line copy assertion in `openwa-watch-feed.test.ts` (the suite already pins watch behavior) or a dedicated grep-style pin like the admin-no-store stragglers pattern.
- **Risk:** none.

### L14-4 · P3 · No per-job observability surface: job last-run / next-run / failure is invisible in-app — scheduler failures are Sentry-only
- **Evidence:** `backend/src/routes/admin/observability.ts:194-265` — the `/scheduler` endpoint exposes process-level state only (mode, active, isLeader, instanceId, startedAt, heartbeat). `backend/src/lib/metrics-snapshot.ts:438` — the only job-shaped metric surfaced is `worker_jobs_total` (the dormant Redis worker queue). `backend/src/lib/sentry.ts:540-558` — `captureSchedulerFailure` goes to Sentry tags + nothing else; no job writes an admin alert on failure. The frontend System tab consumes exactly this (`frontend/src/pages/admin/system.tsx:218-221` → scheduler banner).
- **Root cause:** Deliberate architecture (no job persistence, no job registry — the free-tier design), so no last-run state exists to read; node-cron tasks don't expose next-run to the app. The failure signal was routed exclusively to Sentry.
- **Impact:** An operator watching the admin panel (alerts drawer + System tab) has no signal that e.g. `risk_retention` failed on every 03:30 slot for a week; the evidence lives in a Sentry project they must open separately (and if the DSN/quota has an issue, in pino logs only). The drawer already surfaces stock/coupon/WhatsApp-channel conditions — scheduler failures are the one operations class with no drawer presence.
- **Proposed fix (lean, no new state):** in `captureSchedulerFailure` (or a thin wrapper used by cron/boot/opportunistic captures), also `logAdminAlert("system", …, { dedupeKey: \`scheduler_failure:${jobName}\` })` — the 24h dedupe keeps the drawer to a state, not a history; `alertLogger`'s F9 DB-failure side-channel already handles the outage case. ~10 lines.
- **Test requirement:** one case in `alert-hygiene.test.ts`: captureSchedulerFailure → drawer row appears once per job per 24h.
- **Risk:** low — alert volume is bounded by the dedupe window; a flapping job surfaces one row/day.

### L14-5 · P4 · `notifyCouponExpiringSoon` renders the coupon expiry in the server's process TZ (UTC) — 2 hours off the operator's wall clock, contradicting both its sibling helper and the drawer card for the same coupon
- **Evidence:** `backend/src/telegram.ts:284-289` — `const dateStr = expiresAt.toLocaleDateString("ar-LY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });` — **no `timeZone` option**. Contrast: `timestampLine()` in the same module pins `timeZone: "Africa/Tripoli"` (`telegram.ts:652-663`, header comment "rendered in Libya time (Africa/Tripoli, UTC+2)"), and `couponWatcher.ts:105` formats the SAME expiry **with** `timeZone: "Africa/Tripoli"` for the alert drawer. `Dockerfile:204` pins `TZ=UTC` (belt for cron.ts:36-37's explicit `timezone: "UTC"`).
- **Root cause:** missed option at one of three format sites for the same datum.
- **Impact:** the Telegram card's «وقت الانتهاء» line shows UTC while the relative label next to it («ينتهي خلال: N ساعة») and the admin drawer show Tripoli time — a self-contradicting money-adjacent card; bounded confusion because the relative label is adjacent and correct.
- **Proposed fix:** add `timeZone: "Africa/Tripoli"` to the `dateStr` options (one line).
- **Test requirement:** none beyond a possible copy pin; the transformation is deterministic.
- **Risk:** none.

### L14-6 · P4 · R142 deferred debt L-4..L-7 re-confirmed unchanged at HEAD (record-keeping, no new action this round)
- **L-4** (dual Telegram senders): `alerting.service.ts:756-800` still carries its own timeout constant + own `ok:false` check (F5) + dispatch-level 5s retry (`:713-742`) vs `telegram.ts:391-501`'s `retry_after` clamp + `telegram_sends_total` metrics — divergence stands exactly as documented.
- **L-5** (worker entry untested): `worker.ts` still has no test importing `installWorkerSignalHandlers`; the `SINGLE_INSTANCE_MODE` double-run guard is still warn-only (`worker.ts:90-96`) — intentional, documented.
- **L-6** (Redis adapter never closed): `lib/socket.ts:180-190` unchanged — no stop handle for `pubClient`/`subClient`; inert in the live no-Redis shape.
- **L-7** (topup-updated `amount` string-as-number): `topup.service.ts:638,705` still emit `amount: topup.amount` (drizzle numeric → string) against the client's `amount: number` typing.
- **Disposition:** these carry recorded decisions in the R142 ledger; nothing here escalates them.

---

## Scheduler inventory (every recurring/scheduled job at HEAD)

Leader election: `SINGLE_INSTANCE_MODE=true` = declared single owner, no election (`web-scheduler.ts:301-331`); otherwise Redis `SETNX` TTL 60s/refresh 25s or PG-lease fallback (`scheduler-coordinator.ts`), 20s acquisition retry, R6 demotion on loss. Boot one-shots fire **+7s after leadership** (`web-scheduler.ts:120-122,285-289`, `BOOT_ONE_SHOT_DELAY_MS`).

| Job | Trigger(s) | Lock | Failure capture (Sentry) | Overlap/stuck-run guard | Verdict |
|---|---|---|---|---|---|
| admin-alert retention | cron 00:00 UTC + boot | leader | cron `admin_alert_retention` (cron.ts:71) + boot chain | idempotent predicates; batched | OK |
| idempotency-keys retention | cron 00:00 + boot | leader | `idempotency_keys_retention` (cron.ts:105) + chain | 48h cutoff, batched | OK |
| **TOTP advisory** | cron 00:05 + boot | leader | cron/boot captures **dead** — internal swallow | 7d dedupe key | ⚠️ **L14-2** |
| session prune (user) | cron 05:00 + boot | leader | `session_prune` (cron.ts:161) | expired-only, batched | OK |
| admin-session prune | cron 05:00 + boot | leader | `admin_session_prune` (cron.ts:176) | 24h/30d predicates | OK |
| notifications retention | cron 05:00 + boot | leader | `notifications_retention` (cron.ts:195) | 90d/180d, batched | OK |
| login-attempts retention | cron 05:00 + boot | leader | `login_attempts_retention` (cron.ts:216) | 7d idle | OK |
| audit-logs retention | cron 05:00 + boot | leader | `audit_logs_retention` (cron.ts:233) | 180d | OK |
| risk retention | cron 03:30 + boot | leader | `risk_retention` (cron.ts:299) | per-batch predicates, 30d orphan grace | OK |
| forecast runner | cron 02:15 (WORKER_TIER gate in runner) | leader | `forecast_runner` (cron.ts:323) | run-store rows; abandoned reap | OK (dormant) |
| forecast retention | cron 03:35 (gate in callback) | leader | `forecast_retention` (cron.ts:345) | in_flight>24h reap | OK (dormant) |
| enrichment runner | cron 03:50 | leader | `enrichment_runner` (cron.ts:368) | same shape | OK (dormant) |
| enrichment retention | cron 04:00 | leader | `enrichment_retention` (cron.ts:386) | same shape | OK (dormant) |
| auth-activity retention | cron 04:30 + boot | leader | `auth_activity_retention` (cron.ts:414) | 90d, batched | OK |
| stock sweep | opportunistic 10min (orders.ts:380, admin/products.ts:646,980, admin/orders.ts:592) + boot | none (in-proc throttle) | **internal** `stock_watcher` (stockWatcher.ts:120) | throttle re-entry + L-2 hung floor; DB dedupe keys restart-safe | OK |
| coupon sweep | opportunistic 15min (coupons.ts:162) / 5min admin (coupons.ts:326) + boot | throttle | internal `coupon_watcher` (couponWatcher.ts:157) | UPDATE re-applies predicate; dedupe keys | OK |
| flash-sale sweep | opportunistic 10min public (products.ts:163) / 5min admin (admin/flash-sales.ts:174) + boot | throttle | internal `flash_sale_watcher` (flashSaleWatcher.ts:78) | predicate-reapplying UPDATE; 7d dedupe | OK |
| whatsapp-otp prune | opportunistic 60min (whatsapp-otp.service.ts:155) + boot | throttle | internal `whatsapp_otp_prune` (**L-3 fixed**, :845) | expires_at-indexed superset window, batched | OK |
| copilot reaper | opportunistic 60min (admin/copilot/ask.ts:399) + boot | throttle | internal `copilot_reaper` (**L-3 fixed**, :76) | predicate per batch | OK |
| orphan-inventory report | boot-only | leader (chain) | internal `orphan_inventory_report` (stockWatcher.ts:192) + chain | 24h dedupe; never deletes | OK |
| reencrypt v1→v2 | boot-only, last in chain | leader | chain capture + internal optimistic-WHERE | 5000-row cap/boot | OK |
| alerting evaluator | 60s interval (leader) | leader | evaluator catch → `monitoring_errors_total` + log (no Sentry — fail-safe documented); dispatch final failure → Sentry (alerting.service.ts:736) | `evalInFlight` re-entrancy guard (F1) | OK |
| worker heartbeat | 15s interval (Redis only — inert in live shape) | leader | `isolate()` reports + swallows (R7); bounded SETEX | idempotent SETEX; command timeout | OK |
| heartbeat recovery poll | 30s (web leader, only when REDIS_URL set) | leader | — (attaches heartbeat; no DB) | self-clearing | OK |
| socket cap sweep / identity re-verify | 60s / 5min per-socket | none (per-socket) | DB probe fail-open documented (socket/auth.ts:453) | timer per-socket, cleared on disconnect | OK |
| cwv sessionCaps cleanup | 60s, in-memory map | none | n/a (no DB/IO) | unref'd | OK |
| idempotency 42P01 re-probe | 60min, only while degraded | none | gauge `idempotency_degraded` | latch + timer teardown | OK |
| WhatsApp channel watch | observation-driven (readiness probes + OTP sends) | `observeInFlight` | emission failures warn-only; `logAdminAlert` owns F9 side-channel | in-flight guard; streak + rolling counter | OK — copy defect **L14-3** |
| WhatsApp warm-up self-check | intent-driven per pairing epoch | settle-gate maps | send failures feed the watch | epoch-scoped | OK |

No job persists run state; **retry truth per kind** (cron → next slot; opportunistic → next throttled trigger/boot; boot-only → next deploy) is pinned by `boot-one-shot-failure-capture.test.ts` + the per-kind map (`boot-one-shots.ts:84-108`).

## Cross-cutting verification notes

- **Startup ordering (clean):** port binds first behind a 503 "starting" gate (`server.ts:149-194,368-374`) → `assertEncryptionKeyConfigured` → Redis init → `bootMigrations` → `bootReady=true` (traffic gate opens) → `startWebSchedulers` post-ready, failure-tolerant (`server.ts:399-410`) → crons at leadership, one-shots +7s later. **No window exists where a job fires before migrations/readiness** — jobs start strictly after `bootstrapCore` resolves, and the one-shot DELETEs are further deferred off the first-visitor pool contention (R104 AG6-6).
- **Deploy/restart overlap:** graceful drain stops crons/heartbeat/alerting BEFORE releasing the lock (R8, `web-scheduler.ts:354-367`); orphan-lock guard frees a post-release acquisition (R101). Under `SINGLE_INSTANCE_MODE` (live shape) a brief two-container overlap double-runs idempotent jobs — the documented bounded trade (opportunistic.ts:32-34); alerting's in-memory dedupe fallback means a possible duplicate page bounded by the overlap window.
- **Telegram outage behavior:** every `notify*` is fire-and-forget with one transient-only retry, 5s cap, `retry_after` clamp, permanent → Sentry (`telegram.ts:55-61,391-501`); **no queue/durability by design** — a crash mid-dispatch loses that one message; the topup stays `pending` and fully actionable via the admin UI (independent path). Webhook round-trip: secret (timing-safe) → `TELEGRAM_ADMIN_IDS` allowlist → still-pending re-check → `TopupService.approve/reject` full guard battery → audit row (B11-F1) → keyboard strip + message edit → always-200 ack so Telegram never re-posts (`telegram-webhook.ts:115-281`). Webhook registration itself is operator-side (no `setWebhook` in code). A Telegram outage breaks zero money flows.
- **OpenWA contract:** every call `gatewayFetch` 8s `AbortSignal.timeout` + `X-API-Key` (`gateway-client.ts:130,139-149`); send retries 3× (1.5s/4s backoff) on network/5xx/409 only, session re-resolved between attempts (`openwa.service.ts:426-517`); LID preflight fail-open/fail-fast; readiness probe 30s-cached, honest `null` when unreachable; settle gate pairing-epoch-scoped (routine restores don't re-pay 45s); session health = observation-driven watch (15-min streak + rolling 3-in-60min send failures) + admin panel. OTP send happens **before** row insert with insert retried once; `store_failed` → 500 + Retry-After + cooldown. **Scope clarification:** WhatsApp is OTP-only — there is NO order-event → user WhatsApp notification path (`sendWhatsAppMessage` has exactly one production caller: `whatsapp-otp.service.ts:378`); order events notify the operator via Telegram.
- **Sentry:** backend `instrument.ts` first-import, idempotent init, release = 7-char `GIT_SHA` (`release-sha.ts`), `uncaughtException`/`unhandledRejection` flush handlers (`instrument.ts:34-63`); source maps uploaded via `sentry-cli` in `build.mjs:216-228` when `SENTRY_AUTH_TOKEN`+org+project; frontend `sentryVitePlugin` release-matched to `VITE_RELEASE_SHA` slice-7 with `filesToDeleteAfterUpload` + `sourcemapGuardPlugin` backstop (`vite.config.ts:1143-1173`); no-token builds fail on produced maps. B-3 (ErrorBoundary `.catch`) — verified by another lane, noted only.
- **Clock/timezone:** every wall-clock cron slot passes `timezone: "UTC"` explicitly (cron.ts:36-37 + each schedule) and the image pins `TZ=UTC` (Dockerfile:204); operator-facing timestamps pin `Africa/Tripoli` (telegram.ts:655, couponWatcher.ts:105, stats.ts fixed UTC+2 note); OTP daily cap resets at the UTC day boundary by documented design. The single exception is **L14-5**.
- **Embronic (provider sync):** design parked at `docs/pending/embronic-adapter-design.md`; zero code, zero scheduler — nothing to audit yet (status "pending" confirmed).
- **Test evidence at HEAD:** jobs suite 36 files/281 tests green; scheduler coordinator/demotion/single-instance 33/33 green; telegram-dispatch-retry 7/7 green. (Suite totals consistent with the R142 baseline of 2,458 backend tests.)

**Verdict:** no P0/P1/P2. The jobs/integrations layer remains structurally sound — the R142 L-1/L-3 fixes are real and green, L-2's code is real but its test was never landed despite the wave report's claim. The four actionable items are one-line-to-ten-line fixes: the missing opportunistic test (L14-1), one Sentry capture in `checkAdminTotpAdvisory` (L14-2), the Render→Coolify alert copy (L14-3), and the coupon-expiry timezone option (L14-5); L14-4 is the only structural (still lean) improvement.
