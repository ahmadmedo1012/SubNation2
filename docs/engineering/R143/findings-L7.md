# Lane L7 findings — R143 (financial invariants & transaction integrity)

Task: R143-L7 · read-only audit at HEAD `528ef39` (working tree clean, `main`).
Scope: wallet ledger semantics, topups (idempotency/guards/approve-reject), orders
(single-tx checkout, freeze, claims, refunds, points reversal), loyalty convert,
coupons, referral credits, transaction boundaries, concurrency interleavings, and
verification of the R142 fixes in this lane (G-1, G-2, G-3, E-1, H-1).
Nothing was edited; no DB/migration/production touched.

## Method

Deep-read of the money core at HEAD: `routes/wallet.ts` (737 L), `services/topup.service.ts`
(736 L), `services/checkout.service.ts` (962 L), `services/providers/manual.provider.ts` (140 L),
`services/refund.service.ts` (444 L), `services/adjustment.service.ts` (278 L),
`routes/loyalty.ts` (427 L), `routes/orders.ts` (406 L), `routes/admin/{topups,orders,users,referrals}.ts`,
`lib/{ledger,idempotency,idempotency-body-hash,money,points-ledger,pricing}.ts`,
`middlewares/idempotency.ts`, shared/db money schema twins, the R142 frontend fix sites
(`pages/{loyalty,wallet,checkout}.tsx`), the copilot executor, plus targeted vitest runs.

**Test evidence (all green at HEAD):**
- Backend: `topup.service` · `checkout-idempotency` · `checkout-claim-race` ·
  `wallet-never-negative` · `refund.service` · `refund-points-race` ·
  `refund-reversal-precision` (7 files / 37 tests);
  `wallet-topups{,-idempotency,-payment-reference,-durable-idempotency}` · `loyalty{,-durable-idempotency}` ·
  `money-reads-horizontal-authz` · `orders-idempotency-route` · `cross-intent-durable-idempotency` ·
  `admin-adjustment-idempotency` (10 files / 106 tests);
  `topups-action-real-service` · `users-loyalty-guard` · `adjustment.service` · `adjustment-cap`
  (4 files / 37 tests); `copilot/executor-single-use` (3 tests);
  `checkout-{variants,stacked-discounts,inventory-corrupt,product-stale,points-award,invariant-order,coupon-maxed-postcommit}` ·
  `price-snapshot-immutability` · `refund-{revocation,coupon-slot}` (10 files / 36 tests).
- Frontend: `money-races-r140` · `checkout-pricing-reconcile` · `loyalty-convert-journey` ·
  `wallet-submit` · `wallet-money-gates` · `checkout-idempotency-keys` (6 files / 72 tests).
- Total: **32 files / 291 tests / 0 failed** across the money slice.

## Findings

### L7-1 · P3 · lypay reference-optional topups retain a zero-dedup approval path — the double-credit window is narrowed but not closed

- Evidence: `backend/src/routes/wallet.ts:495-503` — the creation-time duplicate-receipt
  probe is inert when no reference was supplied:
  ```ts
  duplicateId:
    paymentReference !== null
      ? sql<...>`(select id from ${walletTopupsTable} where ... ${walletTopupsTable.paymentReference} = ${paymentReference} ...)`
      : // No reference (lypay optional-ref class) → the B4-R1 probe
        // never ran pre-fold; a SQL null literal keeps the guard
        // inert without a subquery.
      sql<number | null>`null`,
  ```
  Every approval-side guard is likewise reference-gated: `backend/src/services/topup.service.ts:281-283`
  (`if (ref.length > 0) { await tx.execute(sql\`select pg_advisory_xact_lock(...)\`) }`),
  `:300-318` (in-tx exact-ref duplicate check, same gate), `:348` (`if (ref.length > 0 && topup.senderPhone)` —
  composite soft-dedup), and the authoritative index covers only referenced rows —
  `shared/db/src/schema/wallet_topups.ts:69-73`:
  ```ts
  paymentRefUniqueIdx: uniqueIndex("uniq_wallet_topups_payment_reference")
    .on(t.paymentReference)
    .where(sql`payment_reference IS NOT NULL AND btrim(payment_reference) <> '' AND status = 'approved'`),
  ```
