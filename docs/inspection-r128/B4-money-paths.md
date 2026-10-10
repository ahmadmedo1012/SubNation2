# R128-B4 — Money-Path Re-Verification (the fourth full money audit)

**Agent:** R128-B4 · **Date:** 2026-10-10 · **Tree:** main @ `7d469d5` (clean, read-only mandate held) · **Lane:** re-verify every money path end-to-end after the 99-commit R122–R127 wave.

**Method:** full read of the money services (topup / checkout / refund / adjustment), the route layers that ride them (wallet, orders, loyalty, admin/{topups,users,referrals,orders,coupons}, telegram-webhook), the idempotency/ledger/pricing/audit libs, the schema twins + drizzle chain 0018/0020 + migrate.ts V1-M25…M31, and the admin money UI (users wallet dialog, topups queue). Live DB verified **read-only** (SELECT/SHOW only, `BEGIN READ ONLY` session, URL from the round-tooling store, masked throughout — never printed). Live-API probes: none beyond the unauthenticated surface (all money routes are auth-gated; B3 already probed the mounted envelopes this round). 3 targeted vitest suites run (27/27 green).

**Inputs honored (not re-reported):** FINAL_MONEY_INVARIANTS.md (R118-stamped), R125-A1 (admin money UX), R127-R1 §1 (telegram audit rows + bulk/approveAll flips + referral credit — all re-confirmed held at HEAD), R128-B5 §5 (test-quality map: 10/14 intact, 4 strengthened, 0 lost — this report verifies the CODE, not the tests), R128-B1 item 6 (B-11 cart-stock snapshot open), R128-B3 (telegram money-path attacks from the security lane — cited, not repeated).

---

## 1. Invariant scorecard (cite → code → test)

Cite status is against **HEAD `7d469d5`**; the canon was last re-verified R118 (2026-10-06) — four money-schema-affecting waves (R122 M25/M26, R123 money battery, R125, R127) landed since. Test status cites B5's map (re-read, not re-run, except the 3 suites in §6).

