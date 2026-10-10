# FINAL_MONEY_INVARIANTS — R112 (2026-09-25)

> The money-surface contract of record for the final cutover. Every invariant
> below is **re-verified R128 (2026-10-10, R128-B4 — the fourth full money
> audit: 14/14 HELD, 20/20 attacks held, live DB read-only clean) at the
> round-close code tree `eb50024`** — prior
> proofs: R118 (2026-10-06), `521234f` (R112), `ef3d0c3` (R117) — and pinned
> to the exact regression suite that fails CI if it ever regresses. This is
> the checklist a future auditor (human or agent) starts from.

## 1. The invariants

| # | Invariant | Enforced where (source of truth) | Regression suite |
|---|---|---|---|
| M1 | **Topup approval is atomic** — status re-check, wallet credit, balance update, ledger entry, referral credit and welcome bonus ALL commit in ONE transaction; two approvers cannot double-credit | `services/topup.service.ts:265-556` (manual approval tx) — in-tx status re-check at `:277-283` + `UPDATE … WHERE walletBalance = balanceBefore` compare-and-swap at `:407-433` | `topup.service.test.ts` (6), `wallet-topups.test.ts` (28), `topups-action-real-service.test.ts` |
| M2 | **Topup creation dedup is in-transaction** — duplicate receipt refs and the MAX_PENDING battery are checked INSIDE the creation tx (no TOCTOU) | `wallet.ts:454-471` — `eq(paymentReference, …)` inside the tx; `MAX_PENDING = 3` at `wallet.ts:436` | `wallet-topups-idempotency.test.ts` (5), `topup-composite-dedup.test.ts` (7) |
| M3 | **mobile_transfer topups REQUIRE a payment reference** — the last wallet-credit inflation window (B4-R1, r111) | `wallet.ts:371` rejects `mobile_transfer` with a null `payment_reference` | `wallet-topups-payment-reference.test.ts` (4) |
| M4 | **Purchase is one atomic transaction** — inventory claim + balance debit + coupon consumption + order row commit together or not at all | `services/checkout.service.ts:294` — single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE` at `:253`; race-free selection INSIDE the tx via `:403-407` → `services/providers/manual.provider.ts:50-79` (`FOR UPDATE SKIP LOCKED`) | `checkout-claim-race.test.ts`, `checkout-idempotency.test.ts` (7), `checkout-variants / -stacked-discounts / -coupon-maxed-postcommit / -coupon-expiry-in-tx` |
| M5 | **Durable idempotency is replay-safe on every money route** — the same key replays the stored response (200/409 as documented) and NEVER double-charges; deleting the `EX` from either SET fails CI | `lib/idempotency.ts` + middleware `middlewares/idempotency.test.ts` (14, direct suite added r111); scoped key at `checkout.service.ts:142-168` | `middlewares/__tests__/idempotency.test.ts`, `orders-idempotency-route.test.ts` (6), `wallet-topups-durable-idempotency.test.ts`, `cross-intent-durable-idempotency.test.ts`, `loyalty-durable-idempotency.test.ts` (3) |
| M6 | **Checkout retry after a paid order replays ownership, never re-charges** — the retry path surfaces the owned order instead of a second debit | `checkout.service.ts:142-168` (F10 pre-tx replay lookup) | `checkout-idempotency.test.ts` |
| M7 | **Refunds are transactional + points-race safe; events fire only after commit** | `services/refund.service.ts` (1 tx — `:126`-`:391`; post-commit emission principle at `:394-400`) | `refund.service.test.ts` (5), `refund-points-race.test.ts` (4), `refund-revocation / -coupon-slot / -extra-details`, `refund-reversal-precision.test.ts` |
| M8 | **Admin wallet adjustments are intent-keyed** — the same admin intent can never apply the balance delta twice | `services/adjustment.service.ts` (stable intent key, r99 fix) | `adjustment.service.test.ts` (9), `adjustment-cap.test.ts`, `admin-adjustment-idempotency.test.ts` (4) |
| M9 | **Negative-balance is unreachable** — debits are gated by balance checks in-tx; wallet math never writes a negative balance | checkout `INSUFFICIENT_BALANCE` + topup compare-and-swap + adjustment cap | covered by M1/M4/M8 suites + `wallet-topups.test.ts` + `wallet-never-negative.test.ts` (R123) |
| M10 | **Orders freeze their price** — `orders.amount` has ZERO update sites in the codebase (price snapshot, r102-proven) | `rg 'UPDATE.*orders'` → no amount writer exists | `price-snapshot-immutability.test.ts` (`:74` re-prices the product post-purchase and asserts `order.amount` stays frozen + the refund credits exactly the paid amount) — plus the r102 B-agent audit, re-verified r111 B4 + r112 + R118 |
| M11 | **Inventory claims are single-writer** — a unit is claimed exactly once across concurrent checkouts (scoped OR generic two-pool) | checkout in-tx claim + `FOR UPDATE`-shaped selection | `checkout-claim-race.test.ts`, `checkout-inventory-corrupt / -product-stale` |
| M12 | **The topup path cannot hit the historical FK failure** — `idempotency_keys.order_id` is polymorphic (orders/topups/loyalty); V1-M20 dropped the FK that 500'd topups | runtime chain `migrate.ts:1099-1153` (V1-M20); drizzle chain `0013_wandering_mister_fear.sql` re-emit with `IF EXISTS` double-drop guard | `v1m12` migration tests (apply M12+M19+M20 together); `topup-auto-guards.test.ts` (5) |
| M13 | **Loyalty convert is idempotent-durable** — the last bare money route closed (r102 V1-M19: nullable `order_id` + `reference_type`) | V1-M19 schema + convert route intent key | `loyalty-durable-idempotency.test.ts` (3) |
| M14 | **Duplicate-claim prevention on credentials** — claimed inventory rows transition atomically with the order; corrupt/stale products fail closed | checkout tx + `checkout-inventory-corrupt.test.ts` | same |
| M15 | **Money schema guards: user-FKs RESTRICT + arithmetic CHECKs live in all three mirrors** — migrate.ts runtime stages (V1-M25/M26/M28/M29) = schema TS twins = drizzle chain `0018`/`0020`, and the live DB carries them (R128-B4 live-verified: 4 RESTRICT FKs + 11 CHECKs) | `migrate.ts:1495-1584` (FK RESTRICT stage), `:1612-1662` (CHECK stage), `:1803-2023` (referral family), `shared/db/schema/*` twins, drizzle chain 0018/0020 | the 7 migrate suites + `checkout-invariant-order.test.ts` |
| M16 | **Money events fire only after commit** — no pre-commit emission can survive a rollback as a false positive | checkout signal-object (`checkout.service.ts:288-291` decl, `:737-744` post-commit fire); topup notifications post-tx (`topup.service.ts:572-625`); refund post-commit (`refund.service.ts:394-400`) | `checkout-coupon-maxed-postcommit.test.ts`, `telegram-webhook-topup-money-path.test.ts` (12) |
| M17 | **Every LYD display uses ONE formatting idiom** — en-US grouping + two decimals + «د.ل» on every surface; zero raw-`toFixed` LYD display regressions (residuals are USD/percent/SEO-plain-string, justified in-code) | frontend `formatCurrency` (`frontend/src/lib/utils.ts:22`, ~167 refs) + backend `formatLyd`/`formatLydNumber` (`backend/src/lib/money.ts`, grouped since R128 — B8-D3) | UI suites; grep-audited R128-B4 §7 |

## 2. The money-path suite index (43 files; locations re-verified R128)

`backend/src/services/__tests__/`:
`topup.service` · `topup-auto-guards` · `topup-composite-dedup` ·
`topup-payment-reference` · `topup-referral-race` · `checkout-idempotency` ·
`checkout-claim-race` · `checkout-variants` · `checkout-stacked-discounts` ·
`checkout-coupon-maxed-postcommit` · `price-snapshot-immutability` (M10) ·
`checkout-inventory-corrupt` · `checkout-product-stale` ·
`checkout-points-award` · `checkout-invariant-order` (M15) ·
`wallet-never-negative` (M9, R123) · `refund.service` ·
`refund-points-race` · `refund-revocation` · `refund-coupon-slot` ·
`refund-extra-details` · `refund-reversal-precision` (R123) ·
`adjustment.service` · `adjustment-cap`

`backend/src/routes/__tests__/`:
`wallet-topups` · `wallet-topups-idempotency` ·
`wallet-topups-payment-reference` · `wallet-topups-durable-idempotency` ·
`wallet-topups-telegram-card` (the folded operator card, R123 E1) ·
`orders-idempotency-route` · `orders-credentials-serialization` ·
`checkout` (route level) · `checkout-coupon-expiry-in-tx` ·
`coupons-validate` (the R123 cap-parity battery) ·
`telegram-webhook-topup-money-path` (R127, 12) ·
`telegram-webhook-audit-row` (R127) ·
`cross-intent-durable-idempotency` ·
`loyalty-durable-idempotency` · `admin-adjustment-idempotency`

`backend/src/routes/admin/__tests__/`:
`topups-action-body` (R118-A1 body contract) ·
`topups-action-real-service` (R123-E1 approve/reject through the real
money path)

`backend/src/middlewares/__tests__/`:
`idempotency.test.ts` (14 — the direct middleware suite; r111 closed the
dangerous-green gap where `EX` deletion on either SET passed silently)

`frontend/src/pages/admin/__tests__/`:
`users-wallet-confirm.test.tsx` (the admin wallet/points confirm dialog —
M8's UI arm, R126)

Full-suite proof at 521234f (R112): **backend 157 files / 1447 tests /
0 failed**; the money files above are the money slice of that number.
(Counts move every round — R127 recorded 240 files / 2,221 tests, R128
recounted 240 at HEAD. See `docs/history/inspection-r118/` for the R118
record. The money slice itself is indexed above.)

## 3. Migration ordering truth (r112 re-verified)

- Drizzle journal: `0000 … 0013` sequential, drift-gate green
  (`drizzle-kit generate` → `git diff --exit-code` = clean).
- The runtime chain (`migrate.ts`, probe-based, idempotent — steady-state
  boots execute zero DDL) owns the live database; the drizzle chain mirrors
  it. V1-M20 exists in BOTH (the 0013 re-emit carries the `IF EXISTS` guard
  so chain-built and runtime-built databases both converge).
- r111 T3 (live DB): exactly 4 non-destructive migrations pend the first
  r112 boot; **V1-M20 is mandatory before the FIRST topup** on that boot.
- Rollback law (see `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`): never
  roll back past the r108 migration state — pre-r108 code re-creates the
  FK (M12 regression) and re-enables the PG-lease Neon-killer.

## 4. The events-after-commit rule

Every money mutation emits its domain events (Socket.IO wallet/order
updates, Telegram alerts, risk signals) **after** the transaction commits —
a pre-commit emission surviving a rollback would be a false positive
(`refund.service.ts:394-400` established the principle; checkout adopted it at
`checkout.service.ts:276-291` with the signal-object pattern). Checkouts
that later fail in-tx therefore cannot leave phantom "order placed"
signals.

## 5. How to re-prove this document in one command

```bash
pnpm --filter @workspace/api-server exec vitest run --reporter=dot
# 157 files / 1447 tests / 0 failed at 521234f (R112)  ← the money slice is section 2
```
