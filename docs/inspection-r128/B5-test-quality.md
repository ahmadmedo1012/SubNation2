# R128-B5 — Test Quality & Honesty Audit of the R122–R127 Wave (99 commits, c2f531a..7d469d5)

**Repo:** SubNation2 @ `7d469d5` (main) · **Agent:** R128-B5 (read-only; only this file + worklog append)
**Priors read first (not re-reported):** `docs/inspection-r125/A10-tests.md` (R125 test-quality pass, introduced the inclusion concern A10 §1-7/§2.2), `docs/inspection-r127/R1-independent-review.md` §6 (test honesty of R127's own additions — held; its 7 verification runs and §6 conclusions are taken as baseline).

**Wave test surface (git `--diff-filter=A`):** 92 new test files (78 unit/BE + 4 BE `backend/tests/`-adjacent none new… exact split: 56 FE vitest, 26 BE vitest, 10 Playwright guest specs) = **536 new `it/test` blocks**; 477 non-e2e. Full-suite NOT run (3.9GB box) — 4 targeted single-file runs used (budget 4/4): `coupons-validate` 11/11 · `security-audit-tab` 6/6 · `admin-stats-emit` 14/14 · `storefront-r125-sweep` 7/7 — all green.

---

## 1. Theater hunt — VERDICT: **NO THEATER FOUND** (unit/backend/frontend-vitest)

Mechanical census (script `/home/z/my-project/scripts/r128-b5/analyze.mjs`, line-based state machine over all 477 non-e2e new tests):

- **Zero-assertion tests: 0 / 477.**
- **Expect-count histogram:** 1×128 · 2×134 · 3×82 · 4×56 · 5×32 · 6–20×46. Median 2, no outliers at 0.
- **Single-expect tests: 128 — weak-only (solely `toBeTruthy`/`toBeDefined`/`not.toBeNull`): 0.** All 128 use strong matchers (`toBe`, `toEqual`, `toContain`, `toBeDisabled`, DB-row `toMatchObject`, etc.).
- All 16 `toBeTruthy`/`toBeDefined` occurrences in the wave are **guard-then-act** patterns (read individually): e.g. `mobile-390.spec.ts:26` guard → `box!.height ≥ 40`; `topups-queue-search:191` guard → click + timer-advance + row-return assertion; `copilot-error-envelope:136` `expect(row).toBeTruthy()` inside a helper with custom message → returns id used by later row assertions.
- Every `waitFor`/`vi.waitFor` block in the wave contains a real assertion (checked all 11 multi-line blocks — e.g. `wallet-topups-telegram-card:173` waits for `approvalCards()).toHaveLength(1)`).
- **Mock-returns-assert-mock tautologies: 0** (`rg toHaveBeenCalledWith(…mock` over all 92 files → no hits; the referral/hook-level tests assert on `fetchMock.mock.calls` URLs *through the real generated client + real customFetch*, not on mock state).
- **Snapshots: 0** in the entire wave (`toMatchSnapshot|InlineSnapshot` → none in backend/src + frontend/src).
- **No `.skip`/`.only`/`.todo`** (R1 §6 verified for R127's files; re-verified across the full wave list).

**Nearest-miss (the only evaporating-assertion patterns in the wave — both in the e2e guest suite, both pre-flagged and still open):**

| ID | Site | Pattern | Status |
|---|---|---|---|
| B5-1 (P2) | `frontend/e2e/cart-gate.spec.ts:21-27` | `const canBuy = await buy.isVisible().catch(() => false); if (canBuy) {…cart assertions…}` — if the 4-alternative selector regex (`/إضافة إلى السلة|اشترِ|الشراء|سلة/`) ever drifts, the cart assertions **silently skip and the test stays green**. This is A10 §1-item-7 (R125) — **still unfixed at HEAD**. Mitigating fact: the unit pin `product-cta-mobile-r126.test.tsx` pins the accessible name «أضف للسلة — سجّل دخولك عند إتمام الطلب», which the regex's last alternative (`سلة`) still matches — luck, not contract. |
| B5-2 (P4) | `frontend/e2e/login-page.spec.ts:13-20` | `expect(body).toBeTruthy()` (textContent non-null) + `if (await terms.isVisible().catch(...))` conditional link-check. Smoke-honest but soft. |

b0a9267's rubbergreen repair fixed search-arabic.spec.ts (the worst offender) but left these two.

## 2. Coverage holes on the newest features — mostly CLOSED, two real gaps

| Feature (round) | Verdict | Evidence |
|---|---|---|
| **audit-logs UI tab** (R127-L5) | **COVERED, strong** | `security-audit-tab.test.tsx` (6): render + Arabic action map + raw code, B11-F1 telegram actor arm, error≠empty + retry recovery, finite pager (`السابقة` disabled@1, `التالية` gated on server `hasMore`, page=2 requested + rendered, honest «عرض N من إجمالاً M»), filters ride query params (action/actor/date-range). Generated-client usage IS tested — `useListAdminAuditLogs` issues the request through the real customFetch (only the network boundary is stubbed `resLike`). Backend twin: `audit-logs-route.test.ts` (13) — isolated gate chain (support-only 403, no-token 401) + real-adminRouter integration + pagination clamps + 400-strictness. Minor residue: the Authorization header attach itself isn't asserted (customFetch's concern, pinned elsewhere). |
| **socket-resync / alert-room** (a8151a9) | **COVERED incl. negative paths** | `socket-alert-room-reconcile.test.ts` (6) pins the exact B6-1 attack: support scope revoked while admin stays active → next tick EVICTS from `ADMIN_ALERTS_ROOM` **without disconnecting**; symmetric grant-mid-connection joins; `"all"` wildcard; non-admin no-accidental-join; revoked-session still strips BOTH admin rooms + hard-disconnects (anti-shadow pin). Token-gating negatives live in the untouched pre-existing suites (`socket-auth`, `socket-revocation`, `socket-admin-temp-token`, `socket-connection-limits` — 0 wave commits); `socket.ts`'s 46-line move is covered by the 6 new DB-probe tests. FE resync: `use-socket-topup-dedupe` (toast dedupe on `data.id`, R127-B6-7), `session-manager-error-states` (error≠empty ×3 arms + retry + logout-all failure toasts), `socket-initializer-resync` (+134 lines in-wave). |
| **telegram webhook DENIED arms** (R127-L5 / R122) | **COVERED — all arms** | `telegram-webhook-audit-row.test.ts` test 3: allowlist-DENIED tap (`OUTSIDER_ID`) + already-processed topup → **no audit rows** (both no-row arms). The money-path twin `telegram-webhook-topup-money-path.test.ts` (12 tests, 99 expects, in-wave 772be0f): no-secret 403, wrong-secret 403 (constant-time arm), unset-secret 503 fail-closed, non-JSON ping no-op, non-allowlisted → denial toast + **zero mutation**, already-approved/-rejected replays → balance unchanged, non-existent id, exact-once credit + ledger + keyboard strip + actor, full callback replay credits nothing, reject arm with tg:\<id\> actor. |
| **OpenAPI rows 38→49** (R127-L1 batch-2 + L5) | **REAL responses, not yaml-echoes** | `openapi-response-contracts.test.ts` imports the **real app** (full middleware stack), exercises it via real fetch on an ephemeral port, and safeParse's every 2xx body with the **orval-generated zod schemas**. The 11 new rows seed meaningful data: risk dashboard (high/unlabeled + low/labeled), risk events keyset (`limit=1` + extra `next_cursor` typeof pin), forecast at-risk (full row), forecast product **null-arm** (id 999999 parses against the SAME schema), audit-logs **both actor arms** (console-admin + telegram metadata-attribution). A field the handler emits but the spec forgot fails HERE — this is shape-parity, the thing path-parity can't see. |
| **copilot envelope ×47** (R125 a8d688c) | **Regression-tested** | `copilot-error-envelope.test.ts` (7): one representative envelope per family, asserted on the **raw response text** (byte-exact JSON incl. key order, `no details key` proof). Verified the pins map to live code (`previews.ts:55/61/67/110`, `ask.ts:139`, `draft.ts:61`, `settings.ts` FORBIDDEN — `createErrorResponse` ×57 sites across the 4 files). Executor-dependent envelopes delegated to service suites (documented in-file). |
| **e2e guest suite vs live** | **2 holes** | See §7. |

**The 2 real holes (also the biggest of the audit):**

- **B5-3 (P2) — the guest e2e suite has NO automated heartbeat.** The CI `e2e` job is `if: github.event_name == 'workflow_dispatch'` ONLY (`ci.yml:481`); the weekly `schedule` (Mon 04:17) does not run it. d604e67 (R125) **proved this drift class real**: 2 stale contracts (catalog/stats key, auth/providers wrapper) accumulated undetected "in rounds" and were caught only by a manual live run. The unit-side twin now pins those shapes (openapi rows), but the LIVE-Prod leg of the contract still has no scheduled execution. Recommendation: add `schedule` to the e2e job's `if:` (or a post-deploy smoke) — the suite is already guest-safe by design.
- **B5-4 (P3) — negative-window real-timer sleeps** (§6): the false-green risk class A10 flagged; b0a9267 retired the 2 worst (referrals-search-race, topups-queue-search → fake timers) but 5 files / ~7 sites remain, 4 of them created inside the wave.

## 3. Assertion-strength distribution (10-file deep sample)

Sample = the 10 newest-feature files read in full:

| File | Tests | Grade |
|---|---|---|
| `security-audit-tab.test.tsx` | 6 | **behavior** (render/URL/pagination state) |
| `telegram-webhook-audit-row.test.ts` | 3 | **behavior** (DB rows, metadata shapes) |
| `copilot-error-envelope.test.ts` | 7 | **behavior** (byte-exact response envelopes) |
| `socket-alert-room-reconcile.test.ts` | 6 | **behavior** (DB + room state) |
| `openapi-response-contracts.test.ts` | 49 | **behavior/contract** (real app + zod safeParse) |
| `budget-dsn-parity.test.ts` | 9 | 8 behavior (truth table + leak probe) + 1 **implementation** (config source-ordering pin — justified in-file: "the whole fix silently no-ops" otherwise) |
| `spa-shell-route-parity.test.ts` | 6 | **behavior** (cross-layer parity shell↔page copy, + extraction-sanity pins) |
| `boot-card-image-warmup.test.ts` | 5 | **behavior** (pure selection semantics; wiring documented as eye-reviewed — honest limitation) |
| `storefront-r125-sweep.test.ts` | 7 | **implementation** (source-scan negative-space bans, comment-stripped, each with a measured why) |
| `product-card-title-fit.test.tsx` | 6 | 2 behavior-ish (DOM `fetchpriority` attributes) + 4 **implementation** (className pins) |

**Ratio: behavior ≈ 92/104 (88%) · implementation-pins (brittle-but-honest, each with documented rationale) ≈ 12/104 (12%) · vacuous 0/104 (0%).**
Consistent with the mechanical census (§1): the wave's norm is state/data/aria assertions; className/source pins are the minority and always paired with the finding they pin.

## 4. The test-inclusion gate (R125 A10 → b0a9267 widening)

Gate mechanics (verified): the gate is **typecheck inclusion** (b0a9267: backend `tsconfig.include=["src","tests"]`, frontend `["src/**/*","e2e/**/*",playwright.config,vitest.config]`) **plus** the two vitest runners' include rules and Playwright's `testDir:"./e2e"`.

Where a test file can hide today (latent holes — **0 exploited**; verified by repo-wide glob):

1. **`frontend/src/**/*.spec.tsx`** — frontend vitest `include: ["src/**/*.test.{ts,tsx}"]` drops `*.spec.*` (backend has NO custom include → vitest default catches both `.test.` and `.spec.`). A spec-named file under frontend/src would be **typechecked but never executed** — silently green-by-absence. Fix: `["src/**/*.{test,spec}.{ts,tsx}"]` or mirror backend (drop the custom include).
2. **Repo-root / cross-package test files** (e.g. `/foo.test.ts`, `packages/x/y.test.ts`) — outside both vitest roots; `scripts/tsconfig` only covers `scripts/src`+`scripts/*.ts`. Invisible to every gate. (Backend strays under `backend/**` WOULD run via default include, just not typecheck — acceptable.)
3. **e2e in-coverage but execution-gated**: specs typecheck (b0a9267) and are discovered by Playwright, but skip unless `E2E_ENABLED` and CI only sets that on workflow_dispatch — a spec can rot green indefinitely (see B5-3).

No hidden test files exist at HEAD (glob: only the 10 e2e `.spec.ts` under `frontend/e2e/`, zero stray `.test.*` outside the two vitest roots, zero `.spec.*` under `frontend/src`).

## 5. Money-path invariant map (docs/FINAL_MONEY_INVARIANTS.md M1–M14 × the wave)

Wave-commits touching money suites: 952e902 (coupon parity + battery), 772be0f (telegram money path), a8d688c (pricing tx + points), 108ebde (M25/M26), a8d1f10 (M27–M30), f029a63 (M31 + risk-retention), 70489a2 (wallet-confirm FE), 9e65bab (Arabic canon), b0a9267 (mock-shape fixes).

| Invariant | Wave effect | Verdict |
|---|---|---|
| M1 topup atomicity | `topup.service.test.ts` untouched; **added** `topups-action-real-service` (approve exactly-once via REAL service + audit row, replay 400) and telegram-webhook approve/reject arms | **strengthened** |
| M2 creation dedup in-tx | `topup-composite-dedup` +3 lines: Arabic message pin updated in lockstep (`DUPLICATE_PAYMENT_REFERENCE` code still pinned) | intact |
| M3 payment reference required | `wallet-topups.test.ts:488` copy-canon updated **and strengthened** (`not.toContain("مرجع التحويل")`); M3 suite `topup-payment-reference` +1 canon line; openapi row sends a reference | intact |
| M4 atomic purchase | checkout suites untouched; **added** `checkout-points-award` (exact one award row, 0-point floor, interleaved-points `CONCURRENCY_ERROR` → **full rollback incl. claim revert** + retry succeeds) | **strengthened** |
| M5 durable idempotency | middleware + 4 durable suites untouched; R1's generated-fetcher header-path break-attempt held | intact |
| M6 retry replay | `checkout-idempotency.test.ts` untouched | intact |
| M7 refunds tx + points race | refund suites untouched | intact |
| M8 admin adjustments intent-keyed | `adjustment.*` untouched; FE `users-wallet-confirm` (+70 in-wave) still asserts the raw fetch URL+init incl. the idempotency key (fetch-level, NOT hook-level — no strength lost) | intact |
| M9 negative-balance | via M1/M4/M8 + `wallet-topups.test.ts` | intact |
| M10 orders freeze price | `price-snapshot-immutability` untouched; pricing recompute now tx-wrapped with **real pglite trigger-injected rollback pins** (mid-loop raise → every variant write rolls back; post-loop raise → all roll back) | **strengthened** |
| M11 single-writer claims | `checkout-claim-race` untouched | intact |
| M12 topup FK (V1-M20) | 7 new migration suites (`migrate-v1m25…m31`, 6+6+6+6+6+6+6) — chain-probe + journal truth | **strengthened** |
| M13 loyalty convert durable | `loyalty-durable-idempotency` untouched; points-award adds the award arm | intact |
| M14 dup-claim corrupt | untouched | intact |
| (coupons, not numbered) | `coupons-validate.test.ts` **+333**: /validate now resolves the flash sale and runs the SAME `evaluateTotalDiscountCap` as checkout — the validate/checkout divergence (45%+10%>50% validating green) is pinned both arms + roundLyd idiom | **strengthened** |

**Referral credit level-move (fetch→generated-hook):** re-confirmed — `referrals-401-redirect`/`referrals-finance-gate` mock only the network boundary (`resLike` through the real customFetch of the real generated hook); 401/error/race assertions are on `fetchMock.mock.calls` + rendered state. R1's blessing stands; **no other invariant lost direct coverage** — the 56 admin fetch-conversions (9434fef) were read-paths, and the money mutations (adjust, credit) remain fetch-surface-pinned.

**Lost direct coverage: ZERO of the 14.** 4 strengthened, 10 intact.

## 6. Flake inventory (newest suites)

| Risk | Sites (wave) | Severity |
|---|---|---|
| **Negative-window real sleeps** (assert "X never fired/never rendered" after a wall-clock wait — false-green if the event would land later than the window on a loaded runner) | `dashboard-chart-race.test.tsx:265,312,379` (150/150/200ms — **new in-wave**, chart race pins); `admin-layout-pill-search-scope.test.tsx:203` (600ms); `dashboard-chart-scope-gate.test.tsx:173,214` (600ms — pre-existing, A10 §5 noted); `security-audit-tab.test.tsx:301` (350ms for the 300ms debounce) | P3 — the deterministic fake-timer idiom exists in-repo (b0a9267 converted referrals-search-race + topups-queue-search); apply it to the remaining 5 files |
| **Proving-absence with a beat** | `telegram-webhook-audit-row.test.ts:247` (100ms then "no rows"): a slower fire-and-forget writer would land after the check — only masks broken builds, never flakes a good one; `:127` 25ms-poll loop is the correct direction | P4 |
| Date.now / new Date | All seed-relative with ≥22h margins (`admin-security-summary` 24h-boundary rows at −30s/−60s vs −3d/−5d; coupon `endsAt ±3600s`; copilot `±60s`) — **no wall-clock assertions** | none |
| Order-dependence | None found: per-file seq counters (`phoneSeq`, `adminSeq`, `alertSeq`), `randomUUID` usernames, `resetTestDb` per `beforeEach`, extra tables `DELETE`d in FK order; `system_settings` copilot key cleared explicitly (documented: not in harness TRUNCATE) | none |
| Real network in unit tests | None: `127.0.0.1:ephemeral` listen-per-request only; `api.telegram.org` intercepted (`globalThis.fetch` split, restored in `afterAll`); the `subnation.ly` strings are literal assertions | none |
| CI parallel split (R127-L4) | backend/frontend are **separate matrix legs on separate runners** (no shared DB; backend harness is in-process pglite) — no cross-suite race. Within a leg, vitest default isolation + the above per-file hygiene → no intra-suite race found. Playwright `retries: 2` can mask real e2e flakes (acceptable smoke posture; noted) | none new |

## 7. e2e guest suite health (d604e67 sync, read-only spot-check ×3+)

1. **api-contracts.spec.ts** (the file d604e67 corrected): both corrected shapes still match HEAD source — `available_products` (`products.ts:558`) and `{providers: [...]}` (`auth.ts:211`); healthz/products rows unchanged-and-true. **PASS.**
2. **search-arabic.spec.ts** (b0a9267 rubbergreen repair): API-ground-truth-first + URL-mirror + scoped-DOM + exact empty-state strings — all four pinned Arabic strings verified present in `home.tsx` at HEAD (`:995 البحث في المنتجات`, `:1220/:1222` empty-state pair). **PASS.**
3. **cart-gate.spec.ts / login-page.spec.ts / home.spec.ts**: home.spec is honest (title/h1/card + zero-console-errors). **cart-gate carries the still-open soft-skip (B5-1)** and login-page the conditional link check (B5-2). The `د.ل` price-text pin and `/login` redirect pin are live-true.

**Overall sync state:** shapes in sync (2/2 corrected contracts hold; copy pins verified); assertion honesty: 8/10 specs hard, 2 soft.

---

## Findings P0–P4

| ID | Sev | Finding | Fix (S/M) |
|---|---|---|---|
| — | P0/P1 | **None.** | — |
| B5-3 | **P2** | Guest e2e has no CI heartbeat (`workflow_dispatch`-only) — the drift class d604e67 proved real can recur silently | S: add `schedule` to the e2e job `if:` |
| B5-1 | **P2** | `cart-gate.spec.ts:21-27` evaporating `if (canBuy)` (A10 carry-over, in-wave file, still open) | S: hard `await expect(buy).toBeVisible()` + drop the 4-alternative regex for the pinned name |
| B5-4 | **P3** | Negative-window real sleeps ×5 files (~7 sites, 4 in-wave) — false-green class under CI load | S each: b0a9267's fake-timer idiom |
| B5-5 | **P3** | Frontend vitest include drops `*.spec.*` under `src/` — latent silently-never-run hole (asymmetric with backend default) | S: widen include |
| B5-6 | **P4** | Repo-root test files invisible to every gate (0 today) | S: one-line guard in validate.ts or document |
| B5-2 | **P4** | `login-page.spec.ts` conditional link check + `toBeTruthy` body pin | S |
| B5-7 | **P4** | `telegram-webhook-audit-row:247` absence-proof window 100ms | S: poll-until-stable-two-reads |
| B5-8 | **P4** | `boot-card-image-warmup` wiring (.then) eye-reviewed only (documented) | accept / comment pin like budget-dsn-parity's ordering test |

## Overall honesty grade of the wave's tests: **A−**

- Unit/backend (78 files): **A+** — zero theater by census AND by reading; denied/negative arms everywhere money moves; real-app + real-DB harnesses with only the true boundary stubbed; every brittle pin carries its measured why.
- Frontend vitest: **A** — same discipline; minor negative-window sleep debt.
- Guest e2e (10 specs): **B+** — honestly scoped and now ground-truth-first in the repaired spec, but 2 soft-skip patterns and no automated execution.

Method note: static-first (census scripts + 22 full-file reads + targeted greps), 4/4 single-file vitest runs (budget respected), no mutation experiments needed (no vacuous candidate survived the census), zero source edits, scratch scripts under `/home/z/my-project/scripts/r128-b5/`.
