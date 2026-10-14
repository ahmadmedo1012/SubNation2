# R146 fix notes — backend services / jobs / worker / lib (agent 146-FIX-2)

Implements findings 1–5 of `docs/engineering/R146/audit-backend-services.md`
(ponytail ruleset per repo-root AGENTS.md: smallest complete change, no new
abstractions, every risky fix leaves a test that fails when it breaks).
All commands run from the repo root against the combined in-flight tree
(four other fix lanes were mid-work; only this lane's files were touched —
see "Out-of-lane needs" for the one item that is not mine to change).

Lane: `backend/src/services/**`, `backend/src/jobs/**`,
`backend/src/worker.ts`, `backend/src/lib/**`, their tests
(`backend/tests/worker-*.test.ts` included — they test `src/worker.ts`).

## Finding 1 — five unbounded Redis writes in the risk pipeline

- **Changed** (all one-liners, wrapping the existing call exactly like the
  bounded GET at risk-config-cache.service.ts:75; healthy path unchanged):
  - `backend/src/services/risk-config-cache.service.ts`
    - :121 → `withRedisCommandTimeout("risk_config_set", …)` (cache
      populate SET after the DB read succeeded);
    - :150/:151 → `withRedisCommandTimeout("risk_config_del", …)` +
      `"risk_config_publish"` (admin PUT invalidate);
    - :165/:166 → `withRedisCommandTimeout("risk_config_sub_connect", …)`
      (subscriber `connect()` — ran BEFORE the GET on every
      `getRiskConfig`, so it stalled the whole pipeline first).
  - `backend/src/services/risk-scoring.service.ts` :265 →
    `withRedisCommandTimeout("risk_pipeline_degraded_set", …)` (dynamic
    import now also pulls `withRedisCommandTimeout`).
- **Test evidence** (new
  `backend/src/services/__tests__/risk-redis-bounded.test.ts`):
  `pnpm --filter @workspace/api-server exec vitest run src/services/__tests__/risk-redis-bounded.test.ts`
  → **1 file / 3 tests passed**. The fake client is a
  ready-but-black-holed socket (every command + `duplicate().connect()`
  never settles); the REAL `withRedisCommandTimeout` (kept via
  `importOriginal`) must convert each hang into a rejection the existing
  catch blocks swallow:
  1. `getRiskConfig` settles and auto-seeds defaults (bounded connect +
     get + set);
  2. `invalidateRiskConfig` settles (bounded del + publish);
  3. `scoreEvent` settles when the degraded-flag SET black-holes
     (missing `risk_events` table forces the persist-failure path →
     `markPipelineDegraded`).
- **Break-the-fix check:** reverting only the risk-scoring wrap (raw
  `await redis.set` restored) makes case 3 hang → vitest timeout FAIL
  (verified locally, then restored).

## Finding 2 — concurrent coupon exhaustion never fires the "maxed" signal

- **Changed** (`backend/src/services/checkout.service.ts` :646): the
  signal now reads `updatedCoupon.usedCount >= appliedCoupon.maxUses` —
  the guarded UPDATE's RETURNing row (true post-increment value) — instead
  of `newUsedCount = appliedCoupon.usedCount + 1` computed from the
  PRE-transaction read. The dead `newUsedCount` local was deleted.
  Money safety is untouched (the guarded UPDATE stays the authority);
  only the operator-facing signal was being lost.
- **Test evidence** (extended
  `backend/src/services/__tests__/checkout-coupon-maxed-postcommit.test.ts`):
  new describe "R146 F2": maxUses=2, usedCount read as 0 pre-tx; the
  interleave harness (`interleaveWriterAfterSelect`, armed on the product
  freshness select) commits a concurrent 0→1 increment inside the
  read→write window; our guarded UPDATE takes the row to 2.
  `pnpm --filter @workspace/api-server exec vitest run src/services/__tests__/checkout-coupon-maxed-postcommit.test.ts`
  → **1 file / 3 tests passed** (2 pre-existing + 1 new; asserts
  `result.ok`, DB `usedCount === 2`, and the `coupon_maxed` admin alert
  exists).
- **Break-the-fix check:** restoring `appliedCoupon.usedCount + 1 >=`
  makes the new test FAIL (1 failed / 2 passed — verified, then restored).

## Finding 3 — Telegram/Firebase first-login double-submit → raw 23505 → 500