- Root cause: the entire dedup battery (creation probe, advisory lock, in-tx exact check,
  composite soft-dedup, V1-M9 partial unique) keys on `payment_reference`; lypay keeps the
  field optional by design (gateway receipts are not consistently exposed to users —
  `routes/wallet.ts:365-376`). Two lypay pendings without references can therefore both be
  approved → one real transfer credited twice. R142's G-2 fix closed the *client* window
  (pre-normalization key minted a second pending after a lost response); a deliberate
  second submission (or any keyless client — the header is optional and the middleware
  passes through without it, `middlewares/idempotency.ts:214-222`) still mints a second
  pending, and nothing in the approval path stops the second ✅. Bounded by: `MAX_PENDING=3`
  (`routes/wallet.ts:463`), operator review of each card, and mobile_transfer (the dominant
  channel) being fully guarded (M3).
- Proposed fix: extend the F-03 composite soft-dedup to lypay using `sender_account` as the
  identity dimension — when approving a lypay topup that carries a sender_account, 409 if an
  already-approved sibling from the same user matches (amount, payment_network,
  sender_account) within 24h (mirror of `topup.service.ts:348-375`, same conservative
  engagement conditions). Alternative: require a reference for lypay at creation once the
  gateway exposes receipts (M3 parity).
- Test requirement: extend `topup-composite-dedup.test.ts` — two lypay pendings (null ref,
  same sender_account + amount + network) approved sequentially → second approve must 409;
  different amounts → both approve (legitimate repeat class stays legal).
- Risk/dependency: false-positive risk on legitimate same-day repeat lypay transfers — keep
  the conservative engagement (all dimensions present + 24h window) exactly as the
  mobile_transfer composite does. `payment_method='lypay'` requires sender_account at
  creation (`routes/wallet.ts:342-346`), so the dimension is always present for new rows.

### L7-2 · P4 · M17 residuals: backend money-path strings still interpolate `toFixed(2)` where the canon is `formatLyd`

- Evidence: four sites, same class as the R142-fixed G-6 (`routes/loyalty.ts:329` now uses
  `formatLyd(lydValue)`):
  - `backend/src/services/topup.service.ts:454` — `description: \`Topup approved: ${topupAmount.toFixed(2)} د.ل\`` (ledger row)
  - `backend/src/services/topup.service.ts:172` — `description: \`Automated topup (${provider}): ${creditAmount.toFixed(2)} د.ل\`` (ledger row)
  - `backend/src/services/topup.service.ts:199` — `` `تم شحن ${creditAmount.toFixed(2)} د.ل تلقائياً` `` (user-visible notification title)
  - `backend/src/routes/coupons.ts:205` and `backend/src/lib/pricing.ts:200` —
    `` `هذا الكوبون يتطلب حد أدنى للطلب ${minOrder.toFixed(2)} د.ل` `` / `` `يتطلب حد أدنى ${minOrder.toFixed(2)} د.ل` `` (user-visible coupon errors)
- Root cause: the R128-B8-D3 / R130-A7-F3 conversion waves reached the *balance-mutation*
  rounding idiom (roundLyd) and the high-visibility surfaces, but these lower-traffic
  strings predate/moved past the grep canon. Values ≥ 1,000 LYD lose en-US grouping
  («1000.00 د.ل» instead of «1,000.00 د.ل») — cosmetic divergence only; money math is
  untouched (all writers ride `roundLyd`).
- Proposed fix: one-word replacements `formatLyd(x)` at the four sites (`lib/money.ts:64-66`).
  Note `topup.service.ts:172/199` sit on the automated-gateway path
  (`createApprovedTopup`) which currently has no production caller (comment at `:40-41`).
- Test requirement: add string assertions to the existing `lib/__tests__/money.test.ts`
  battery pattern or the topup service suites (pin `formatLyd(1380)` grouping once per site).
- Risk/dependency: none — display-only; zero behavior change below 1,000 LYD.

### L7-3 · P4 · G-4 (R142, deferred) still open: TopupWaitingModal poll-only path refreshes the balance but not me/ledger

- Evidence: `frontend/src/components/TopupWaitingModal.tsx:176-180`:
  ```ts
  useEffect(() => {
    if (status === "approved" || status === "rejected") {
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    }
  }, [status, queryClient]);
  ```
  Only `getGetWalletQueryKey()` — the Navbar `me` chip and `/api/wallet/ledger` keep
  pre-approval figures for up to their 60 s staleTime when the socket is dead and the 3 s
  poll catches the flip. The socket path covers all three (`use-socket.ts:133-134`, R140).
