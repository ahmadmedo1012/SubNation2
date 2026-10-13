# Lane L — Integration & Reliability Audit (R142, Task 142-L1)

**Repo:** SubNation2 @ `a9f5e83` (tree clean; only `docs/engineering/` untracked reports).
**Scope:** 70-file inventory — `backend/src/jobs/**` (19 job modules + 36 co-located tests), `notify.ts`, `telegram.ts`, `worker.ts` + `worker/heartbeat.ts`, socket lib files, telegram/whatsapp lib files — plus cross-cut reads of the OpenWA bridge client, the topup service emit path, the web scheduler, the opportunistic throttle, and the frontend socket hook.
**Load assumed:** single-instance Coolify deployment (embedded web leader, `SINGLE_INSTANCE_MODE` shape, no Redis in the live healthz shape, Neon free tier that sleeps). The dedicated-worker topology is dormant code kept deployable.

**Verification runs:** the full lane suite re-executed at HEAD — 41 files, **344 tests, all green** (jobs/ + the 5 socket/telegram/whatsapp lib suites).

---

## What this lane does

The jobs layer is a **cron + boot-one-shot + opportunistic (traffic-triggered) scheduler** with **no job persistence, no queue, no automatic retry-with-backoff at the job level**. Every job is an idempotent, batched DB operation; a failure is caught per-job, tagged to Sentry (`captureSchedulerFailure`, `subsystem=scheduler`), and the *retry* is one of three documented kinds: next cron slot (10 jobs), next throttled traffic trigger or next boot (5 jobs), next boot/deploy (2 jobs — orphan-inventory-report, reencrypt). That per-kind retry truth is itself pinned by tests (`boot-one-shot-failure-capture`, `cron-registration`). This is a deliberate architecture, not an accident: the free-tier economics round (2026-09-20) removed every sub-hourly timer, and idempotency + boot catch-up replaced durable scheduling. For this load it is sound: **no double-execute path exists that matters** — leader election stops demoted instances, all mutations re-apply their own predicates, and the one deliberate lock-free window (batched alert writes during a leader handover) is documented with its bounded worst case (one duplicate drawer row).

The three integrations under audit are each bounded: Telegram (5s timeout, one retry, transient-only), OpenWA (8s timeout on every gateway call, 3-attempt send retry on 5xx/409/network only), Socket.IO (server-driven rooms from DB-liveness-verified identity, 5-min re-verify, connection caps). **The r140 topup live-event invalidation fix is verified present end-to-end** (backend `topup.service.ts:203,635,702` post-tx emits → `use-socket.ts:111-133` invalidates `me`/`ledger`/`wallet`/`topups` → `money-races-r140.test.ts` pins key alignment + dedupe).

The single most valuable fix below is **L-1** (the Telegram dispatch retry contract has no failing test — the one retry pipeline in this lane that is completely untested).

---

## Findings

### L-1 (P3 — Missing test) Telegram dispatch retry/reliability pipeline has zero failing tests
**`backend/src/telegram.ts:391-501`** (`dispatchWithDetails`)

- **What this is:** The module's own header (lines 9-31) documents a reliability contract: 5s `AbortSignal.timeout`, HTTP-status **and** body-`ok` inspection (Telegram answers 200 with `ok:false`), one retry on transient only (5xx / 429 / network), `retry_after` honoured but clamped to 5s, permanent failure → Sentry capture.
- **Problem (concrete case):** The only tests that exercise this code path are `routes/__tests__/wallet-topups-telegram-card.test.ts` and the three `telegram-webhook*` suites — every one mocks `globalThis.fetch` to return `{ok:true}` status 200 (verified at `wallet-topups-telegram-card.test.ts:129-137`). If someone drops the `body?.ok` check (the exact live bug the R98-A6/F5 comment records happened in `alerting.service.ts`), inverts the transient classification (making 429 permanent → every flood-wait becomes a captured error, or 500 permanent → zero retries during a Telegram blip), or removes the timeout, **CI stays green**. Meanwhile the sibling retry pipeline (OpenWA `sendTextWithRetry`) *is* fully tested with a scriptable 500-responder, backoff timers and attempt counting (`openwa.service.test.ts:190-230`).
- **Fix:** One test file mocking `globalThis.fetch` with a scriptable responder, pinning: (a) `200 ok:false` → failure, no retry; (b) 500 then 200 → ok on attempt 2; (c) aborted fetch then 200 → ok on attempt 2; (d) `parameters.retry_after: 99` → retry waits 5s (clamped); (e) env unset → `skip`, zero fetches. ~80 lines, mirrors the OpenWA suite's fake-timer scaffold.
- **If we skip it:** the operator-notification channel (new order, new topup, approve/reject cards — the money-review workflow) can silently lose its retry/timeout behavior with no CI signal.