| # | Invariant | Cite status (doc → HEAD) | Code status at HEAD | Test status |
|---|---|---|---|---|
| M1 | Topup approval atomic | **STALE** — tx `:254-436` → **`:265-556`**; in-tx re-check `:267-272` → **`:277-283`**; CAS `:407-421` → **`:407-433`** | **HELD** — advisory-xact-lock on ref (`:273-275`) + in-tx status re-check (`:277-283`) + exact-ref dup (`:292-310`) + composite soft-dedup (`:340-367`) + guarded status flip `WHERE status='pending'` (`:375-389`) + CAS balance `WHERE walletBalance=balanceBefore` (`:407-433`) + ledger + referral + welcome-bonus ALL in the one tx | intact + strengthened (B5; `topup.service` 6 + `topups-action-real-service`) — re-ran adjacent suites green |
| M2 | Creation dedup in-tx | **STALE +4** — `:462-478` → **`:466-486`**; MAX_PENDING `:444` → **`:448`** | **HELD** — per-user `pg_advisory_xact_lock` (`wallet.ts:448-451`), same-ref+amount pending dup (`:466-486`), MAX_PENDING=3 (`:488-490`) all inside the creation tx | intact |
| M3 | mobile_transfer ref required | **STALE +3** — `:380` → **`:383`** | **HELD** — `:383` rejects `mobile_transfer` with null ref; normalization at `:279-293` (trim, ≤100, blank→null keeps legacy class approvable — the documented boundary) | intact + strengthened |
| M4 | Purchase one atomic tx | **EXACT** — `:294` tx, `:253` pre-tx INSUFFICIENT_BALANCE, `:403-407` provider claim, `manual.provider.ts:50-79` | **HELD** — single `.transaction()` at `:293-615`; freshness re-checks in-tx (product `:323-339`, variant `:346-362`, flash sale `:375-392`); triple-column CAS `:446-455`; coupon atomic-with-check `:480-496`; order + fulfillment + ledger + points + idem-claim all in-tx | intact + strengthened (points-award arm) |
| M5 | Durable idempotency everywhere | drifts ±2 — `checkout.service.ts:141-166` → `:142-168` (resolves) | **HELD** — `lib/idempotency.ts` full guard battery (scope/claim/42P01-latch); in-tx claims: checkout `:610-612`, topup create (wallet.ts), loyalty convert `:245-253`, adjustment `:237-255`, admin users PATCH pre-check + service claim; 23505 → replay/409, never a second charge | intact |
| M6 | Retry replays ownership | drifts ±2 — `:141-166` → `:142-168` | **HELD** — pre-tx replay lookup `:152-168` + claim-conflict re-replay `:715-730`; `replayOriginalOrder` `:759-790` is read-only and ownership-checked (`userId` predicate `:766`) | intact |
| M7 | Refunds tx + points-race safe; events post-commit | **EXACT** tx `:126`-`:391`; post-commit `:393-397` → `:394-400` (resolves) | **HELD** — one tx; full-write-set CAS (wallet+points+lifetimeSpend `:225-251`); precise award reversal via points_ledger FIFO replay (`:177-203`); status-guarded flip; post-commit emission principle verified | intact |
| M8 | Admin adjustments intent-keyed | resolves (no line cites) | **HELD** — admin-scoped key pre-check (users route) + **in-tx durable claim** `adjustment.service.ts:237-255`; CAS `:200-212`; finite/cap guards `:97-101,:196-198`; NEGATIVE_BALANCE `:189-191` | intact |
| M9 | Negative-balance unreachable | resolves | **HELD** — checkout pre-tx `:253` + CAS; topup credit CAS; adjustment `balanceAfter<0` throw; loyalty convert dual-column CAS; **live DB: 0 users with wallet_balance<0**; DB CHECKs (M26 family) as bypass-writer backstop | intact (+ `wallet-never-negative` re-ran green) |
| M10 | Orders freeze price | resolves (`rg 'UPDATE.*orders'` → none) | **HELD** — the only three `ordersTable` UPDATE sites are status writes (admin bulk `orders.ts:650`, refund flip/revocation `refund.service.ts:265,326`); zero `amount` writers; un-refund/un-complete state-machine holes closed (r4 F-1/F3/F2 guards, `orders.ts:612-649`) | intact |
| M11 | Inventory claims single-writer | resolves | **HELD** — two-pool `FOR UPDATE SKIP LOCKED` in-tx (`manual.provider.ts:50-77`); OUT_OF_STOCK charge-time fail **before any money mutation** (fast-fail `:266-271` pre-tx; authoritative in-tx) | intact |
| M12 | Topup FK polymorphic (V1-M20) | **EXACT** — `migrate.ts:1099-1153` | **HELD** — V1-M20 stage verbatim at `:1099-1153`; 0013 re-emit with `IF EXISTS` double-drop guard; **live DB: topups crediting normally** (no 23503 class) | intact + strengthened (7 migrate suites) |
| M13 | Loyalty convert durable | resolves | **HELD** — fresh in-tx read + dual-column CAS (`loyalty.ts:168-198`), ledger + points_ledger attribution rows, in-tx durable claim `:247-255`, friendly 409 pre-check `:156-163` | intact + award arm |
| M14 | Dup-claim prevention | resolves | **HELD** — claim transitions atomically with the order (same tx); corrupt inventory fails closed pre-charge (`INVENTORY_CORRUPT` → full rollback, post-tx operator alert) | intact |
| M15* | *(supplementary)* Money CHECK + RESTRICT schema (V1-M25/M26/M28/M29) | not in canon (post-R122) | **HELD** — triple-mirror verified (§4) + **live DB confirms** all four money user-FKs `confdeltype='r'` by canonical name and all 11 money CHECKs present (§5) | strengthened (B5) |
| M16* | *(supplementary)* Money events fire only after commit | `:393-397`/`:276-293` resolves (`:276-291`) | **HELD** — checkout signal-object (`:288-291` decl, `:737-744` post-commit fire); topup notifications post-tx (`:572-625`); refund post-commit (`:394+`) | intact |
| M17* | *(supplementary)* Every LYD display uses one formatting idiom | not in canon | **HELD** — `formatCurrency` (utils.ts:22) ×167 refs; §7 grep: zero raw LYD `toFixed` display regressions (residuals are USD-cost/factor/percent/SEO-plain-string — all justified in-code) | n/a (UI) |