- **Changed** (mirror of the WhatsApp F6 class; ~10 lines each + a
  module-local 4-line `isUniqueViolation` per file, same two-level
  DrizzleQueryError.cause traversal as topup's B2-02 helper):
  - `backend/src/services/telegram-auth-flow.ts`
    (`findOrCreateTelegramUser`): the INSERT transaction is wrapped in
    try/catch — on 23505 re-read by `telegram_id`, refresh the identity
    row (the existing-user branch's upsert, now the shared
    `refreshTelegramIdentity` helper — pure move of the previous inline
    block, zero behavior change for the existing path), and return the
    winner's row as a normal login (`isNewUser: false`). If the re-read
    finds nothing (an unrelated unique violation), the original error is
    rethrown — error handling preserved.
  - `backend/src/services/firebase-auth.service.ts` (step-4 create):
    same wrap — on 23505 re-read by `firebase_uid`, return
    `{ user: winner, isNewUser: false, provider }`; otherwise rethrow.
    The winner's own request performs the identity upsert + referral
    event right after its commit.
  - **Secondary effect (replay hash)**: resolved by the primary fix for
    the audit's named case — the loser no longer throws, so its
    pre-claimed replay hash is consumed by a successful login instead of
    being stranded. Residual (not fixed, smallest-complete decision): a
    non-23505 throw between claim and find-or-create (e.g. a DB blip)
    still leaves that ONE payload's hash claimed until TTL — but a client
    retry regenerates the payload (fresh hash) and the freshness window
    bounds exposure; no release/re-claim hook was added for that
    speculative edge.
- **Test evidence** (two new files, both using the F6 idiom —
  `db.select` interleave delivering stale rows after the winner's INSERT
  commits):
  - `src/services/__tests__/telegram-auth-double-submit.test.ts` — arms
    findOrCreate's telegram_id lookup (first unprojected select) via
    `handleTelegramWebAppAuth` with a real signed initData; asserts
    `ok: true`, `isNewUser: false`, exactly ONE user row, and the
    telegram.org identity row refreshed.
  - `src/services/__tests__/firebase-auth-double-submit.test.ts` — arms
    `findLinkCandidates`' identity lookup (the LAST select before the
    INSERT, matched by its `{ userId }` projection) via
    `resolveFirebaseSession` with a fixed decoded Google token; asserts
    `isNewUser: false`, `user.firebaseUid` = the winner's, exactly ONE
    user row.
  - `pnpm --filter @workspace/api-server exec vitest run src/services/__tests__/telegram-auth-double-submit.test.ts src/services/__tests__/firebase-auth-double-submit.test.ts`
    → **2 files / 2 tests passed**.
- **Break-the-fix check:** disabling the catch (`if (!false) throw err`)
  makes BOTH tests FAIL (2 failed — verified, then restored).

## Finding 4 — dedicated-worker topology silently killed five HTTP/auth alerting rules

- **Changed** (keep rule evaluation where its signals live):
  - `backend/src/worker.ts`: removed `alertingService.start()` (+ its
    import and the `stop()` in the shutdown drain — dead code once the
    evaluator never starts). A why-comment names the limit: the evaluator's
    signals increment only in the WEB process's per-process prom-client
    registry. Also fixed two now-stale log/comment mentions ("alerting"
    no longer runs in the worker).
  - `backend/src/lib/web-scheduler.ts`: the `DISABLE_WEB_SCHEDULERS=true`
    branch now STILL starts the alerting evaluator (previously it returned
    early before `startLeaderJobs`, so the documented
    dedicated-worker topology had NO evaluator on the web side either —
    the only one lived in the worker, where the metrics never appear).
    The branch's returned `stop` now stops it. The evaluator keeps riding
    `startLeaderJobs()` in every other shape (single-instance today:
    verified — `web-scheduler-single-instance.test.ts` line 161 already
    pins `alertingService.start` called once). Module-header and
    migration-doc comments updated to the new contract, plus the required
    `shortcut:` comment: *per-process metrics — worker-side
    redis_errors_total / neon_pool_errors_total deltas and multi-web
    duplicate dispatches (deduped via Redis when present) are the cost;
    move the signals to Redis counters when a dedicated worker must own
    alerting.*