### L-2 (P3 — Missing test + Risk) `fireThrottledMaintenance` is untested and a hung run disables the job until restart
**`backend/src/lib/opportunistic.ts:69-99`**

- **What this is:** The throttle powering all five opportunistic jobs (stock-sweep 10 min, coupon-sweep 15 min, flash-sale 10 min, whatsapp-otp-prune 60 min, copilot-reaper 60 min). Guarantees promised in the header: fire-and-forget, per-key throttle from run START, re-entry guard, never throws.
- **Problem (concrete cases):** (1) **Zero direct tests** — the only repo reference in a test is a comment (`routes/__tests__/coupons-validate.test.ts:44`). A regression in the re-entry guard or the throttle window passes CI silently. (2) The re-entry guard has **no escape for a hung body**: `inFlight` is cleared only in `finally` (line 94). If `fn()` ever returns a promise that never settles — the exact failure class `worker/heartbeat.ts:13-16` documents for Redis offline queues — the key stays in-flight *forever* and the job never runs again in that process, with **no log line** (the `inFlight` early-return at line 78 is silent). Today every throttled body is DB work that the pool/statement timeouts bound, so this is a latent, not live, hazard — but the same was true of the heartbeat SETEX before R2 fixed it.
- **Fix:** (a) one small test file: first call runs, second inside the window is a no-op, a failed run still throttles, a thrown body never rejects to the caller, re-entry during flight is skipped. (b) one line: log at debug when a call is skipped because a previous run is still in flight. (Do not add a timer bound without a real case — the DB already bounds these bodies.)
- **If we skip it:** the free-tier design's *only* recurring trigger for five retention/sweep jobs rests on ~30 lines of untested stateful logic.

### L-3 (P3 — Risk/observability) Two opportunistic jobs fail log-only when triggered from traffic — invisible to Sentry
**`backend/src/lib/opportunistic.ts:84-95`** (the catch), **`backend/src/services/whatsapp-otp.service.ts:833-859`** (`pruneExpiredOtps`), **`backend/src/jobs/copilot-reaper.ts:34-67`** (`reapExpiredCopilotPreviews`)

- **What this is:** R127-L3 fixed the *boot one-shot* chain to Sentry-capture every failure (pinned by `boot-one-shot-failure-capture.test.ts`). The cron slots were already per-job captured.
- **Problem (concrete case):** `pruneExpiredOtps` and `reapExpiredCopilotPreviews` have **no internal `captureSchedulerFailure`** (unlike `stockWatcher.ts:120`, `couponWatcher.ts:157`, `flashSaleWatcher.ts:78`, which each capture their own failures). Their *only recurring* trigger is `fireThrottledMaintenance` — whose catch is warn-log-only (`opportunistic.ts:87-91`). Case: a slow-growing DB permission error makes `pruneExpiredOtps` throw on every throttled fire for three weeks on a sleeping instance with no deploy — the boot one-shot never fires, Sentry never sees it, the operator sees nothing; `whatsapp_otps` and `copilot_previews` grow unpruned until the next deploy. The same job failing via the boot path *would* be captured — an observability asymmetry inside one contract.
- **Fix:** one line each — add `captureSchedulerFailure("whatsapp_otp_prune", err, { trigger: "opportunistic" })` / `("copilot_reaper", …)` inside those two functions' own try/catch (or lift the catch in `opportunistic.ts` to capture under the job key). Matches the exact pattern their three sibling watchers already use.
- **If we skip it:** two retention jobs can fail forever with only pino warn lines as evidence.

### L-4 (P4 — Lean/reuse) `alerting.service.ts` re-implements the Telegram send contract divergently from `telegram.ts`
**`backend/src/services/alerting.service.ts:755-800`** vs **`backend/src/telegram.ts:391-501`**

