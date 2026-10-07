> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r111/t1-backend-test-quality.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R111-T1 — Backend Test-Quality Audit (1312 tests / 151 files)

> READ-ONLY audit. No source changes. Round 111, sibling to T2 (frontend+openwa) — this
> report covers the SubNation2 **backend** Vitest suite only. Method: full reads of the 8
> crown-jewel money files + the lockout/V1-M20/coupon guard suites, grep sweeps for
> tautology/over-mock/flake patterns, 5 mental mutation spot-checks, basename-reference
> untested-file map, fixture-vs-zod drift check. The full suite was NOT run (budget).

## Verdict in one line

The backend suite is **genuinely strong on the money core** — the crown jewels run against a
real in-process Postgres (PGlite) with production-parity constraints (V1-M9/M10/M16/M17
mirrored and *pinned by a schema-parity suite*), real PK-collision and rollback semantics,
and balance/ledger/order-count invariants asserted after every mutation. No vacuous
money-path test was found. The residual risk concentrates in **(1) the HTTP idempotency
middleware having zero direct tests (its TTL semantics are only exercised through an
in-memory Redis double that ignores TTL), (2) a fully-mocked lockout mirror at route level
leaving one file as single-point coverage of the real SQL, (3) 17 untested files (~2,119
lines) including the exact file carrying B6-02's proven self-DoS.**

---

## 1. Tautology sweep — counts

| Pattern | Count | Detail |
|---|---|---|
| `toHaveBeenCalled*` without nearby state/DB assertion (money files) | **0** | Every call-assertion in money files is paired with a DB row-count/balance assertion (e.g. orders-idempotency-route: `notifyNewOrder ×1` **and** `balanceOf==40` **and** orders length 1) or is a legitimate route-wiring spy (PRODUCT_STALE→409 mapping). |
| Sole `toBeDefined`/`toBeTruthy` in money files | **0** | All 22 occurrences repo-wide are compound (refund entry `toBeDefined` → then amount/balanceBefore/referenceType assertions; schema-parity index checks → then column-name/definition assertions). |
| `expect.assertions(...)` usage | **0 / 151 files** | Hygiene gap only: no vacuous pass found — every `try/catch` pattern (topup-composite-dedup:103-116, wallet-topups-durable V1-M20:237-243) asserts `err` afterwards, and `.rejects.*` fails by construction on resolve. |
| Snapshot tests | 0 | None in backend. |
| `resolves.toBeDefined()` as the whole point | 0 | provider-fulfillments:133 is the *positive* insert before the real unique-index-violation assertion. |

## 2. Over-mocking check — the 8 crown jewels

**Files read in full:** checkout-idempotency, orders-idempotency-route, wallet-topups-idempotency,
cross-intent-durable-idempotency, adjustment.service, refund.service, topup.service (approve),
loyalty-durable-idempotency, plus topup-composite-dedup, topup-auto-guards, lockout-upsert,
wallet-topups-durable-idempotency (V1-M20), migrate-drizzle-0013.

- **`db.transaction` is never mocked in any money test.** Only 5 files mock `@workspace/db`
  (audit-client-ip, pricing-config, admin-auth-lockout, boot-leader-wait, boot-resilience) —
  none on a money mutation path, and 4 of the 5 mocked modules have real-DB siblings
  (lockout-upsert.test.ts ↔ lib/lockout; pg-leader-lease.test.ts ↔ lease; migrate-v1m9/v1m14/0013
  + wallet-topups-durable V1-M20 stage tests ↔ the migration stages boot-resilience mocks away).
- **Idempotency claims are tested with REAL DB PK behavior**: checkout-idempotency.test.ts:234-311
  drives a genuine SQLSTATE 23505 through a same-session interleave harness
  (`helpers/tx-interleave.ts` — a documented, honest proxy: writer rides the real tx, caveat
  spelled out, "winner keeps its write" half covered by sequential tests); cross-intent pins
  PK collision + reference_type disjointness with real `idempotency_keys` rows.
- **Redis is mocked exactly once (wallet-topups-idempotency)** — with an in-memory double whose
  purpose is to *exercise* the mounted middleware's replay branch rather than bypass it. The
  durable-layer suites deliberately run Redis-absent. Correct layering — **but** see Finding
  W2: the double honors `NX` and ignores `EX`, so the middleware's TTL semantics are untested.

## 3. Mutation spot-checks (5 guards, mental)