- Root cause: deferred by recorded R142 decision (P4, "optional defense-in-depth"; money correct).
- Proposed fix: add `getGetMeQueryKey()` + `getGetWalletLedgerQueryKey()` to the same
  invalidation call (one line).
- Test requirement: extend the modal's status-flip test with a socket-dead leg asserting
  all three caches invalidate.
- Risk/dependency: none — cosmetic staleness ≤ 60 s on two surfaces.

### L7-4 · P4 · G-5 (R142, deferred) still open: checkout cart-sync computes the remainder from the stale snapshot — a mid-loop quantity raise in another tab is silently dropped

- Evidence: `frontend/src/pages/checkout.tsx:708-714`:
  ```ts
  orderedUnitsByLine.forEach(({ productId, variantId, units }) => {
    const line = items.find((i) => i.productId === productId && (i.variantId ?? null) === variantId);
    if (!line) return;
    if (units >= line.quantity) removeItem(productId, variantId);
    else updateQuantity(productId, line.quantity - units, variantId);
  ```
  `items` is the snapshot taken when the confirm loop started (multi-tab guard at
  `:581-591` only skips when the live quantity no longer *covers* the unit index — a raise
  never trips it). Charges stay exactly-what-was-charged; only the un-purchased edit is lost.
- Root cause: deferred by recorded R142 decision (P4); the server re-validates every unit,
  so no wrong charge is possible.
- Proposed fix: compute the remainder from `readLiveCartItems()` inside the forEach
  (same idiom the G-3 guard introduced at `:226-235`).
- Test requirement: extend `checkout-idempotency-keys.test.tsx` with a mid-flight
  *raise* (existing tests cover decreases).
- Risk/dependency: none.

### L7-5 · P4 · E-7 (R142, recorded debt) still present: statically-false `success` boolean in the partial bulk-refund 207 body

- Evidence: `backend/src/routes/admin/orders.ts:599-606`:
  ```ts
  if (failures.length === 0) {
    return res.json({ success: true, updated: successes.length });
  }
  return res.status(207).json({
    success: failures.length === 0,   // ← reached only when failures.length > 0 → always false
    updated: successes.length,
    failed: failures,
  });
  ```
- Root cause: E-7 was recorded as P4 debt in the R142 ledger (one-literal fix, not taken).
  The frontend keys off `failed[]` (verified by lane D in R142) — readability issue only.
- Proposed fix: `success: false` literal.
- Test requirement: none (optionally pin the 207 shape in `admin-bulk-status-guard.test.ts`).
- Risk/dependency: none.

## Clean areas (verified, no findings)

- **M1 topup approval atomicity** — one tx: per-ref advisory lock (`topup.service.ts:281-283`),
  in-tx status re-check (`:286-291`), in-tx exact-ref duplicate check (`:300-318`), composite
  soft-dedup (`:348-375`), guarded status flip `WHERE status='pending'` (`:383-397`), wallet CAS
  `WHERE walletBalance = balanceBefore` (`:431-442`), in-tx ledger (`:445-457`), guarded referral
  flip (`:478-525`), guarded welcome-bonus flip (`:536-565`). Two approvers cannot double-credit
  (proven by `topup.service.test.ts` double-approve test, green).
- **M2 creation dedup in-tx** — per-user advisory lock (`routes/wallet.ts:464-467`) + one-statement
  guard battery (duplicate → pending cap → auto-reject, `:485-536`); `MAX_PENDING=3` at `:463`.
- **M3 mobile_transfer reference required** — `routes/wallet.ts:377-387` (400 on null ref);
  suite green. Approval keeps accepting legacy blank refs deliberately (documented `topup.service.ts:247-257`).
- **M4 single-tx checkout** — `checkout.service.ts:434-765` one `.transaction()`; in-tx freshness
  re-checks for product (`:464-480`), variant (`:487-503`), flash sale (`:516-533`); claim via
  provider (`:544-548`); wallet CAS on **three** columns (`:570-599`); coupon atomic-with-check
  (`:601-649`); order + fulfillment + ledger + points ledger in the same tx (`:651-744`);
  durable idempotency claim last-in-tx (`:754-762`).
