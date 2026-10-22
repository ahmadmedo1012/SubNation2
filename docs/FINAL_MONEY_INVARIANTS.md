# FINAL_MONEY_INVARIANTS — R112 (2026-09-25)

> The money-surface contract of record for the final cutover. Every invariant
> below is **re-verified R183 (2026-10-22, the sixth full money audit: M1–M17
> re-walked at `72e287b7` with anchors re-derived — the M3 retirement
> recorded, the R158 topup-creation move and the R144-B2 migrate-stage
> decomposition re-pointed, suite counts re-measured)** — prior proofs: R134
> (2026-10-12, A4 — anchors re-derived at the R134 fix tree), R128
> (2026-10-10, `eb50024`), R118 (2026-10-06), `521234f` (R112),
> `ef3d0c3` (R117)** — and pinned
> to the exact regression suite that fails CI if it ever regresses. This is
> the checklist a future auditor (human or agent) starts from.

## 1. The invariants

| # | Invariant | Enforced where (source of truth) | Regression suite |
|---|---|---|---|
| M1 | **Topup approval is atomic** — status re-check, wallet credit, balance update, ledger entry, referral credit and welcome bonus ALL commit in ONE transaction; two approvers cannot double-credit | `services/topup.service.ts:277-617` (manual approval tx) — in-tx status re-check at `:289-295` + `UPDATE … WHERE walletBalance = balanceBefore` compare-and-swap at `:479-490` | `topup.service.test.ts` (8), `wallet-topups.test.ts` (34), `topups-action-real-service.test.ts` |
| M2 | **Topup creation dedup is in-transaction** — duplicate receipt refs and the MAX_PENDING battery are checked INSIDE the creation tx (no TOCTOU) | **moved R158** → `services/topup-create.service.ts:317` (tx + per-user `pg_advisory_xact_lock`), the one-guard-statement fold at `:348-375`, duplicate 409 at `:390-392`, `MAX_PENDING = 3` at `:316` (`routes/wallet.ts:250-266` now only delegates) | `wallet-topups-idempotency.test.ts` (5), `topup-composite-dedup.test.ts` (12) |
| M3 | **[RETIRED R154, recorded R183]** mobile_transfer payment references are **no longer hard-required** — the B4-R1 (r111) rejection branch was removed (`490597ce`); the duplicate-risk it guarded against is now surfaced as an **operator review signal**: a ref-less mobile_transfer with a matching (amount, network, sender) sibling pending or approved within 24h carries a `⚠ خطر تكرار محتمل` admin note + the Telegram card's ⚠ line — never a rejection | `services/topup-create.service.ts:367-372` (the `duplicateRiskIds` probe in the guard fold) + `:408-419` (parse → admin note); pinned from the review side in `wallet-topups.test.ts:560-835` | `wallet-topups-payment-reference.test.ts` (4 — now pins the RETIREMENT: whitespace-only and omitted references on mobile_transfer are accepted) |
| M4 | **Purchase is one atomic transaction** — inventory claim + balance debit + coupon consumption + order row commit together or not at all | `services/checkout.service.ts:439-440` — single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE` at `:412`; race-free selection INSIDE the tx via `:452-508` → `services/providers/manual.provider.ts:50-79` (`FOR UPDATE SKIP LOCKED`) | `checkout-claim-race.test.ts`, `checkout-idempotency.test.ts` (10), `checkout-variants / -stacked-discounts / -coupon-maxed-postcommit / -coupon-expiry-in-tx` |
| M5 | **Durable idempotency is replay-safe on every money route** — the same key replays the stored response (200/409 as documented) and NEVER double-charges; deleting the `EX` from either SET fails CI | `lib/idempotency.ts` + `lib/idempotency-body-hash.ts` + middleware `middlewares/idempotency.test.ts` (22, direct suite added r111); scoped key + body-hash reuse predicate at `checkout.service.ts:202-248` (A7-F4: hash match → replay, mismatch → classified 409) | `middlewares/__tests__/idempotency.test.ts`, `orders-idempotency-route.test.ts` (8 — +1 R183: the notification best-effort pin), `wallet-topups-durable-idempotency.test.ts`, `cross-intent-durable-idempotency.test.ts`, `loyalty-durable-idempotency.test.ts` (4) |
| M6 | **Checkout retry after a paid order replays ownership, never re-charges** — the retry path surfaces the owned order instead of a second debit | `checkout.service.ts:202-248` (F10 pre-tx replay lookup) + `replayOriginalOrder` at `:933+` | `checkout-idempotency.test.ts` (10) |
| M7 | **Refunds are transactional + points-race safe; events fire only after commit** | `services/refund.service.ts` (1 tx — `:127`-`:395`; post-commit emission principle at `:396-402`) | `refund.service.test.ts` (5), `refund-points-race.test.ts` (4), `refund-revocation / -coupon-slot / -extra-details`, `refund-reversal-precision.test.ts` |
| M8 | **Admin wallet adjustments are intent-keyed** — the same admin intent can never apply the balance delta twice | `services/adjustment.service.ts` (stable intent key, r99 fix) | `adjustment.service.test.ts` (9), `adjustment-cap.test.ts`, `admin-adjustment-idempotency.test.ts` (7 — +2 R183: the cross-subject collision pair) |
| M9 | **Negative-balance is unreachable** — debits are gated by balance checks in-tx; wallet math never writes a negative balance | checkout `INSUFFICIENT_BALANCE` + topup compare-and-swap + adjustment cap | covered by M1/M4/M8 suites + `wallet-topups.test.ts` + `wallet-never-negative.test.ts` (R123) |
| M10 | **Orders freeze their price** — `orders.amount` has ZERO update sites in the codebase (price snapshot, r102-proven) | `rg 'UPDATE.*orders'` → no amount writer exists | `price-snapshot-immutability.test.ts` (`:74` re-prices the product post-purchase and asserts `order.amount` stays frozen + the refund credits exactly the paid amount) — plus the r102 B-agent audit, re-verified r111 B4 + r112 + R118 |
| M11 | **Inventory claims are single-writer** — a unit is claimed exactly once across concurrent checkouts (scoped OR generic two-pool) | checkout in-tx claim + `FOR UPDATE`-shaped selection | `checkout-claim-race.test.ts`, `checkout-inventory-corrupt / -product-stale` |
| M12 | **The topup path cannot hit the historical FK failure** — `idempotency_keys.order_id` is polymorphic (orders/topups/loyalty); V1-M20 dropped the FK that 500'd topups | **moved R144-B2** → runtime stage `migrate/stages/02-points-idempotency-indexes.ts:40-96` (`applyIdempotencyDropOrderFkStage`; `migrate.ts` stays the orchestrator); drizzle chain `0013_wandering_mister_fear.sql` re-emit with `IF EXISTS` double-drop guard | `jobs/__tests__/migrate-v1m12.test.ts` (8) + `migrate-drizzle-0013.test.ts` (5); `wallet-topups-durable-idempotency.test.ts:240` (THE FK REGRESSION) + `topup-auto-guards.test.ts` (5) |
| M13 | **Loyalty convert is idempotent-durable** — the last bare money route closed (r102 V1-M19: nullable `order_id` + `reference_type`) | V1-M19 schema + convert route intent key | `loyalty-durable-idempotency.test.ts` (3) |
| M14 | **Duplicate-claim prevention on credentials** — claimed inventory rows transition atomically with the order; corrupt/stale products fail closed | checkout tx + `checkout-inventory-corrupt.test.ts` | same |
| M15 | **Money schema guards: user-FKs RESTRICT + arithmetic CHECKs live in all three mirrors** — migrate runtime stages (V1-M25/M26/M28/M29) = schema TS twins = drizzle chain `0018`/`0019` (**`0020_hot_mojo.sql` is the V1-M31 retention-index bundle, not a schema-guard file**), and the live DB carries them (R128-B4 live-verified: 4 RESTRICT FKs + 11 CHECKs) | **moved R144-B2** → `migrate/stages/02-points-idempotency-indexes.ts:387-522` (FK RESTRICT) + `:527-601` (CHECK) + `migrate/stages/03-domain-org-r135-wave.ts:11-118+` (referral family); `shared/db/schema/*` twins; drizzle 0018/0019 | the migrate suites (`v1m25` 9 / `v1m26` 7 / `v1m28` 6 / `v1m29` 4 / `drizzle-chain-apply` 5) + `schema-parity.test.ts` (26) — [`checkout-invariant-order.test.ts` pins the R122 no-order rule, NOT schema guards; re-cited R183] |
| M16 | **Money events fire only after commit** — no pre-commit emission can survive a rollback as a false positive | checkout signal-object (`checkout.service.ts:434-437` decl, `:918-928` post-commit fire); topup notifications post-tx (`topup.service.ts:633-701`); refund post-commit (`refund.service.ts:396-440`) | `checkout-coupon-maxed-postcommit.test.ts` (3), `telegram-webhook-topup-money-path.test.ts` (20) |
| M17 | **Every LYD display uses ONE formatting idiom** — en-US grouping + two decimals + «د.ل» on every surface; zero raw-`toFixed` LYD display regressions (residuals are USD/percent/SEO-plain-string, justified in-code) | frontend `formatCurrency` (`frontend/src/lib/utils.ts:22`, **265 refs** — R177 completed the honesty: `-0`→«0.00 د.ل», non-finite→«—») + backend `formatLyd`/`formatLydNumber` (`backend/src/lib/money.ts`, grouped since R128 — B8-D3; R177 non-finite guard) | UI suites; grep-audited R128-B4 §7 + R177 |

**R165 note (the order-group column, 2026-10-18):** `orders.order_group_id`
(V1-M35) is **informational-only** by contract — it never participates in
money math, idempotency claims, refunds, or inventory, so it adds NO
invariant and weakens none: M4 gains one column in the SAME transaction's
INSERT, M5/M6 are untouched (the body-hash predicate now also covers the
group — a re-minted token under a live unit key classifies 409), M10 has
zero new amount writers (pinned: amounts/balances identical with and
without the token). Money-slice re-verified at R165: backend 2,699 /
frontend **2,659 green across 286 files** [R166 correction: first
recorded here as 2,103 — the by-directory partial
(lib+hooks+components+pages); the full-suite run measures 286 files /
2,659, reconciling exactly with R163's 283/2,643 + R165's own +16. The
backend 2,699 is the same partial methodology — it excludes
`backend/src/__tests__` (15 files); a full recount is pending]
(`checkout-order-group` + `orders-order-group-route`
added to the suite index below).

## 2. The money-path suite index (47 files; re-verified R134, extended
R165, counts re-measured R183 — post-R183-diff: routes dir **86 files**
(85 at the audited `72e287b7` + this round's `checkout-provider-unavailable-r183`);
cart's variant-parity + half-cent blocks and `variant-availability-pricing`
were the R165 additions)

`backend/src/services/__tests__/`:
`topup.service` · `topup-auto-guards` · `topup-composite-dedup` ·
`topup-payment-reference` · `topup-referral-race` · `checkout-idempotency` ·
`checkout-claim-race` · `checkout-variants` · `checkout-stacked-discounts` ·
`checkout-coupon-maxed-postcommit` · `price-snapshot-immutability` (M10) ·
`checkout-inventory-corrupt` · `checkout-product-stale` ·
`checkout-points-award` · `checkout-invariant-order` (M15) ·
`checkout-order-group` (R165 — the group token through the real purchase:
replay-verbatim / re-mint-409 / N-units-one-group / group-never-money) ·
`wallet-never-negative` (M9, R123) · `refund.service` ·
`refund-points-race` · `refund-revocation` · `refund-coupon-slot` ·
`refund-extra-details` · `refund-reversal-precision` (R123) ·
`adjustment.service` · `adjustment-cap`

`backend/src/routes/__tests__/`:
`wallet-topups` · `wallet-topups-idempotency` ·
`wallet-topups-payment-reference` · `wallet-topups-durable-idempotency` ·
`wallet-topups-telegram-card` (the folded operator card, R123 E1) ·
`orders-idempotency-route` · `orders-credentials-serialization` ·
`orders-order-group-route` (R165 — the 37-char perimeter / GET surfaces /
legacy-null parity / the re-mint 409 through the REAL route hash) ·
`checkout` (route level) · `checkout-coupon-expiry-in-tx` ·
`coupons-validate` (the R123 cap-parity battery) ·
`telegram-webhook-topup-money-path` (R127, 12) ·
`telegram-webhook-audit-row` (R127) ·
`cross-intent-durable-idempotency` ·
`loyalty-durable-idempotency` · `admin-adjustment-idempotency` ·
`cart` (R133 A7-F2 GET/PATCH variant-pricing parity + R134 A4-F2
half-cent display pin) · `variant-availability-pricing` (R133 A7-F1)

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

- Drizzle journal: `0000 … 0027` sequential, drift-gate green
  (`drizzle-kit generate` → `git diff --exit-code` = clean). (R183: chain
  0027 = the R181 copilot-table drops — the newest mirror entry.)
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
# R183 measure: 288 files / 2,654 tests (the full backend suite; six chunks)
```