| # | Guard | Mutation | Result |
|---|---|---|---|
| a | Topup approve in-tx exact-ref dup SELECT (topup.service.ts:94,262) | delete it | **SURVIVES silently — behavior-equivalent.** The V1-M9 partial unique index (mirrored in the harness DDL) backstops with 23505→409; topup-auto-guards:116,131 and topup-payment-reference:97,148 pin the *409 contract*, not which guard fired. Deleting the **composite** dedup DOES fail topup-composite-dedup:119-120 (balance 100 not 200). Informational: redundancy is deliberate (nicer operator error), no test distinguishes the two 409s — acceptable. |
| b | Refund exact-amount credit | credit amount+1 | **CAUGHT** — refund.service.test.ts:83,91,101-103 (balance 100, ledger amount 30, before/after 70→100). |
| c | Admin per-username lockout ceiling (645c25c / R110-01, threshold 10) | invert ceiling | **CAUGHT — but only by one file.** lockout-upsert.test.ts:197-206 pins 9→unlocked / 10→locked against the *real* SQL CASE on a real table. The 772-line route suite stays green through any real-lib regression (its lib/lockout mock re-implements the threshold — see W1). |
| d | V1-M20 FK-drop stage | swallow errors / skip | **CAUGHT — twice.** wallet-topups-durable-idempotency.test.ts:231-258 (pre-fix FK present → 23503 reproduced → stage → FK list `[]` → claim succeeds → re-run no-op) + migrate-drizzle-0013.test.ts:190-213 (by-any-name drop + order-commutation with 0013). |
| e | Coupon ≥100% server rejection | allow 101% | **CAUGHT at ≥3 layers** — pricing-coupon-legacy-bound.test.ts:55-64 (resolveCoupon `invalid_value`, rejected-not-clamped), admin-flash-sales.test.ts:70-76 (MAX_CAP+1 → 400 + **no row written**), pricing.test.ts:19 (flash clamp). |

## 4. Untested-file map (zero basename references across all 151 test files)

17 files / ~2,119 lines have zero direct test references. **Top-10 by risk:**

| Rank | File | Lines | Why it matters |
|---|---|---|---|
| 1 | `src/middlewares/idempotency.ts` | 287 | **Hidden by a basename collision** — "idempotency" test hits all reference `lib/idempotency`, NOT this middleware. It is the HTTP money dedup layer mounted on checkout/topups/loyalty/admin-adjustment. See W2. |
| 2 | `src/lib/catalog-cache.ts` | 55 | **Carries B6-02's proven self-DoS** (unbounded search-keyed LRU, ~0.5-1.5GB on 512MB). Wave-B fix #13 will land with zero test harness. |
| 3 | `src/jobs/boot-one-shots.ts` | 136 | `runBootOneShots()` — the 14-one-shot boot chain. B3 verified firing *statically*; a dropped/mis-registered one-shot or mid-chain throw keeps the whole suite green (B3 F-3 SIGTERM race also untested). |
| 4 | `src/lib/risk-dsl.ts` | 227 | Rule DSL parsed/executed by risk-scoring/rules services and admin risk routes; risk middleware suites test the middlewares, not the DSL grammar. |
| 5 | `src/routes/admin/pricing-calculator.ts` | 253 | Money-adjacent admin route, zero tests. |
| 6 | `src/lib/metrics-snapshot.ts` | 449 | Largest untested file. |
| 7 | `src/lib/body-parser-recovery.ts` | 116 | app.ts middleware (malformed-body rescue). |
| 8 | `src/lib/slugify.ts` | 160 | Product slug generation — D2's "100% unique slugs" invariant leans on it. |
| 9 | `src/lib/risk-aggregate.ts` + `risk-metrics.ts` + `risk-emit.ts` | 285 | Risk telemetry aggregation. |
| 10 | `src/middlewares/requireCopilotPermission.ts` + `requireCopilotPhase.ts` | 89 | Copilot gate middlewares (copilot service itself has 3 suites). |

(Honorable mentions: db-instrumentation 248, service-error 38 — ServiceError IS exercised
indirectly everywhere, user-provider, cookie-options, release-sha, metrics-snapshot.)

Also no same-named test file for services: checkout.service (covered *behaviorally* by 12+
checkout-* suites — fine), risk-alerts / risk-config-cache / risk-rules / risk-scoring
(covered only via the two middleware suites — thin), whatsapp-otp.service (covered by 5
whatsapp-otp-* suites — fine).

## 5. Flakiness scan