- **What this is:** Two independent Telegram senders reading the same `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`: the business-notification client (this lane) and the SRE alert engine.
- **Problem:** Divergent behavior for the same wire: `telegram.ts` has retry + `retry_after` + `telegram_sends_total` metrics + Arabic operator hints; `alerting.service.ts` has none of those (its own timeout constant, its own `ok:false` check added in F5 — a fix that had to be made *twice* because the contract was duplicated; its own comment at lines 767-775 says exactly this). A future Telegram behavior change must be caught in two places; history shows one was missed once already.
- **Fix (smallest):** have `sendChannel("telegram")` call a tiny shared helper in `telegram.ts` (message text stays per-caller). Alternative minimum: a cross-reference comment in both headers naming the twin. Don't merge the modules — different failure semantics (alert engine wants throw-to-retry; business client wants best-effort).
- **If we skip it:** the next Telegram API quirk gets fixed in one sender and not the other, again.

### L-5 (P4 — Missing test + Risk) The dedicated-worker entry (`worker.ts`) has no direct tests, and its double-run guard is warn-only
**`backend/src/worker.ts:82-205`**

- **What this is:** The `DISABLE_WEB_SCHEDULERS=true` migration target — degraded Redis boot, 30s heartbeat recovery poll, R101 one-shot parity, 10s force-exit drain.
- **Problem (concrete cases):** (1) No test file imports `worker.ts` / `installWorkerSignalHandlers` — the web-scheduler twin of the recovery poll *is* tested (`web-scheduler-single-instance`/`demotion`), so a drain-order regression (schedulers must stop before the pool ends, the R8 fix) would surface only on an actual worker deploy. (2) The `SINGLE_INSTANCE_MODE=true` + worker combination double-runs every cron/alert/one-shot; the guard (lines 90-96) is a log line only — intentional operator escape hatch, documented, and materially harmless because every job is idempotent — but it is the *only* barrier and lives in deploy logs nobody reads on Coolify.
- **Fix:** one test for `installWorkerSignalHandlers` (stop→drain→exit order, force-exit timer, `dispose()`), reusing the exported injectable `exit` seam that already exists for exactly this purpose (comment lines 27-33). Leave the warn-only guard as designed.
- **If we skip it:** the documented worker migration path ships untested; today it is dormant code.

### L-6 (P4 — Risk, dormant) Socket.IO Redis adapter clients are never closed on drain
**`backend/src/lib/socket.ts:180-190`**

- **What this is:** When `REDIS_URL` is set, `initSocket` creates `pubClient`/`subClient` and attaches the Redis adapter.
- **Problem (concrete case):** No stop handle closes them — the graceful drain (web `stopWebSchedulers` → pool.end → Sentry.close) leaves the two Redis connections open until the 10s force-exit kills the process. Harmless in the current production shape (adapter never configured — `REDIS_URL` unset), but in a future Redis topology the drain sequence is incomplete on its own terms.
- **Fix:** return the existing `io` with a `closeAdapter()` that quits both clients, called from the server drain path — ~6 lines, only exercised when the adapter exists.
- **If we skip it:** nothing today; a one-line gap in a future topology.

### L-7 (P4 — Bug, type-truth) `topup-updated` payload carries `amount` as a runtime string typed as `number` on the client
**`backend/src/services/topup.service.ts:638,705`** → **`frontend/src/hooks/use-socket.ts:106`**

- **What this is:** The approve/reject emits pass `amount: topup.amount` — drizzle returns `numeric` as a **string**; the automated path (line 206) passes a number. The client handler types the payload `amount: number`.
- **Problem (concrete case):** `formatCurrency` coerces, so today's toast renders correctly — but the payload's runtime type disagrees with both the handler's type and the sibling emit site. The next maintainer who does `data.amount * 2` or `toFixed` on it gets string-concatenation semantics on the approve/reject events only (the automated event behaves differently), a genuinely confusing bug class.
- **Fix:** `amount: parseFloat(String(topup.amount))` at the two emit sites (approve/reject) — matches the automated path and the `formatLyd(parseFloat(...))` idiom used 3 lines earlier in the same file.
- **If we skip it:** a latent type lie on a money-event payload; display stays correct.

---

## Verified-OK (charter checklist, evidence)

