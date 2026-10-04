# FINAL_MONEY_INVARIANTS — R112 (2026-09-25)

> The money-surface contract of record for the final cutover. Every invariant
> below is **proven from source at HEAD `521234f`** and pinned to the exact
> regression suite that fails CI if it ever regresses. This is the checklist
> a future auditor (human or agent) starts from.

## 1. The invariants

| # | Invariant | Enforced where (source of truth) | Regression suite |
|---|---|---|---|
| M1 | **Topup approval is atomic** — status re-check, wallet credit, and balance update commit in ONE transaction; two approvers cannot double-credit | `services/topup.service.ts:82-127` — in-tx re-check of topup status + `UPDATE … WHERE walletBalance = balanceBefore` compare-and-swap | `topup.service.test.ts` (6), `wallet-topups.test.ts` (28) |
| M2 | **Topup creation dedup is in-transaction** — duplicate receipt refs and the MAX_PENDING battery are checked INSIDE the creation tx (no TOCTOU) | `wallet.ts:383-406` — `eq(paymentReference, …)` inside the tx; `MAX_PENDING = 3` at `wallet.ts:365` | `wallet-topups-idempotency.test.ts` (5), `topup-composite-dedup.test.ts` (7) |
| M3 | **mobile_transfer topups REQUIRE a payment reference** — the last wallet-credit inflation window (B4-R1, r111) | `wallet.ts:349` rejects `mobile_transfer` with a null `payment_reference` | `wallet-topups-payment-reference.test.ts` (4) |
| M4 | **Purchase is one atomic transaction** — inventory claim + balance debit + coupon consumption + order row commit together or not at all | `services/checkout.service.ts:272-293` — single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE` at `:252`; race-free selection INSIDE the tx at `:255` | `checkout-claim-race.test.ts`, `checkout-idempotency.test.ts` (7), `checkout-variants / -stacked-discounts / -coupon-maxed-postcommit / -coupon-expiry-in-tx` |
| M5 | **Durable idempotency is replay-safe on every money route** — the same key replays the stored response (200/409 as documented) and NEVER double-charges; deleting the `EX` from either SET fails CI | `lib/idempotency.ts` + middleware `middlewares/idempotency.test.ts` (14, direct suite added r111); scoped key at `checkout.service.ts:141-166` | `middlewares/__tests__/idempotency.test.ts`, `orders-idempotency-route.test.ts` (6), `wallet-topups-durable-idempotency.test.ts`, `cross-intent-durable-idempotency.test.ts`, `loyalty-durable-idempotency.test.ts` (3) |
| M6 | **Checkout retry after a paid order replays ownership, never re-charges** — the retry path surfaces the owned order instead of a second debit | `checkout.service.ts:141-166` (F10 pre-tx replay lookup) | `checkout-idempotency.test.ts` |
| M7 | **Refunds are transactional + points-race safe; events fire only after commit** | `services/refund.service.ts` (1 tx; `:271` post-commit emission principle) | `refund.service.test.ts` (5), `refund-points-race.test.ts` (4), `refund-revocation / -coupon-slot / -extra-details` |
| M8 | **Admin wallet adjustments are intent-keyed** — the same admin intent can never apply the balance delta twice | `services/adjustment.service.ts` (stable intent key, r99 fix) | `adjustment.service.test.ts` (9), `adjustment-cap.test.ts`, `admin-adjustment-idempotency.test.ts` (4) |
| M9 | **Negative-balance is unreachable** — debits are gated by balance checks in-tx; wallet math never writes a negative balance | checkout `INSUFFICIENT_BALANCE` + topup compare-and-swap + adjustment cap | covered by M1/M4/M8 suites + `wallet-topups.test.ts` |
| M10 | **Orders freeze their price** — `orders.amount` has ZERO update sites in the codebase (price snapshot, r102-proven) | `rg 'UPDATE.*orders'` → no amount writer exists | pinned by the r102 B-agent audit; re-verified r111 B4 + r112 |
| M11 | **Inventory claims are single-writer** — a unit is claimed exactly once across concurrent checkouts (scoped OR generic two-pool) | checkout in-tx claim + `FOR UPDATE`-shaped selection | `checkout-claim-race.test.ts`, `checkout-inventory-corrupt / -product-stale` |
| M12 | **The topup path cannot hit the historical FK failure** — `idempotency_keys.order_id` is polymorphic (orders/topups/loyalty); V1-M20 dropped the FK that 500'd topups | runtime chain `migrate.ts:1099-1153` (V1-M20); drizzle chain `0013_wandering_mister_fear.sql` re-emit with `IF EXISTS` double-drop guard | `v1m12` migration tests (apply M12+M19+M20 together); `topup-auto-guards.test.ts` (5) |
| M13 | **Loyalty convert is idempotent-durable** — the last bare money route closed (r102 V1-M19: nullable `order_id` + `reference_type`) | V1-M19 schema + convert route intent key | `loyalty-durable-idempotency.test.ts` (3) |
| M14 | **Duplicate-claim prevention on credentials** — claimed inventory rows transition atomically with the order; corrupt/stale products fail closed | checkout tx + `checkout-inventory-corrupt.test.ts` | same |

## 2. The money-path suite index (29 files, all green at HEAD)

`backend/src/services/__tests__/`:
`topup.service` · `topup-auto-guards` · `topup-composite-dedup` ·
`topup-payment-reference` · `topup-referral-race` · `checkout-idempotency` ·
`checkout-claim-race` · `checkout-variants` · `checkout-stacked-discounts` ·
`checkout-coupon-maxed-postcommit` · `checkout-coupon-expiry-in-tx` ·
`checkout-inventory-corrupt` · `checkout-product-stale` · `refund.service` ·
`refund-points-race` · `refund-revocation` · `refund-coupon-slot` ·
`refund-extra-details` · `adjustment.service` · `adjustment-cap`

`backend/src/routes/__tests__/`:
`wallet-topups` · `wallet-topups-idempotency` ·
`wallet-topups-payment-reference` · `wallet-topups-durable-idempotency` ·
`orders-idempotency-route` · `orders-credentials-serialization` ·
`checkout` (route level) · `cross-intent-durable-idempotency` ·
`loyalty-durable-idempotency` · `admin-adjustment-idempotency`

`backend/src/middlewares/__tests__/`:
`idempotency.test.ts` (14 — the direct middleware suite; r111 closed the
dangerous-green gap where `EX` deletion on either SET passed silently)

Full-suite proof at HEAD: **backend 157 files / 1447 tests / 0 failed**;
the money files above are the money slice of that number.

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
(`refund.service.ts:271` established the principle; checkout adopted it at
`checkout.service.ts:276-293` with the signal-object pattern). Checkouts
that later fail in-tx therefore cannot leave phantom "order placed"
signals.

## 5. How to re-prove this document in one command

```bash
pnpm --filter @workspace/api-server exec vitest run --reporter=dot
# 157 files / 1447 tests / 0 failed  ← the money slice is section 2
```