- **Test evidence:**
  - Pins updated (deliberate, tested change — rationale comment in each):
    - `web-scheduler-single-instance.test.ts` "DISABLE_WEB_SCHEDULERS=true
      WINS … — except the alerting evaluator": `alertingService.start`
      now expected **called once** (was: not called); added
      `handle.stop()` → `alertingService.stop` once.
    - `web-scheduler-demotion.test.ts` "DISABLE_WEB_SCHEDULERS=true skips
      heartbeat/cron but KEEPS the alerting evaluator (R146 F4)": same
      flip + stop pin.
  - New `backend/tests/worker-alerting-topology.test.ts` (source-contract,
    same technique as `rate-limits-intent.test.ts` — `startWorker` is
    main-module-guarded and boots Redis/cron, untestable otherwise):
    worker.ts must not import `services/alerting.service` nor call
    `alertingService.start/stop`.
  - `pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/web-scheduler-single-instance.test.ts src/lib/__tests__/web-scheduler-demotion.test.ts tests/worker-alerting-topology.test.ts tests/worker-sigterm.test.ts`
    → **4 files / 25 tests passed**.

## Finding 5 — ledger.ts false "NO writer" comment

- **Changed** (`backend/src/lib/ledger.ts` :57-66, comment-only): the
  note now says the dead `insertReferralSignupLedger` helper was deleted,
  and the `referral_credit` type literal STAYS because the welcome-bonus
  grant in topup.service.ts still writes it with
  `reference_type='welcome_bonus'`. Zero code change; no test needed
  (trivial).

## Regression battery (all from repo root, all green)

- `pnpm --filter @workspace/api-server exec vitest run src/services/__tests__/risk-scoring.test.ts src/services/__tests__/checkout.test.ts src/services/__tests__/checkout-coupon-fastfail.test.ts src/services/__tests__/checkout-idempotency.test.ts src/services/__tests__/checkout-claim-race.test.ts src/services/__tests__/refund-coupon-slot.test.ts`
  → **6 files / 36 tests** (risk trio + checkout money path).
- `pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/auth-firebase-session.test.ts src/routes/__tests__/auth-firebase-refresh.test.ts src/routes/__tests__/auth-firebase-verify-timeout.test.ts src/routes/__tests__/telegram-referral-gate.test.ts src/routes/__tests__/admin-risk-config.test.ts src/routes/__tests__/risk-hard-block.test.ts src/routes/__tests__/risk-soft-block-guard.test.ts`
  → **7 files / 52 tests** (route-level consumers of the changed
  services, including the parallel backend-api lane's in-flight edits).
- `pnpm --filter @workspace/api-server exec vitest run src/services/__tests__/firebase-auth.service.test.ts tests/scheduler-leadership-retry.test.ts tests/health-neon-fallback.test.ts`
  → **3 files / 13 tests**.
- `pnpm --filter @workspace/api-server exec vitest run src/jobs/__tests__/cron-registration.test.ts src/jobs/__tests__/alert-hygiene.test.ts src/jobs/__tests__/alert-db-failure-throttle.test.ts src/jobs/__tests__/alert-logger-batch.test.ts src/jobs/__tests__/boot-resilience.test.ts`
  → **5 files / 73 tests** (alerting/boot wiring).
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit`
  → clean.

## Out-of-lane needs

- **FINAL_MONITORING.md / OPERATIONS_RUNBOOK.md** (not this lane): both
  describe the alerting topology; FINAL_MONITORING.md still documents only
  the single-instance shape and the runbook's "alerting silence" row
  should eventually note that the evaluator lives in the WEB process in
  every topology (R146 F4). The code comments in worker.ts +
  web-scheduler.ts carry the truth until then.
- **routes/auth.ts (backend-api lane, in flight anyway)**: no change
  required by F3 — the loser now returns a normal login, so the route's
  existing success mapping (including that lane's new logAuthActivity
  rows) handles it; only the 500-on-registration-race arm becomes dead
  for this class.

## Lines delta

- Production source (8 files): **+214 / −93** — of which ~40 are the
  re-indentation of the two INSERT blocks now inside try/catch and ~55
  are why-comments; the semantic additions are the 5 one-line wraps (F1),
  the 1-line signal switch (F2), and ~2×14 lines of catch/re-read (F3).
- Tests: modified pins **+72 / −4**; new files **536 lines** (4 files).