1. **r140 fix present end-to-end.** `TopupService.approve` emits `topup-updated` **after** the transaction commits (`topup.service.ts:635-640`), reject at `:702-706`, automated at `:203-207`; `use-socket.ts:111-133` invalidates `getListTopups` + `getGetWallet` + `getGetMe` + `getGetWalletLedger` using the generated key functions; `money-races-r140.test.ts:518-600` pins key alignment + double-fire dedupe; `use-socket-topup-dedupe.test.tsx` pins toast dedupe by topup id. The 3s `TopupWaitingModal` foreground poll is the fallback; the socket is page-scoped (`wallet.tsx:86`).
2. **Socket auth/room scoping.** Handshake: per-IP cap pre-check → origin allowlist (R107 Origin-less Host rule) → JWT verify (2FA temp token rejected, SEC-92-02) → **DB liveness probe** (`isSessionRowLive` 60s-cached, ownership-checked B1-4; admin `admin_sessions` + `is_active`) — the exact probe `requireUser` uses. Rooms are **server-driven from verified identity** (`socket.ts:328`); a forged `join-user` payload is a logged no-op (`authorizeJoinUser` strict equality). A user cannot subscribe to another user's channel — no client input influences room membership. Mid-session: 5-min re-verify strips revoked components / hard-disconnects dead identities / reconciles the scope-gated alert room (R127-B6-1 dead-code fix verified present at `socket/auth.ts:481-487`, tested).
3. **Reconnect behavior.** Client: 10 attempts max, backoff capped 10s (free-tier economics), identity-switch teardown, zombie-socket dispose generation, one resync event per real disconnect invalidating the money query families. Server: explicit ping 25s / timeout 20s / connect 30s, 64KB payload cap.
4. **Event payload trust/XSS.** All client consumers render event data through React text nodes (`toast`, `statusLabel`, `formatCurrency`); zero `dangerouslySetInnerHTML` anywhere (lanes H/J cross-confirmed). Server payloads are server-generated IDs/amounts/status enums.
5. **Telegram login + webhook.** Webhook: timing-safe secret compare, `TELEGRAM_ADMIN_IDS` allowlist before any money action, stale-button keyboard stripping, `editMessageText` without `parse_mode` (no markdown injection from `cq.message.text` + actor tag), audit row written (B11-F1), money path reuses `TopupService.approve/reject` with the full guard battery, always-200 ack so Telegram doesn't re-post. A Telegram outage does **not** break any money flow — the admin UI path is independent, and every `notify*` is fire-and-forget with skip-when-unconfigured. Replay protection: TTL ≥ freshness pinned (widget 35 min / webapp 25 h), bounded in-memory fallback when Redis is absent.
6. **Message injection into Telegram HTML.** Every user-influenced field is `escapeHtml`'d (phone, product name, coupon code, payment reference, order code, timestamp). The one unescaped interpolation — `providerLabel(input.provider)` in `notifyNewUser`/`notifyNewOrder` — traces only to the DB `auth_provider` column, which is written exclusively by backend auth flows (Google/Telegram/WhatsApp/email constants), never client input. No concrete injection case exists; noted for completeness only.
7. **OpenWA contract.** Every gateway call goes through `gatewayFetch` with an 8s `AbortSignal.timeout` and `X-API-Key`; send retries 3× on 5xx/409/network only (4xx never), re-resolving the session between attempts; LID preflight is fail-open (network) / fail-fast (`exists:false`); OTP send happens **before** row insert (a dead gateway leaves no throttling rows), insert retried once, `store_failed` → 500 + Retry-After + short cooldown; the honest reason taxonomy (`gateway_waking`/`whatsapp_settling`/`whatsapp_not_paired`/`recipient_not_on_whatsapp`) reaches the UI as 503/429 + Retry-After which the frontend auto-retries. **One-gateway-per-credential is structural:** a single `WHATSAPP_OTP_BASE_URL`+`_API_KEY`+`_SESSION` env triple is the only configuration surface; no code path can address a second gateway, and the channel watch is single-session by design (R97-WA-11). The settle/warm gate is pairing-epoch-scoped (re-pair re-arms it; routine restores adopt the Neon marker — R104/AG4-2), so a wake after sleep does *not* pay the 45s ceremony again.
8. **G-1 class hunt (raw un-timed fetch in integrations): CLEAN.** Every outbound HTTP site in `backend/src` is bounded: `telegram.ts` (5s), `telegram-gateway.ts` (10s), `telegram-webhook.ts` `/start` reply (10s, the F2 fix), `openwa/gateway-client.ts` (8s), `alerting.service.ts` (`HTTP_TIMEOUT_MS`), copilot `llm-client`/`admin-request-tool` (AbortController timers). The G-1 loyalty-timeout pattern exists only on the frontend money-fetch (open, lane G).
9. **Double-execution hunt.** Jobs are in-process callbacks — a restart mid-job abandons the work (no partial state: money mutations are transactional and live in routes/services, not jobs); re-entry comes from idempotent one-shots at next boot (pinned no-op re-runs in every retention suite). The dual-leader drain window's one lock-free write (batched alerts) is a documented trade with a collapse path (`resolveAlertsByDedupeKey`). `logAdminAlert` (single form) keeps the advisory-xact-lock serialization. The webhook's money path is guarded by the status-flip WHERE + advisory lock + partial unique index (verified in the source read; pinned by the topup suites lane G owns).
10. **Event-loop blocking hunt: none.** All job bodies are async DB calls; DELETEs are ctid-batched at 1000 rows/statement; reencrypt caps at 5000 rows/column/boot with µs-scale GCM ops; the heaviest jobs (forecast/enrichment) are `WORKER_TIER`-gated and dormant in production.