**Scorecard: 14/14 invariants HELD in code.** Cite rot: **3 stale cite families (M1, M2, M3)** — the third occurrence of the merge-silently-invalidates-cites class (M1's is materially misleading: the doc's tx range ends at `:436`, exactly where the ledger/referral/welcome blocks begin, so a doc-following auditor would read a truncated transaction).

---

## 2. Attack log (tried → result)

All attacks are code-walkthrough + existing-suite verified (concurrency attacks verified against the guarded-UPDATE/advisory-lock/CAS layers; no production mutations).

| # | Attack | Result |
|---|---|---|
| A1 | **Coupon stacking** — flash % + coupon % > cap | **HELD** — `evaluateTotalDiscountCap` (pricing.ts:347-366) applied in `computePricing` (:238-246) AND in `/coupons/validate` (routes/coupons.ts:217-227, the R123 parity fix) — same `getActiveFlashSale` source; rejection is a clean 400 (`total_discount_cap`), never a silent clamp |
| A2 | **Coupon reuse past maxUses** — concurrent checkouts on last slot | **HELD** — atomic-with-check `UPDATE … WHERE used_count < max_uses AND is_active AND (expires_at IS NULL OR expires_at > now)` (checkout.service.ts:480-496); loser → `COUPON_EXHAUSTED` + full rollback incl. claim revert; `chk_coupons_used_le_max` DB CHECK is the bypass-writer backstop (live: overuse=0) |
| A3 | **Quantity tamper quote→charge** | **HELD structurally** — `CreateOrderBody` has NO quantity field (api-zod generated:777-787); one checkout = one unit = one server-computed price; cart quantity lives only in UI, each line charged separately at server price |
| A4 | **Negative/zero amounts** — checkout & topup | **HELD** — checkout `INVALID_PRICE` gate (finite, >0, discount ≥0 — `:240-247`); topup zod min 0.01 + handler `<=0 \|\| >10000` → 400 + DB `chk_topups_amount_pos`/`chk_orders_amount_pos`; adjustment finite+numeric(10,2)-cap guards |
| A5 | **Rounding (roundLyd idiom)** | **HELD** — pricing rounds via `roundLyd` (pricing.ts:316,326-327); gateway topup credit `roundLyd` (topup.service.ts:80). Residual `toFixed(2)` at balance-mutation boundaries (checkout :274, topup :421/:146, refund :172, convert :141) is **safe by construction** (operands are already-2dp numerics; the AUD103 half-cent hazard only arises from percent math) — see F5 note |
| A6 | **Idempotency-key coverage on every mutation** | **HELD** — durable in-tx claims on checkout, topup-create, loyalty-convert, admin-adjust (service), referral-credit + bulk routes (Redis layer, documented pass-through in no-Redis shape with the durable backstop where delta-based); points-set is absolute-value (replay = no-op by `delta !== 0` skip) |
| A7 | **Concurrent checkout on last unit (double-sell)** | **HELD** — `FOR UPDATE SKIP LOCKED` two-pool in-tx claim; both buyers can never hold one unit; claim + charge + order atomic |
| A8 | **Charge-time stock exhaustion (B-11 UX edge)** — what does the buyer see, is money held? | **Behavior verified precisely:** stale-cart checkout → pre-tx fast-fail `OUT_OF_STOCK` (`:266-271`) or in-tx claim failure; route maps to Arabic 409 «المنتج غير متوفر حالياً» (orders.ts:229-233); **no money held** — balance is only written inside the tx after a successful claim (CAS UPDATE `:426-455`); nothing to roll back. B-11 (cart snapshot honesty) remains open as the **UX** gap B1 ranked it |
| A9 | **Double-approve race** — telegram retry + admin click concurrently on one topup | **HELD** — both funnel into `TopupService.approve`: advisory-xact-lock on ref serializes, in-tx status re-check + guarded flip `WHERE status='pending'` → exactly one 200, one 409; loser's tx fully rolls back (status flip + credit + ledger). B3 re-attacked this lane from the transport side (held) |
| A10 | **Amount tamper creation→approval** | **HELD** — approve takes `(id, note, reviewedBy)` only; amount read server-side from the DB row (`topup.service.ts:420`); no payload amount anywhere on the approval path (admin route `admin/topups.ts:158-167`, telegram `:168-179`) |
| A11 | **Reviewed_by / audit-trail completeness** | **HELD at HEAD** — manual approve/reject → `topup.approve`/`topup.reject` audit rows (admin/topups.ts:159,196); telegram → same actions (telegram-webhook.ts:199-209, R127); admin wallet+points → `user.update` with before/after values (users.ts:389-399); refund → `order.bulk_refund` (:577) incl. per-order breakdown; referral credit → `referral.credit` (:215); bulk status → `order.bulk_status_update` (:707) with skip-reason census. `reviewedBy` attribution live-verified on rows (§5). Residuals: F3 (pre-R27-deploy telegram rows), F4 (dormant gateway path — by charter) |
| A12 | **Self-referral** | **HELD structurally** — referrer lookup runs BEFORE the user row exists; `referredById !== created.id` belt in all three auth channels (firebase :486, telegram :152, whatsapp); a signup can never cite its own not-yet-existing code |
| A13 | **Circular referral** | **HELD** — `referredBy` is set-once at creation, **zero update sites** repo-wide (grep); existing users can never re-enter a code, so A→B→A cycles are unreachable |
| A14 | **Referral credit on refunded/cancelled order** | **HELD by policy shape** — credit keys on FIRST APPROVED TOPUP (not on purchase): guarded pending→credited flip in the topup tx (`topup.service.ts:469-517`); order refund does not touch referral events (documented policy; the credit and the purchase are independent money streams, refund reversal handles only its own award remainder) |
| A15 | **Double referral credit on replay** | **HELD** — `referral_events.referee_id` is UNIQUE (schema, enforced live) + guarded `WHERE status='pending'` flip + `onConflictDoNothing` insert; admin credit route: same guarded flip in tx (referrals.ts:167-194) → 409 on race loser; live DB: 0 referral events, 0 double welcome_bonus, 0 double purchase_award per order |
| A16 | **ReferredBy freshness (R123 fix)** | **HELD** — award keys on the FRESH in-tx `freshUser.referredBy` (:410 read, :454 award, :580 post-tx notify carries the same value out) — the stale pre-tx outer read is comment-quarantined (:450-453) |
| A17 | **Points-only admin edit without confirm / audit (R126 fix)** | **HELD** — confirm now fires for `walletValue !== null OR pointsChanged` with a dedicated points-only sentence incl. LYD equivalent (users.tsx:601-626); note mandatory for either field; intent key spans the one PATCH; R125-A1 P2-2 (wallet input label) also fixed at HEAD (`htmlFor="user-edit-wallet"` :1152/:1182) |
| A18 | **Admin adjusts wallet without audit row** | **HELD** — audit row fires whenever `walletResult \|\| loyaltyApplied` (users.ts:389-399); a body with neither → 400 «لا توجد تعديلات» (:378); ledger + points_ledger rows commit in the same tx as the mutation (the reconstructable trail) |
| A19 | **Un-refund / status-laundering** (refunded→completed→refunded again) | **HELD** — terminal-state guards: refunded never leaves refunded; completed is purchase-tx-owned; pending↔failed only (orders.ts:612-649 + honest skip census) |
| A20 | **Negative points / huge points mint** | **HELD** — integer 0..10,000,000 bound (users.ts:196-204) + finance scope + mandatory note + CAS + same-tx `points_ledger` `admin_set` row (reason NOT NULL enforced by `chk_points_ledger_reason_for_manual`) |