- **Real sleeps**: `refund-revocation.test.ts:95` (10ms), `coupons-referrals-audit.test.ts:116`
  (25ms), `account-link-consent.test.ts:319` (50ms) — sequencing hacks, low risk.
  `scheduler-coordinator.test.ts` (563 lines) runs on **real timers** with sleep+watchdog —
  deterministic but the slowest, least-hermetic suite; every other timing suite uses
  `vi.useFakeTimers` (7 files).
- **Random fixtures**: `Math.random()` phone generation in 10 money-test files
  (`adjustment.service`, `refund.service`, `topup.service`, …). Per-test `resetTestDb()`
  TRUNCATE makes collision odds negligible (~1e-6/suite) — hygiene only. The newer idempotency
  suites correctly use monotonic `phoneSeq`.
- **Shared mutable fixtures**: `vi.hoisted` `h` object in admin-auth-lockout is reset in
  beforeEach (line 256) — no cross-test bleed found. No shared DB state (per-test TRUNCATE
  RESTART IDENTITY CASCADE).
- **Random UUIDs in assertions**: none found.

## 6. Fixture drift (3 samples vs current zod)

- **Topup**: test `topupBody()` = `{amount:50, payment_method:"mobile_transfer",
  payment_network:"madar", sender_phone:"0913456789"}` — matches `CreateTopupBody`
  (shared/api-zod:820). Boundary pins EXIST: wallet-topups.test.ts:136 (10000.01→400),
  :392 (0.01 and 10000 accepted), :411 (100-char ref), MAX_PENDING=3 at :226.
- **Checkout**: `{product_id}` (+optional variant_id/coupon_code) matches `CreateOrderBody`
  (shared/api-zod:675); orders-idempotency-route posts exactly this.
- **Product**: tests insert via the drizzle schema module directly (schema-first — no drift
  possible), and the whole DDL harness is pinned by schema-parity.test.ts (412 lines:
  constraint/index/FK name-and-definition parity).