---

## Job inventory (trigger / retry / idempotency / test)

| Job | Trigger(s) | On failure | Re-entry safety | Test |
|---|---|---|---|---|
| admin-alert retention (`markStaleUnreadAlertsRead`/`pruneReadAlerts`) | cron 00:00 + boot one-shot | per-job catch → Sentry `admin_alert_retention` | age-predicated UPDATE / batched DELETE | alert-hygiene, retention-batching |
| idempotency-keys retention | cron 00:00 + boot | Sentry `idempotency_keys_retention` | 48h cutoff, batched | idempotency-retention (order-row preservation pinned) |
| TOTP advisory | cron 00:05 + boot | Sentry `totp_advisory` | 7-day dedupe key + auto-resolve | alert-hygiene |
| session prune (user+admin+notif+login-attempts+audit-logs) | cron 05:00 + boot | **five independent catches**, each own Sentry tag (R110-H) | expired-only predicates, batched | cron-registration (isolation pinned), retention-batching |
| risk retention | cron 03:30 + boot | Sentry `risk_retention` | predicates per batch; orphan grace 30d | risk-retention |
| forecast runner | cron 02:15, `WORKER_TIER` gate (dormant) | Sentry `forecast_runner` | run-store rows; abandoned reap | (service suites, lane-adjacent) |
| forecast retention | cron 03:35, gated | Sentry `forecast_retention` | in_flight>24h → failure `abandoned` | (service suites) |
| enrichment runner / retention | cron 03:50 / 04:00, gated | Sentry tags | same abandoned-reap shape | (service suites) |
| auth-activity retention | cron 04:30 + boot | Sentry `auth_activity_retention` | 90d cutoff, batched | retention-batching (1010-row loop) |
| stock sweep | opportunistic 10min (purchase/refund/admin write) + boot | **internal** `captureSchedulerFailure("stock_watcher")` | in-mem Sets + DB dedupe keys (restart-safe) | stock-notify-gate (cold-restart + flap pinned) |
| coupon sweep | opportunistic 15min (validate) / 1min (admin list) + boot | internal capture | UPDATE re-applies own predicate; dedupe keys | coupon-watcher-gate, retention-batching |
| flash-sale sweep | opportunistic 10min (public read) / 1min (admin) + boot | internal capture | predicate-reapplying UPDATE; 7d dedupe | flash-sale-watcher (catalog convergence pinned) |
| orphan-inventory report | **boot-only** | boot-chain capture (R127-L3) | 24h dedupe; never deletes | orphan-inventory-report (no-delete pinned) |
| copilot reaper | opportunistic 60min (admin surface) + boot | ⚠️ log-only on traffic path (**L-3**) | predicate per batch | (wiring pins only) |
| whatsapp-otp prune | opportunistic 60min (`startOtp`) + boot | ⚠️ log-only on traffic path (**L-3**) | `expires_at`-indexed, superset window, batched | whatsapp-otp-prune-batching (service suite) |
| reencrypt v1→v2 (+mid-rotation v2) | **boot-only**, last in chain | boot-chain capture | optimistic WHERE + v2-scan idempotence + 5000-row cap | reencrypt-v1-credentials (10 cases incl. races) |
| worker heartbeat | 15s interval (worker / web leader) | isolate() reports + swallows (R7 true) | idempotent SETEX; Redis-cmd timeout bounds pileup | web-scheduler suites |
| alerting evaluator | 60s interval | rule-engine fail-safe (no-Redis → no alerts) | in-memory counters | alerting.service.test, alerting-reliability |

---

## Integration failure-mode table (what happens when it's DOWN)