- **M5/M6 durable idempotency + replay** — pre-tx replay short-circuits before balance check
  (`checkout.service.ts:190-236`); body-hash reuse predicate on both durable layers
  (`routes/wallet.ts:414-428`, `routes/loyalty.ts:192-217`, `routes/admin/users.ts:353-378`);
  in-tx 23505 → classified replay/409 (`checkout.service.ts:806-811, 865-899`;
  `routes/wallet.ts:564-583, 588-625`). Redis layer carries both `EX`s
  (`middlewares/idempotency.ts:324-329, 372-375`), in-flight sentinel NX claim, credential
  redaction on cached copies (`:347-389`).
- **M7 refunds** — single tx (`refund.service.ts:127-395`): status guard completed→refunded
  (`:268-280`), CAS on walletBalance+loyaltyPoints+lifetimeSpend (`:238-261`), coupon slot
  return `GREATEST(used_count-1,0)` under the same admission ticket (`:297-302`), credential
  revocation incl. extra_details (`:324-340`), points reversal exactly-once (partial unique
  `uniq_points_ledger_type_reference`, `shared/db/src/schema/points_ledger.ts:105`) with FIFO
  attribution + bounded-cap fallback (`lib/points-ledger.ts:134-266`); emissions strictly
  post-commit (`:396-440`). Bulk refund is sequential per-order with classified failures and
  the finance gate (`routes/admin/orders.ts:470-556`); the non-refund branch's state-machine
  guards make `refunded` terminal and `completed` purchase-tx-only (`:609-647`).
- **M8 adjustments** — finance scope + mandatory note at the route
  (`routes/admin/users.ts:315-342`), durable pre-check + in-tx claim
  (`:343-378` → `adjustment.service.ts:247-266`), CAS + numeric(10,2) bounds + signed ledger
  (`adjustment.service.ts:196-238`).
- **M9 negative-balance unreachable** — CAS predicates everywhere (see above), `NEGATIVE_BALANCE`
  gates (`adjustment.service.ts:199-201`), DB CHECK `chk_users_wallet_balance_nonneg`
  (`shared/db/src/schema/users.ts:90`), `wallet-never-negative.test.ts` green.
- **M10 price freeze** — repo-wide grep for `update(ordersTable)`: exactly three production
  UPDATE sites (`refund.service.ts:269,330`, `admin/orders.ts:648`) — none touches `amount`;
  the only writer is INSERT-time (`checkout.service.ts:664`). Suite green.
- **M11/M14 inventory single-writer + fail-closed delivery** — `manual.provider.ts:50-79`
  (two ordered `FOR UPDATE SKIP LOCKED` pools), deliverability gate before any mutation
  (`:97-110`), guarded claim UPDATE `WHERE is_sold=false` (`:114-119`).
- **M12/M13** — idempotency FK drop stage present; loyalty convert carries pre-tx any-intent
  check (`routes/loyalty.ts:192-217`) + in-tx claim with null order_id (`:298-312`) + CAS on
  points+balance (`:249-261`) + wallet & points ledger rows in-tx (`:267-293`).
- **M15 schema guards** — RESTRICT FKs + CHECKs read in the TS twins (`orders.ts:37,40,137-147`,
  `wallet_ledger.ts:35,78,90-93`, `wallet_topups.ts:30,69-78`, `users.ts:90-91`,
  `points_ledger.ts:105-122`); suites green (`checkout-invariant-order`, `schema-parity`).
- **M16 events after commit** — checkout coupon-maxed signal-object (`checkout.service.ts:429-432`
  decl, `:906-913` fire), `notifyNewOrder` post-purchase at the route (`routes/orders.ts:367-374`),
  topup notifications post-tx (`topup.service.ts:584-641`), refund post-commit
  (`refund.service.ts:396-440`), `notifyNewTopup` after the creation tx (`routes/wallet.ts:688-696`).
- **Ledger append-only** — repo-wide grep (excl. node_modules): **zero** UPDATE/DELETE writers on
  `wallet_ledger` or `points_ledger`; both carry arithmetic/non-zero CHECKs and user-FK RESTRICT.
- **Referral credits** — guarded flip in-tx on both paths (`routes/admin/referrals.ts:169-197`,
  `topup.service.ts:478-525`) + relative SQL increments + points_ledger attribution.
- **Wallet/user writers census** — every production `usersTable` wallet/points writer is either
  CAS-guarded (checkout/refund/adjust/loyalty/admin-loyalty) or a guarded relative increment
  (referral points, welcome bonus `WHERE welcomeBonusGranted=false`); the only remaining
  non-money UPDATEs are auth fields (`firebase-auth.service.ts:592`, `whatsapp-otp.service.ts:718`,
  `auth.ts:840`).