- **Verdict: no fixture drift found.** (B2's zod `.max()` gaps are schema *gaps*, not drift.)

---

## Weak-test findings (severity, file:line, why, fix)

### W1 — [P3] Lockout route suite re-implements the ceiling it claims to pin
`admin-auth-lockout.test.ts:105-144` — `vi.mock("../../lib/lockout")` with an in-memory
mirror: `const maxAttempts = policy?.maxAttempts ?? 5; if (next >= maxAttempts) lock`.
**Why it proves less than it looks:** all 24 route tests stay green through ANY regression in
lib/lockout's real SQL (`WHEN attempt_count + 1 >= maxAttempts`, lockout.ts:126) — the route
suite validates the route's key-derivation/parity/401-uniformity (which it does well), not the
ceiling. The suite also never asserts the `POLICY` argument passed to `recordFailedAttempt`
(a policy-drop is caught only accidentally, via mock record-count arithmetic at :566-570).
**Single point of truth:** lockout-upsert.test.ts (real lib + real table, 9/10 threshold,
concurrency, expiry decay) is the ONLY thing standing between a ceiling regression and prod.
**Fix:** add one route test asserting `recordFailedAttempt` is called with
`expect.objectContaining({maxAttempts: 10})` for the `admin-username:` key; consider swapping
the mock's threshold re-implementation for an import of the real `calculateLockoutDuration`.

### W2 — [P2] The HTTP idempotency middleware (287 lines) has ZERO direct tests; its TTL semantics are untested everywhere
`src/middlewares/idempotency.ts` — mounted on `/api/orders`, `/api/wallet/topups`,
`/api/loyalty/convert-points`, admin adjustment; defines `IDEMPOTENCY_TTL_SECONDS=24h`,
`IN_FLIGHT_TTL_SECONDS=60s`, EX+N semantics (:230, :268), 4xx key-release, body-hash reuse
detection. No test file imports it. Route coverage exists only through
wallet-topups-idempotency's in-memory Redis double, which **implements `set(key,value,{NX})`
and silently ignores `EX`** (`wallet-topups-idempotency.test.ts:39-43`).
**Why it proves nothing about TTL:** expire/replay-after-24h, the 60s in-flight window
(the `409 IDEMPOTENCY_IN_FLIGHT` branch T2 found pinned only on the FRONTEND), TTL-extension
behavior, and Redis-failure mid-execution are all invisible — the double makes keys immortal,
so a mutation deleting `EX` from either SET keeps every backend test green. The durable-layer
suites intentionally bypass the middleware (Redis absent → pass-through).
**Fix:** one direct middleware test file — real `ioredis-mock` or the memory double extended
to honor `EX` (store expiry, tick a clock), pinning: in-flight 409, TTL expiry → live re-run,
4xx release (already pinned at route level), keyless pass-through.

### W3 — [P3] Scheduler coordinator is double-mocked with no integration sibling
`scheduler-coordinator.test.ts` (563 lines) mocks BOTH the Redis client and the PG lease
(`lease.acquire/refresh/release` vi.fn). Legitimate unit scope, but the composite —
coordinator's Redis-loss fallback driving the REAL `pg-leader-lease` SQL — is never exercised
together; a lease API drift replicated identically in both mocks passes (e.g. arg order).
`pg-leader-lease.test.ts` covers the lease alone. **Fix:** one test wiring the real lease
against the pglite harness behind the coordinator's fallback branch.

### W4 — [P3] Boot-resilience proves the wrapper, not the chain
`boot-resilience.test.ts` / `boot-leader-wait.test.ts` mock `runMigrations` + `@workspace/db`
entirely — they pin classification/retry/advisory-lock wiring (their stated scope, and the
stages themselves have real-DB tests), but nothing tests a *mid-chain transient failure* against
the real stage sequence (retry re-runs ALL stages; per-stage idempotency is what makes that safe
— pinned only per-stage, never as a chain-with-one-failing-stage). Acceptable, worth one
integration test on the pglite harness.

### W5 — [P3] Untested money/ops surfaces (see §4)
catalog-cache.ts (B6-02 self-DoS fix will land unverified — top priority), boot-one-shots.ts,
admin/pricing-calculator.ts, risk-dsl.ts.

**P4 / informational:** (i) 3 real sleeps (§5); (ii) `Math.random` phone fixtures in 10 money
files — switch to the `phoneSeq` pattern; (iii) `expect.assertions` unused repo-wide; (iv)
in-memory Redis double ignores TTL (fold into W2); (v) mutation (a) survivor is
behavior-equivalent by design — optionally pin the in-tx dup's operator-facing message
(`#${siblingId}`) distinct from the 23505 path.

---

## The 5 most dangerous greens

1. **admin-auth-lockout route suite (772 lines, 24 green)** — the per-username ceiling is a
   test-local mirror; real-lib regression keeps it green; single-file backstop
   (lockout-upsert.test.ts). [W1]
2. **wallet-topups-idempotency (5 green)** — "Redis replay works" proven only against a double
   that cannot expire keys; the middleware's 24h/60s TTL contract has zero coverage anywhere
   in the backend. A deleted `EX` mutates nothing red. [W2]
3. **The whole 1312-green suite vs catalog-cache.ts** — B6-02's proven unauthenticated
   memory-amplification self-DoS lives in a file no test references; the Wave-B #13 fix will
   ship with no regression harness, so a re-introduction (or an ineffective byte-budget) is
   undetectable. [W5]
4. **Green suite vs runBootOneShots** — "14 one-shots all fire" is a static (B3) property, not
   a test property; drop/mis-register one, or hit the F-3 SIGTERM race, and everything stays
   green. [W5]
5. **scheduler-coordinator (563 green)** — the leadership engine that decides which instance
   runs every cron is verified only against two mocks that agree with each other; the real
   Redis↔PG-lease handoff it exists for is never run once. [W3]

*(Honorable mention: boot-resilience — resilient-boot claims rest on a mocked DDL body. [W4])*

## What is genuinely excellent (do not "fix")

- Real-Postgres money testing (PGlite harness + schema-parity suite pinning prod constraints —
  including the historic lesson that a hand-written subset once certified prod-forbidden
  behavior, now guarded).
- The tx-interleave race harness with its honest caveat documentation.
- Cross-intent durable idempotency (both directions, real PK collision, reference_type
  disjointness, full rollback assertions).
- V1-M20 stage test (23503 reproduced → stage → FK gone → claim succeeds → re-run no-op).
- Boundary pins the frontend lacks (0.01/10000/100-char-ref/MAX_PENDING=3).
- Money-path assertion discipline: every mutation followed by balance + ledger + row-count
  (+ inventory) checks; "Constitution Principle I" ledger-reconstruction tests.

## Recommended actions (ranked)

1. W2 middleware test file (in-flight 409 + TTL expiry) — half-day, closes the only untested
   HTTP money-guard semantics.
2. W1 policy-argument assertion + mirror note — 15 minutes.
3. catalog-cache test harness **before** Wave-B #13 lands (byte-budget + search-skip).
4. One boot-one-shots registration/firing test (14 one-shots, fail if unregistered).
5. W3/W4 integration siblings — nice-to-have.
6. Hygiene: phoneSeq everywhere, expect.assertions in try/catch tests, fold real sleeps.