## 3. Checkout end-to-end walk (scope-2 summary)

Cart (client, price-snapshot reconcile at mount) → `POST /api/orders` (zod `CreateOrderBody`: product/variant/coupon only) → `purchase()`: pre-tx durable replay lookup (M6) → product+variant resolve (fail-closed on foreign id) → `computePricing` (single source; cap; roundLyd) → money-integrity gate → balance check → stock fast-fail → **single tx**: freshness re-checks (product/variant/sale) → provider claim (`FOR UPDATE SKIP LOCKED`, deliverability gate, encrypted-at-rest credentials pass-through) → triple-column CAS debit + tier/award math → coupon atomic-with-check → order insert (immutable `amount`, `delivered_*` copies) → provider_fulfillments row → wallet_ledger `purchase` → points_ledger `purchase_award` (partial-unique per order) → durable idem claim → commit → post-commit events (coupon-maxed signal, sockets, notifications). Failure taxonomy: every in-tx refusal maps to a stable retryable reason with Arabic copy; **no path mutates money before the claim or after a refusal**.

## 4. Schema triple-mirror (scope-6)

| Object | migrate.ts (runtime, owns live) | schema TS twin | drizzle chain |
|---|---|---|---|
| Money user-FKs RESTRICT (V1-M25) | `applyMoneyLedgerUserFkRestrictStage` :1495-1584 (orphan-probe → def-probe → converge) | `onDelete:"restrict"` ×4 (orders:38, wallet_ledger:35, wallet_topups:31, points_ledger:70) | 0018 (RESTRICT conversions) |
| Money CHECKs (V1-M26) | `applyMoneyArithmeticChecksStage` :1612-1662 (count-then-add) | `check()` twins: chk_orders_amount_pos (orders:131), chk_ledger_arithmetic (wallet_ledger:75) | 0018 :53,:56 (expressions verbatim) |
| referral RESTRICT + CHECK (V1-M28/M29) | :1803-1910 / :1915-2023 | referral_events.ts:18,:22,:37 | chain carries |
| Retention indexes (V1-M31) | `applyRetentionPruneIndexesStage` :2133-2235 | declared in the 7 schema files | 0020 (8 × `IF NOT EXISTS`, names 1:1 — R127-R1 compared predicates) |

