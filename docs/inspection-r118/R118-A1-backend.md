# R118-A1 — Backend deep audit (correctness / robustness / security-of-logic)

- **Scope**: `backend/src/**` exhaustive correctness + robustness sweep — money & fulfillment paths, R116/R117 new code, error handling, concurrency, input validation, dead code, jobs/cron. Test-quality and pure-performance are other agents' lanes.
- **HEAD**: `ef3d0c3` on `main` (verified: `git status --short` empty; `git log --oneline -1` → `ef3d0c3 docs(r117): …`). Baselines R117: 165 files / 1517 tests green, typecheck clean, lint 0 err / 89 warn, contracts 83/83.
- **Method**: full reads of the money-critical files (checkout.service, orders, wallet, topup.service, refund.service, adjustment.service, loyalty, points-ledger, ledger, idempotency (lib + middleware), pricing, pricing-config, money, numeric, manual.provider, whatsapp-otp.service, admin/orders, admin/topups, admin/users, health, cron, boot-one-shots, pg-leader-lease, opportunistic, alertLogger, notify, telegram, telegram-webhook, metrics, notifications, cart, coupons, support, auth/auth-whatsapp/auth-settings spot-reads); route-by-route body/params/query validation sweep (`rg req.body|req.query|req.params` over all 19 public + 24 admin route files); TODO/FIXME inventory; dead-export caller hunt; lock/advisory inventory (`rg pg_advisory|lockPool`); M1–M14 invariant re-verification against `docs/FINAL_MONEY_INVARIANTS.md` (note: the doc lives at `docs/FINAL_MONEY_INVARIANTS.md`, not `docs/operations/` as briefed). No repo source modified; no tests run (READ-ONLY mandate; R117-V1 already proved the suite at this tree).

## FINDINGS

### F-1 · Approve/reject topup 400s a contract-valid body without `admin_note` (null-conflation)
**[P2]** · File: `backend/src/routes/admin/topups.ts:40-44,138-140,177-179` · vs `shared/api-spec/openapi.yaml:5169-5173`

Evidence (`admin/topups.ts`):
```ts
function parseTopupActionBody(req: { body?: unknown }): string | null {
  const parse = TopupActionBody.safeParse(req.body ?? {});
  if (!parse.success) return null;          // invalid body → null
  return parse.data.admin_note ?? null;     // VALID body, absent optional → ALSO null
}
…
const adminNote = parseTopupActionBody(req);
if (adminNote === null)                     // conflates the two
  return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
```
`openapi.yaml` `AdminTopupActionBody` declares `admin_note` optional (`type: ["string","null"]`, no `required`), and the route's own zod schema (`.nullish()`, :34-38) agrees — but the handler rejects a `{}`/no-field body with 400 INVALID_DATA on **both** money-approval routes (`/topups/:id/approve` :139-140, `/topups/:id/reject` :178-179).

Impact: any contract-conforming client — the R116 copilot admin-request tool (its own security suite exercises `body: {}` for this exact path, `services/copilot/__tests__/admin-request-security.test.ts:160`), generated api-zod/api-client-react callers, or curl — gets a wrong 400 on a money route. Fail-closed (no wrong money movement; the frontend always sends a note, `frontend/src/pages/admin/topups.tsx:607,617,666,752`), so severity is functional/contract-truth, not money-safety.

Fix sketch: return a discriminated result from the parser — `{ok:false}` vs `{ok:true, note: string|null}` — and only 400 on `ok:false` (pass `null` note into `TopupService.approve/reject`, which already accept `string | null`). Alternatively make the note required in zod + openapi together. Effort: **S**.

### F-2 · FINAL_MONEY_INVARIANTS.md: M1 and M7 line cites stale at HEAD (invariant text still TRUE)
**[P3]** · File: `docs/FINAL_MONEY_INVARIANTS.md:12,18` (doc) vs `backend/src/services/topup.service.ts`, `refund.service.ts`

Evidence (doc, :12): M1 cites "`services/topup.service.ts:82-127` — in-tx re-check of topup status + UPDATE … WHERE walletBalance = balanceBefore". At HEAD, **82-127 is `createApprovedTopup`'s transaction** (tx opens :83; the automated-gateway path, which has no status re-check — it's a fresh insert). The described **manual-approval** guards live at: tx `topup.service.ts:254`, in-tx status re-check `:267-272`, wallet CAS `:407-421`, ledger `:424-436`.
Doc :18: M7 cites "`refund.service.ts (1 tx; :271 post-commit emission principle)`" — at HEAD :271 is `refundedByAdminId: adminId,` inside the tx; the events-after-commit principle text now sits at `:393-397` (tx spans :126-391). Also (known, R117-C1-flagged): the header still stamps "proven at HEAD `521234f`" (:4).