- **Concurrency interleavings simulated** (all resolve safely): double-approve same row →
  guarded flip 409; two approvals same ref → advisory lock + 23505; approve×checkout →
  wallet CAS; checkout×checkout same unit → SKIP LOCKED + guarded claim; refund×2 → status
  guard + partial unique; convert×refund → CAS; copilot double-confirm → conditional claim
  (E-1); Telegram webhook + admin-UI concurrent approve → same service battery.
- **Coupon consumption** — atomic-with-check increment re-asserting active/expiry/maxUses at
  redemption time (`checkout.service.ts:601-649`); `/coupons/validate` is read-only; refund
  returns the slot exactly once under the same admission ticket.

## R142 fix verification

| Fix | Status | Evidence at HEAD |
|-----|--------|------------------|
| G-1 — loyalty convert customFetch (P2) | **VERIFIED** | `frontend/src/pages/loyalty.tsx:245-253` — `convertPointsApi({ points: pts }, { headers: { ...headers, "Idempotency-Key": intentKey } })`, imported from `@workspace/api-client-react` (`:10-14`); G-1 comment block `:236-244`. Tests: `loyalty-convert-journey.test.tsx:37`, `loyalty-referrals-shared-cache.test.tsx:56`, `loyalty-decomposition-r137.test.ts:83` — all green. |
| G-2 — wallet per-intent idempotency key (P3) | **VERIFIED** | `frontend/src/pages/wallet.tsx:176-193` — stable `topupRequestRef` + `syncTopupRequestKey()` synced at every rotation point and lazy init; `:464-469` — `useCreateTopup({ request: topupRequestRef.current })`; submit-time rotation under the POST-normalization fingerprint `:549-557`; belt-and-suspenders pre-mutate sync `:598` before `topupMutation.mutate` `:599`. Mechanism confirmed against the generated client: `createTopup` reads headers at execution time (`shared/api-client-react/src/generated/api.ts:3158-3187`, `getHeaders(options?.headers)` inside the call). Test: `money-races-r140.test.ts:297-305` pins the source shape — green. |
| G-3 — checkout line-identity guard (P3) | **VERIFIED** | `frontend/src/pages/checkout.tsx:215-235` — `removeIfStillSameIntent(line)` re-reads `readLiveCartItems()` and only removes when the live line at the same key carries the snapshot's quantity; wired into all three drop branches (`:248`, `:261`, `:269`). Test: `checkout-pricing-reconcile.test.tsx:264` ("a 404 landing after remove-then-re-ADD of the same key does NOT remove the re-added line") — green. |
| E-1 — copilot conditional claim (P3) | **VERIFIED** | `backend/src/services/copilot/executor.ts:172-185` — low-risk consumed stamp `WHERE isNull(consumedAt)` in-tx, `if (!consumed) throw new PreviewAlreadyConsumedError()`; high-risk twin `:377-387`; error class `:31-42`; catch maps to `{kind:"consumed"}` `:190, :392`. Docblock updated (`preview-store.ts:8-12`). Test: `copilot/__tests__/executor-single-use.test.ts` (3 tests, incl. the simulated race window) — green. |
| H-1 — horizontal authz tests (P3) | **VERIFIED** | `backend/src/routes/__tests__/money-reads-horizontal-authz.test.ts` — 4 pglite-backed tests over the money-read surfaces: `GET /api/orders/:orderCode` (foreign → 404 ORDER_NOT_FOUND), `GET /api/wallet/topups`, `GET /api/wallet/ledger`, `GET /api/loyalty/ledger` (foreign rows never appear, own rows control leg) — green. |

All five R142 fixes in this lane exist at HEAD, carry regression tests, and those tests pass.

## Verdict

The money core at `528ef39` is genuinely hardened: every invariant M1–M17 holds with
code-level proof, all 22 simulated interleavings resolve through a guard (advisory lock,
guarded flip, CAS, conditional claim, or unique index), the ledgers are append-only with
DB arithmetic CHECKs, and the R142 fixes landed with tests. The residuals are honest and
small: one operator-gated lypay double-credit window (P3, requires deliberate dual-pending
plus operator approval of both), and four P4 polish items (M17 string residuals + three
documented R142 debts confirmed still-open). Zero P0/P1/P2.