**Live DB confirms the runtime shape** (§5) — the three mirrors agree with each other AND with production. The one known textual nuance (idx_admin_alerts_unread `DESC NULLS LAST` vs `DESC`) is immaterial on a `notNull` column (R127-R1 §3). Journal: `0000…0020` sequential; chain stays declarative-only (drizzle-push fenced).

## 5. Live DB check (read-only; DONE, not source-only)

Connection string located in the round-tooling store (`scripts/restore_env_vars.json` — same DSN the R118 live probes used), masked in every output; `BEGIN READ ONLY` session; SELECT/SHOW only. Statement timeout 20s on the probe itself. **No writes, no SET.**

- **Lifecycle sane:** orders 9 (7 completed / 2 refunded — no pending/failed zombies), topups 18 (12 approved / 5 rejected / 1 pending), wallet_ledger 30, points_ledger 6, referral_events 0, users 21, audit_logs 52.
- **Zero money-integrity violations:** 0 negative balances; 0 orders/topups with amount ≤ 0; 0 ledger/points arithmetic violations (both identities); 0 zero-amount ledger rows; 0 orphan money rows (FK-sane); 0 double `purchase_award` per order; 0 double `welcome_bonus` per user; 0 coupon overuse (`chk_coupons_used_le_max` held); topup amounts within 1..7000 LYD.
- **Latest money rows well-shaped:** ledger #40 purchase 159.84 = 200.00−40.16 ✓; approved topups carry `reviewed_by` (both attribution families live: admin `ahmadmedo`, telegram `@rhAhmed2011`).
- **Schema guards live:** 4 money user-FKs `confdeltype='r'` by canonical name (V1-M25 held live); all 11 money CHECKs present incl. `chk_orders_amount_pos`, `chk_ledger_arithmetic`, points quartet, `chk_referral_status` (V1-M26/M28/M29 held live).
- **0020 indexes:** all 8 exist on live (V1-M31 applied).
- **`statement_timeout` = 15s** (session default; SHOW is a read — no SET run).
- **Audit rows:** `topup.approve` ×8, `user.update` ×8, `order.bulk_refund` ×2, `order.credentials_view` ×1, `topup.reject` ×1 — no anomalous actions, no money action missing that HEAD-code wouldn't write (see F3 for the pre-R127-deploy telegram window).