| Integration / failure | Surface behavior | Degrades or hangs? | Recovery |
|---|---|---|---|
| **Telegram API 5xx/timeout** | `notify*` retries once → permanent failure logged + Sentry; callers never await-throw | **Degrades** — money flows untouched (approve path continues; webhook edit/answer best-effort 10s-bounded) | next event re-sends |
| **Telegram 429 flood-wait** | retry_after clamped to 5s, one retry, else captured | Degrades | operator fixes flood source |
| **Telegram webhook secret unset** | 503 (fail-closed) until configured | Degrades (admin UI approval path unaffected) | operator |
| **OpenWA gateway DOWN (NAT/timeout)** | `request_failed` → 3 send attempts (~30s incl. backoff) → `gateway_waking` → route 503 + Retry-After 30 → **frontend auto-retry rides the wake** | Degrades (bounded — never hangs: 8s cap per call, 20s settle-wait cap) | cold-start gate + 503 "starting" flow |
| **OpenWA session not paired** | honest `whatsapp_not_paired` (503) — distinct from disabled; channel watch alerts after 15 min | Degrades | operator re-pairs via dashboard (operator-only; out of lane scope) |
| **OpenWA freshly re-paired** | settle gate (45s) + warm-up self-check re-arm; first OTP rides the window in-request | Degrades (bounded) | epoch-scoped gate auto-clears |
| **OTP row insert fails after message delivered** | `store_failed` → 500 + Retry-After 30 + client cooldown (no second WhatsApp message) | Degrades | retry after 30s; daily-cap already counted (correct accounting) |
| **Socket.IO server down / deploy** | client: 10 reconnect attempts then parks; visibility revival; **one resync invalidation** of orders/wallet/topups/me on reconnect | Degrades (poll fallbacks: bell 60s, waiting modal 3s) | SessionActivityManager revive |
| **Session revoked mid-socket** | 5-min re-verify (or next join event) strips room / hard-disconnects | Correct enforcement | client re-handshakes |
| **Redis absent (live shape)** | schedulers elect via PG lease (97-F1); replay store → bounded in-memory; heartbeat dark + 30s recovery poll; socket adapter skipped | Degrades | documented single-instance posture |
| **Redis down at worker boot** | worker boots DEGRADED (B7-P1-7 — no crash loop), alerting fail-safe, cron+one-shots run | Degrades | singleton auto-reconnect re-attaches heartbeat |
| **DB down** | every cron/boot job captured per-tag; alert inserts retry next cycle with 1/hour side-channel throttle (F9); watchers' Telegram gated on dedupe outcome; money routes are transactional (out of lane) | Degrades | boot one-shots catch up (B7-P2-12) |
| **Sentry down** | captures are best-effort fire-and-forget; logs remain the floor | Degrades | n/a |

---

## Missing-test census (charter item 7 — the answer)

Tested retry/re-entry behavior: boot-chain per-kind retry truth, cron-slot failure isolation, OpenWA send retry (attempts+backoff+re-resolve), OTP insert retry + consume race, logAdminAlert dedupe under restart/flap/DB-outage, reencrypt optimistic-WHERE races, socket revocation/scope eviction, Telegram replay TTL+fallback, retention batch boundaries (1010 rows), heartbeat error isolation.
**Untested:** Telegram dispatch retry (L-1); opportunistic throttle semantics incl. the unbounded in-flight guard (L-2); worker entry drain order (L-5). Those three are the whole gap.

## Not checked
`services/alerting.service.ts` beyond the send-channel range (1-754: the rule engine — its own two suites exist and pass); `services/forecast/*` and `services/enrichment/*` internals (dormant `WORKER_TIER` features; runners' gates read, engines not); the OpenWA gateway image internals (`ghcr.io/ahmadmedo1012/openwa` is external — its Swagger contract was verified against the client only); live runtime behavior (static truth only; no live traffic was generated); frontend socket-resync consumers beyond `use-socket`/`wallet.tsx` (SessionActivityManager internals are lane G/J territory). Operator-only surfaces (pairing, Coolify secrets) deliberately untouched per lane rules.

**Verdict:** the jobs/integrations layer is **healthy and unusually well-documented** — no P0/P1/P2. The architecture trade (no durable queue; idempotency + boot catch-up + honest per-kind retry) is internally consistent and heavily pinned by tests. Fix L-1 first (one test file restores the only untested retry contract), then the two one-line Sentry captures in L-3; L-2's test file second. **Lean: −0 dependencies, ~40 lines of test additions possible; no deletions proposed** (the alerting/telegram duplication in L-4 is a comment-level cross-reference or a 10-line helper at most).