Impact: an auditor following the doc lands on the wrong method/line; the same drift class R117-C1 just fixed for M2/M3. The invariants THEMSELVES hold (verified — see VERIFIED-OK #1).

Fix sketch: M1 cite → `topup.service.ts:254-436` (re-check :267-272, CAS :407-421); M7 cite → `:126` (tx) + `:393-397` (post-commit principle); refresh the header stamp to the re-proof HEAD. Effort: **S** (docs-only).

### F-3 · Idempotency middleware ignores its own SET NX result — the in-flight 409 does not cover the concurrent-arrival window
**[P3]** · File: `backend/src/middlewares/idempotency.ts:224-236`

Evidence:
```ts
// Mark in-flight (best-effort) so a concurrent retry sees a clear signal.
try {
  await withRedisCommandTimeout("idempotency_inflight_set", () =>
    redis.set(cacheKey, IN_FLIGHT_SENTINEL, { EX: IN_FLIGHT_TTL_SECONDS, NX: true }),
  );
} catch (err) { … }
// result NOT inspected — falls through to next() unconditionally
```
Two same-key requests arriving within the same tick both miss the GET (:184), both run SET NX (one wins), and **both proceed to `next()`** — the loser never sees the 409 promised at :186-195. The header honestly says "best-effort", and every money route that mounts this middleware has a **durable** in-tx claim that catches the loser (checkout F10 `checkout.service.ts:610-612`; wallet `wallet.ts:515-533`; loyalty `loyalty.ts:235-248`; adjustment `adjustment.service.ts:237-255`; refunds are status-guarded in `RefundService` :264-276), so no double-charge is reachable — but the middleware-level promise is weaker than documented.

Impact: duplicate POST /api/orders double-executions are only stopped by the DB layer (which works); admin bulk-status (no durable claim) can double-run refunds concurrently — each refund individually flips status exactly once (`refund.service.ts:272` `WHERE status='completed'`), so money stays correct; only the response envelope can differ (207-with-failures).

Fix sketch: check the SET NX return — `null` ⇒ another request holds the sentinel ⇒ answer the same 409 as the GET path. Effort: **S**.

### F-4 · OTP unlock query has no timeout — a silently-dead lock-pool connection hangs one request + pins 1 of 2 lock slots
**[P3]** · File: `backend/src/services/whatsapp-otp.service.ts:265-289` (+ `shared/db/src/index.ts:122-126`)

Evidence:
```ts
finally {
  if (acquired) {
    let unlockOk = true;
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]); // no timeout
    } catch (err) { unlockOk = false; … }
    client.release(!unlockOk);
```
`lockPool` sets only `max:2, connectionTimeoutMillis:2_000` (acquisition timeout) — no statement/query timeout. If the TCP path dies silently between the send/insert and the unlock, the unlock await blocks until TCP keepalive (~30 s initial delay, potentially minutes) errors out. During the hang: the `/auth/whatsapp/start` HTTP response is delayed (the finally runs before the promise resolves) and one of the two lock-pool clients is pinned; a second such hang makes every OTP start answer the busy 429. Self-healing (the eventual TCP error → catch → `release(true)` → slot destroyed and recovered), and the user's code was already delivered + stored so `verify` is unaffected.

Fix sketch: race the unlock against `AbortSignal.timeout(5_000)` (or set `statement_timeout` on the lockPool via `options`), treating a timeout as `unlockOk=false` (destroy path already correct). Effort: **S**.

### F-5 · Lock-pool failure paths log but never raise an admin alert
**[P3]** · File: `backend/src/services/whatsapp-otp.service.ts:232-244,270-285`

Evidence: pool-saturation (`:236-243`) and unlock-failure (`:272-278`) both `logger.warn(...)` only; no `logAdminAlert` (contrast: inventory-corrupt, coupon-maxed, credentials-sweep all alert). A sustained lock-pool pathology would surface to operators only as warn lines + a pattern of `cooldown` 429s in client logs.

Impact: low likelihood (the paths require pool/DB misbehavior), and a genuinely down DB is loud via every other query path + the neon health check; but the R117 design's own review question ("alert on lockPool failure?") currently answers "no". Fix sketch: `void logAdminAlert("system", …, { dedupeKey: "otp:lockpool" })` on the unlock-failure branch (and optionally a deduped saturation alert). Effort: **S**.

### F-6 · Dead exports on the money libs (zero production callers)
**[P3]** · File: `backend/src/lib/ledger.ts:70-84`, `backend/src/lib/points-ledger.ts:73-89`, `backend/src/services/topup.service.ts:59`

Evidence: `insertReferralSignupLedger` (retired R115, "kept for its historical rows" — but the rows already exist; only the writer would call it, and none does); `findPurchaseAward` (refund.service uses `remainingAwardForOrder` + `findRefundReversal` instead); `createApprovedTopup` (zero prod callers — designed future payment-gateway entry point, exercised by tests only; its own docstring says "No production caller today (tests only)"). All verified by repo-wide caller hunt (`rg` — definitions + comments + tests only).

Impact: maintenance noise on the most safety-critical files; a future reader may assume live paths. Fix sketch: delete the two lib helpers (or mark `@deprecated — tests only`); keep `createApprovedTopup` with its explicit "no production caller" docstring (it is a deliberate seam). Effort: **S**.

### F-7 · Buyer-side order view has no `decrypt_failed` honesty signal (R117 added it admin-side only)
**[P3]** · File: `backend/src/routes/orders.ts:56,72-75` vs `backend/src/routes/admin/orders.ts:322-330`

Evidence (orders.ts): `credentialsLive = order.status === "completed"` gates `safeDecrypt(...)` per field — a completed order whose ciphertext no longer decrypts (post-purchase ENCRYPTION_KEY rotation, or pre-R93 legacy rows) renders all-null delivered fields with **no flag**, while the admin reveal endpoint now returns `decrypt_failed: true` for exactly that state (`admin/orders.ts:328-330`).

Impact: reachable only via ops-side key rotation or legacy data (the R93-DATA `INVENTORY_CORRUPT` gate blocks new sales of undecryptable units — `manual.provider.ts:97-110`), but the buyer is the party who paid, and their UI would say "no credentials" rather than "cannot decrypt — contact support". Fix sketch: mirror the flag in `formatOrder` when `credentialsLive && hasRawFields && all-decrypts-null`, and surface it in the order-detail UI. Effort: **S**.

### F-8 · M4's third cite (`checkout.service.ts:255`) points at the fast-fail comment, not the authoritative selection
**[P3]** · File: `docs/FINAL_MONEY_INVARIANTS.md:15`

Evidence: the doc says "race-free selection INSIDE the tx at `:255`" — :255-257 is the *cheap pre-tx fast-fail* comment block; the authoritative `FOR UPDATE SKIP LOCKED` selection executes via the provider call at `checkout.service.ts:403-407` → `services/providers/manual.provider.ts:50-79`. The other two M4 cites are exact at HEAD (`.transaction(` :294; `INSUFFICIENT_BALANCE` :253). Cosmetic cite drift only. Effort: **S**.

## Prioritized fix table

| # | Sev | Title | Effort |
|---|-----|-------|--------|
| F-1 | P2 | topup approve/reject 400 on contract-valid optional `admin_note` | S |
| F-2 | P3 | Money-invariants doc: M1/M7 cites + header stamp stale | S |
| F-3 | P3 | Idempotency middleware ignores SET NX result (in-flight 409 gap) | S |
| F-4 | P3 | OTP unlock query unbounded (add timeout / statement_timeout) | S |
| F-5 | P3 | No admin alert on lock-pool failure branches | S |
| F-6 | P3 | Dead exports: insertReferralSignupLedger, findPurchaseAward (+ tests-only createApprovedTopup) | S |
| F-7 | P3 | Buyer-side decrypt_failed parity for completed orders | S |
| F-8 | P3 | M4 `:255` cite → actual in-tx selection site | S |

## VERIFIED-OK (checked and sound, with evidence)

1. **Money invariants M1–M14 all HOLD in code at HEAD** (cite corrections in F-2/F-8 only): M1 approve-tx re-check `topup.service.ts:267-272` + CAS `:407-421`; M2 in-tx dedup `wallet.ts:447-463`, `MAX_PENDING=3` `:429`; M3 mobile_transfer ref requirement `wallet.ts:365`; M4 single tx `checkout.service.ts:294`, INSUFFICIENT_BALANCE `:253`; M5/M6 durable replay `checkout.service.ts:152-168` + `lib/idempotency.ts:123-156,199-207`; M7 one tx `refund.service.ts:126-391`, post-commit events `:393-410`; M8 `adjustment.service.ts:172-266` (bounds :95-101, CAS :200-212, durable claim :237-255); M9 negative-balance unreachable (checkout :253 + topup/adjustment CAS + `setBalance` target>=0 :139-141 + result-bound :196-198); M10 **zero** `orders.amount` update sites (only status flip `admin/orders.ts:575` and refund status/credential columns `refund.service.ts:265-273,326-333`); M11 `manual.provider.ts:50-79` two ordered `FOR UPDATE SKIP LOCKED` selects + guarded claim `:114-119`; M12 V1-M20 block `migrate.ts:1099-1153`; M13 `loyalty.ts:235-248` durable claim; M14 corrupt/stale fail-closed (`manual.provider.ts:97-110`, product/variant/flash staleness `checkout.service.ts:323-392`).
2. **R117 OTP lock pool correct AND complete**: dedicated `lockPool` max 2 / 2 s connect (`shared/db/src/index.ts:122-126`), instrumented at boot (`server.ts:32`) and drained on shutdown (`server.ts:347`); acquire via `pg_try_advisory_lock` on the held client (`whatsapp-otp.service.ts:247`); every error branch releases — loser/not-acquired `:287`, winner `:285`, **unlock failure destroys the client** (`release(true)` `:285` with `unlockOk=false`) so Postgres drops the session lock; lock-acquire-query failure leaves `acquired=false` → plain release (no lock held server-side); pool-saturation answers the retryable busy verdict `:232-244`; test seam `__setOtpStartLockPoolForTests` exercises the gate. Namespaced `hashtext('otp-start:'+phone)` cannot collide with the `hashtextextended` lock families.
3. **Reveal gate correct**: 60 reveals / 10 min sliding window per admin, attempt recorded before gating (`admin/orders.ts:42-56`), over-budget → 429 + `Retry-After: 300` + deduped alert naming the admin (1 h window) with `.catch` attached `:263-279`; audit row awaited before material leaves the process `:300-303`; bounded map hygiene `:50-54`.
4. **decrypt_failed honesty** — `admin/orders.ts:328-330` flags has-raw-but-all-GCM-fail (see F-7 for the buyer-side gap).
5. **checkNeon warmup probe** — `health.ts:241-263`: unmeasured warmup triggers the Neon resume, its failure deliberately falls through to the measured probe (genuine outages still escalate via the normal streak counters `:297-308`); worst case (5 s warmup + 5 s measured) exceeds the 8 s aggregate bound → `boundedAggregate` `:730-757` returns the never-cached degraded snapshot and resets `inflight` in `finally` — no wedge, no stale cache.
6. **/healthz Cache-Control family consistency** — base `public, max-age=5` (`health.ts:501`), live `:826`, summary `:791`; admin-gated detail endpoints leak no infra detail.
7. **Events-after-commit discipline** — checkout coupon-maxed signal object `checkout.service.ts:276-291` fired post-commit `:726-733`; refund credential-revoke + provider-release alerts strictly after the tx `refund.service.ts:399-436`; `notifyCouponMaxedOut`/`logAdminAlert`/`emitToAdmins` are all non-rejecting.
8. **Coupon redemption exactly-once under concurrency** — atomic-with-check increment with commit-time `is_active`/`expires_at`/`usedCount<maxUses` predicates `checkout.service.ts:480-496`; symmetric slot return on refund `refund.service.ts:293-298` (`GREATEST(used_count-1,0)`).
9. **Topup approval battery** — xact-scoped advisory lock on the reference `topup.service.ts:263`, in-tx duplicate check `:281-299`, composite soft-dedup `:329-356`, guarded pending→approved flip `:364-378`, fresh-read + CAS wallet credit `:396-421`, atomic ledger `:424-436`, guarded referral flip `:454-501`, guarded welcome-bonus flip `:512-539`; automated gateway path mirrors the battery `:59-186`.
10. **Refund correctness** — status-guarded terminal flip `:264-276`, full-write-set optimistic lock (balance+points+lifetimeSpend) `:234-257`, credential nulling inside the tx `:320-336`, precise FIFO points reversal via `remainingAwardForOrder` (`points-ledger.ts:133-242`) with bounded-cap fallback.
11. **Loyalty convert** — strict integer/multiple validation `loyalty.ts:104-137`, dual-column CAS `:186-198`, wallet + points ledgers in-tx `:204-230`, durable claim `:235-248`.
12. **Durable idempotency lib** — per-subject scoping `lib/idempotency.ts:109-115`, intent-filtered replay `:123-156`, in-tx claim `:199-207`, 42P01 latch with test re-arm `:51-56`; drizzle/`pg` two-level SQLSTATE unwrap `:64-87`.
13. **Cron schedules correct & isolated** — 00:00 alert retention (`cron.ts:57-77`) + 00:00 idempotency retention `:90-111`; 00:05 TOTP advisory `:122-135`; 02:15 forecast / 03:30 risk / 03:35 forecast-retention / 03:50 enrichment / 04:00 enrichment-retention / 04:30 auth-activity `:276-414`; **05:00 UTC session-cleanup block** `:143-239` targeting the right tables/columns (user sessions `expires_at` `session-prune.ts:35-43`, admin sessions, notifications, login_attempts, audit_logs) — every job in its own try/catch with per-job Sentry tags; all schedules pin `timezone:"UTC"`; boot one-shots run sequentially with per-job isolation `boot-one-shots.ts:58-71`.
14. **Leader election sound** — single-statement CAS lease on the DB clock `pg-leader-lease.ts:139-165`, holder-verified refresh `:155-159`, holder-scoped release `:162-165`, never-throw contract `:191-255`; coordinator retries with orphan-lock guards `scheduler-coordinator.ts:460-515`.
15. **Telegram webhook hardening** — timing-safe secret check `telegram-webhook.ts:208-218`, TELEGRAM_ADMIN_IDS allowlist before any mutation `:119-133`, pre-mutation status read + service-level re-check `:142-161`, all Telegram calls timeout-bounded (10 s AbortController `:80-98`), always-200 ack contract `:250-254`.
16. **External-call timeouts** — openwa gateway: 8 s/request, 3 attempts, backoffs [1.5 s, 4 s] (`openwa.service.ts:637,989-990`) ⇒ the documented ~30 s worst case is honest; telegram dispatch pipeline: timeout + transient/permanent classification + retry caps (`telegram.ts:377-464`); wallet's inline approval-card fetch has `AbortSignal.timeout(10_000)` (`wallet.ts:647`).
17. **No swallowed errors on money paths** — repo sweep found **zero** empty catch blocks in non-test backend source (sole `catch {}` match is a comment, `notify.ts:16`); every fire-and-forget site is non-rejecting by construction (dispatch, logAdminAlert, writeAuditLog `lib/audit.ts:71-98`, createNotification `notify.ts:48-59`, observe, attemptAcquisition, writeEpochMarker) or carries `.catch`.
18. **Input validation coverage — every public route**: orders (zod `CreateOrderBody` `orders.ts:137`), wallet topups (zod + bounds + allowlist `wallet.ts:244-374`), loyalty convert (strict regex/int `loyalty.ts:104-137`), coupons validate/create/patch (zod `coupons.ts:63-69,98,209,290`), support create/reply (zod `support.ts:122,238`), cart add/patch (typed checks + MAX_QUANTITY `cart.ts:154-169,262-271`), auth provider-unlink/firebase-session/telegram (`auth.ts:227-236,502-504` etc.), auth-whatsapp start/verify (typeof guards `auth-whatsapp.ts:61-65,193-205`), cwv (defensive text parser + sample schema + batch caps `cwv.ts:180-240`), products (clamped filters, LIKE-escaped search `products.ts:212-243`), notifications (intParam), health/metrics/seo (no user input; metrics auth-gated with constant-time token + session validation `metrics.ts:33-113`). Admin surface likewise (zod or typed guards everywhere surveyed, incl. admin/orders bulk-status ids cap 200 + status enum `admin/orders.ts:364-411`, admin/users finance-gated loyalty/wallet branches `admin/users.ts:190-374`, admin/products inventory upload per-entry validation + advisory lock `admin/products.ts:435-584,642`). No endpoint accepts unvalidated money/auth-adjacent input.
19. **TODO/FIXME/HACK inventory: ZERO** markers in non-test `backend/src` (word-boundary grep — the only hits are false positives like `9XXXXXXXX`).
20. **Error response shapes consistent** — `createErrorResponse` everywhere; documented deviations only (wallet `limited` V4-P1 shape `wallet.ts:580-587`, Telegram-webhook `{ok}` contract, idempotency 409 envelope carries `error`+`message`+`code`); global handler shapes JSON 400/500 with Arabic copy and delegates capture to the Sentry handler (`app.ts:1090-1122`).
21. **Wallet money display-vs-storage parity** — `roundLydString` at the topup boundary (`wallet.ts:501`), `roundLyd` in the automated path (`topup.service.ts:75`), epsilon-corrected half-cent rounding (`lib/money.ts:20-23`); checkout/refund/convert `toFixed(2)` uses are 2dp−2dp arithmetic (cannot land on a half-cent), so no binary-dust exposure.
22. **`checkout.service.ts:682` `if (!order)` is unreachable defensive code** (tx always returns the order row or the catch maps a failure envelope) — harmless belt, noted for completeness.

**Findings by severity: P0: 0 · P1: 0 · P2: 1 · P3: 7 (+ 22 VERIFIED-OK clusters)**