## 6. Suites run (3/3 green, ≤3 budget)

`telegram-webhook-topup-money-path` (12) · `checkout-idempotency` (7) · `wallet-never-negative` (8) — **27/27 passed** at HEAD (covers the R127 money path, M5/M6, M9).

## 7. Money UI surfaces (scope-8)

`formatCurrency` (frontend/src/lib/utils.ts:22) is the single LYD idiom — 167 non-test references. Raw-`toFixed` grep across frontend non-test files: **13 files, all justified** — percentages/rates/ms (system, orders stats, products, risk), USD cost column `fmtUsd` (ProductVariantsDialog:65-67, deliberate `$` for the internal cost field), factor trims (`fmtFactor`), cart *computations* that are then rendered through `formatCurrency` (cart.tsx:73→315), and `seo-builders.ts:138` (schema.org machine-readable plain strings). **No LYD display regression from the R122-R127 wave.**

## 8. Findings

### F1 [P2 — doc-accuracy, the money canon] FINAL_MONEY_INVARIANTS.md M1/M2/M3 cites stale; M1's tx range is materially misleading
**Evidence:** M1 cites `topup.service.ts:254-436` (manual approval tx) — at HEAD the transaction is **`:265-556`**; the doc range ends exactly where `insertLedgerEntry` begins (`:436`), so a doc-following auditor reads a transaction that appears to end after the balance CAS, missing that the ledger entry, referral credit, and welcome bonus all commit in the same tx (the strongest part of the invariant). Sub-cites: re-check `:267-272`→`:277-283`, CAS `:407-421`→`:407-433`. M2 `:462-478`→`:466-486` (MAX_PENDING `:444`→`:448`); M3 `:380`→`:383`. Cause: R116 reviewedBy block + R123 fresh-read block shifted the file after the R118 re-stamp — third occurrence of the merge-invalidates-cites class. **The invariants all HOLD** — only the citations rotted. **Fix:** one doc commit: re-stamp header (R128 proofs), correct the five line references, optionally fold the M15-M17 supplementary rows into the table. **Effort S.**

### F2 [P3 — doc] The canon's §2 "money-path suite index" (32 files) omits the R123-R127 additions
**Evidence:** ≥10 money-path test files exist at HEAD that the index doesn't list: `checkout-points-award`, `checkout-invariant-order`, `wallet-never-negative`, `refund-reversal-precision`, `telegram-webhook-topup-money-path`, `telegram-webhook-audit-row`, `topups-action-real-service` (BE) + `topups-bulk-note`, `users-wallet-confirm` (+70), coupons-validate battery. The header's "counts move every round" note mitigates, but §2 is presented as the canonical slice map. **Fix:** fold into the F1 doc commit. **Effort S.**

### F3 [P3 — deploy-verification] Pre-R127 telegram approvals carry no audit_logs rows (row-level `reviewed_by` is their only trail)
**Evidence:** live topups #20/#21 (approved 2026-10-07 by `@rhAhmed2011`) have `reviewed_by` set but no `topup.approve` audit row — they predate the R127 code that writes it (last live audit row 2026-10-08; R127 committed 2026-10-09). At HEAD the code writes the row on every successful telegram money action (R127-R1 §1 verified). Not a code defect — a **post-deploy verification item**: after the R127 build ships, tap one telegram approve and confirm the `topup.approve` row lands (and B3-F2's CSV guard rides the same ship). **Effort S (checklist line).**

### F4 [P4 — by-chararter, noted] Dormant gateway auto-credit path writes no audit_logs row
**Evidence:** `TopupService.createApprovedTopup` (topup.service.ts:58-209) — full guard battery (0.01..5000, roundLyd, advisory lock, in-tx dup, CAS, ledger) but no `writeAuditLog` — documented "no production caller today (tests only)". `audit_logs` is chartered as the **admin**-action trail; the wallet_ledger row + `reviewed_by=null` topup row are the money trail for automated credits. If a real gateway is ever wired here, decide then whether system-actor rows belong in audit_logs. **No action now.**

### F5 [P4 — latent hazard, no live exposure] `toFixed(2)` persists at balance-mutation boundaries while roundLyd is the pricing idiom
**Evidence:** checkout.service.ts:274, topup.service.ts:146/:421, refund.service.ts:172, loyalty.ts:147 — all currently safe by construction (operands are already-2dp numerics; binary-float dust cannot reach a half-cent case by addition/subtraction of 2dp values; `pointsToConvert/100` is exact). The hazard: a future writer computing a balance delta from **unrounded percent math** at one of these sites would silently reintroduce the AUD103 class. **Fix (optional hardening):** swap the five sites to `roundLyd` (identical results today, hazard-proof tomorrow) + a one-line comment at money.ts. **Effort S.**

## 9. Verified-OK (no finding)

1. **Topup approval atomicity battery** (M1) — five independent layers, all in one tx.
2. **Checkout single-transaction discipline** (M4) — freshness re-checks, triple-column CAS, atomic-with-check coupon, post-commit events.
3. **Durable idempotency** (M5) — every delta-based money mutation has an in-tx claim; 23505 → replay/409, never a double charge.
4. **Orders price immutability** (M10) — zero `amount` writers; terminal-state machine airtight.
5. **Inventory single-writer** (M11) + charge-time OUT_OF_STOCK holds no money.
6. **Topup FK polymorphism** (M12) — cite exact; live topups crediting.
7. **Loyalty convert** (M13) — dual-column CAS + dual ledger attribution + durable claim.
8. **Admin adjustment family** (M8 + R126) — finance scope, mandatory note, confirm covers points-only, intent-key lifecycle, audit row with values.
9. **Referral family** (A12-A16) — self/circular structurally impossible, set-once `referredBy`, fresh-read fix held, unique referee event, guarded flips.
10. **Schema triple-mirror** (M15) — migrate/schema-TS/chain agree; live DB proves the runtime shape (RESTRICT FKs + CHECKs + 0020 indexes).
11. **Money formatting** (M17) — one idiom, 167 refs, zero LYD regressions.
12. **Live DB** — every integrity query returned zero violations; ledgers reconstructable; attribution present.

## 10. Verdict

**14/14 canon invariants + 3 supplementary rows: ALL HELD at code level; live DB fully consistent with the triple-mirror schema; 20/20 attacks held.** The wave added guards, not gaps. The real cost of the 99-commit wave is **documentation rot**: the money canon's M1 citation now under-describes its own strongest invariant (F1) — one S-sized doc commit restores it.
