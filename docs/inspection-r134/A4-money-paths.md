# R134-A4 — Money paths: M1–M17 re-walk + A7-F4 implementation scoping

**Tree:** `5d5227c` (R133, deployed). **Mode:** read-only — no code changes,
no commits, no test runs, no live money operations, no production writes.
**Method:** full re-read of `checkout.service.ts`, `topup.service.ts`,
`refund.service.ts`, `adjustment.service.ts`, `wallet.ts` (topup creation +
idempotency lanes), `loyalty.ts` (convert), `cart.ts`, `orders.ts` (POST +
bulk admin), `admin/users.ts` (adjustment lane), `admin/orders.ts` (bulk
refund loop), `lib/{idempotency,money,pricing,ledger}.ts`,
`middlewares/idempotency.ts`, `manual.provider.ts`, `jobs/{idempotency-retention,alertLogger}.ts`,
`migrate.ts` (stage chain + registration), `shared/db/src/schema/idempotency-keys.ts`
(+ users/orders/wallet_ledger CHECK twins), the drizzle chain
(`0018`–`0020` + journal + 0020 snapshot), plus
`git diff fd702d6..5d5227c` on every backend/shared money file (the R130→R134
delta is fully enumerated in §4).

**Verdict: 17/17 invariants HELD. 0 P0 · 0 P1 · 0 P2 · 3 P3/P4 doc-hygiene
findings + 1 P4 pre-existing residual.** The money core is unchanged in
structure since the R130 walk; the only backend money deltas since `fd702d6`
are R130's own fixes (A7-F1 variant family, A7-F3 roundLyd completion) and
the R133 A7-F2 cart parity fix — all verified landed and pinned. No new
money route, no new wallet-credit/debit path, no new unrounded
balance-mutation arithmetic.

---

## 1. Mandate 1 — the M1–M17 re-walk (each: verdict + current line cite + drift)

The doc's table cites were last refreshed at R128 (`eb50024`). R130's own
insertions (the `firstClaimableVariant` block in checkout, the A7-F3 comment
blocks in topup/refund/checkout) moved lines; measured drift below.

| # | Verdict | Current anchor (verified by full read this round) | Doc cite | Drift |
|---|---|---|---|---|
| M1 | **HELD** | `topup.service.ts:267-562` — ONE tx: advisory lock `:275-277`, in-tx status re-check `:280-285`, dup-ref guard `:294-312`, composite soft-dedup `:342-369`, guarded status flip `:377-391`, fresh balance read `:409-421`, CAS wallet UPDATE `:425-436`, ledger `:439-451`, referral credit `:457-521`, welcome bonus `:530-560` | `:265-556`, re-check `:277-283`, CAS `:407-433` | +2…+18 (A7-F3 comments) |
| M2 | **HELD** | `wallet.ts:436` `MAX_PENDING = 3`; in-tx same-receipt guard `:454-470` inside the per-user advisory-lock tx `:437-443`; auto-reject heuristic + insert + claim all in-tx `:472-543` | `:454-471`, `:436` | ±1 — accurate |
| M3 | **HELD** | `wallet.ts:371` — `mobile_transfer` + null `paymentReference` → 400 (creation-only enforcement, pre-fix rows stay approvable per B4-R1) | `:371` | exact |
| M4 | **HELD** | `checkout.service.ts:335` single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE` `:292`; in-tx freshness battery `:348-434` (clock → product → variant → flash sale); claim via `provider.fulfill` `:445-460` → `manual.provider.ts:50-79` (two ordered `FOR UPDATE SKIP LOCKED` pools); full-write-set CAS debit `:471-500`; atomic coupon `:502-550`; order insert `:552-586`; ledger `:611-625`; points ledger `:632-645`; in-tx idem claim `:655-657` | `:294` tx, `:253` balance, `:403-407` | +39…+42 (A7-F1 insert) — manual.provider cite exact |
| M5 | **HELD** | `lib/idempotency.ts` (42P01 latch, scoping, 23505 classifier); scoped key + pre-tx replay `checkout.service.ts:183-199`; wallet `wallet.ts:403-425` (200 + `Idempotent-Replayed`); loyalty 409 `loyalty.ts:158-168`; adjustment 409 `admin/users.ts:343-353` + `adjustment.service.ts:236-254`; middleware `middlewares/idempotency.ts` (R122 canonical body hash, R118 two-sided in-flight 409) | scoped key `checkout.service.ts:142-168` | +41 |
| M6 | **HELD** | pre-tx replay lookup `checkout.service.ts:190-198` (runs FIRST, before pricing/balance — the INSUFFICIENT_BALANCE-on-retry short-circuit) + post-23505 winner reconstruction `:760-775`; `replayOriginalOrder` `:804-835` (ownership re-checked, `idempotentReplay: true`) | `:142-168` | +41 |
| M7 | **HELD** | `refund.service.ts:127-395` — ONE tx: status guards `:148-157`, precise points reversal `:199-225`, full-write-set optimistic lock `:238-261`, guarded status flip `:268-280`, coupon slot return `:297-302`, credential revocation `:324-340`, points ledger `:354-367`, wallet ledger `:369-381`; events strictly post-commit `:397-440` | tx `:126-:391`, post-commit `:394-400` | +1…+7 |
| M8 | **HELD** | `adjustment.service.ts` — stable admin-scoped intent key claimed IN tx `:236-254` (23505 → classified 409), finite/magnitude bounds `:94-100`, resulting-balance bounds `:192-197`, CAS `:199-211`, ledger same-tx `:215-227`; route pre-check `admin/users.ts:343-353` | (module-level) | n/a |
| M9 | **HELD** | Debit gates: checkout `:292` + CAS `:491-500`; adjustment `NEGATIVE_BALANCE` `:138-140`/`:188-190`; loyalty points floor `loyalty.ts:187-189`; topup/refund credit-only. DB backstops: `chk_users_wallet_balance_nonneg` + `chk_users_loyalty_points_nonneg` (`schema/users.ts:91-92`) + `chk_ledger_arithmetic` (`schema/wallet_ledger.ts:76`, chain 0018) | (suite-indexed) | n/a |
| M10 | **HELD** | Repo-wide `update(ordersTable)` census (non-test): exactly 3 — `admin/orders.ts:650` `set({ status })` (no amount), `refund.service.ts:269` (status+refund_* snapshot), `refund.service.ts:330` (credential nulling). **ZERO `amount` writers.** | (grep-proof) | n/a |
| M11 | **HELD** | `manual.provider.ts:50-79` two-pool SKIP LOCKED claim + guarded flip `:114-119`; fast-fail `checkout.service.ts:305-310` is advisory only | `:50-79` | exact |
| M12 | **HELD** | V1-M20 `migrate.ts:1099-1155` (DROP CONSTRAINT IF EXISTS + any-name DO-block sweep); drizzle re-emit `0013_wandering_mister_fear.sql`; schema TS declares NO `.references()` (`idempotency-keys.ts:37-38`) | `:1099-1153` | ±2 — accurate |
| M13 | **HELD** | `loyalty.ts:151` roundLyd convert value, `:158-168` pre-tx claimed-409, `:200-212` dual-column CAS, `:218-244` both ledger rows, `:249-262` in-tx `loyalty.convert` claim (23505 → ConflictError 409) | (V1-M19 + route) | n/a |
| M14 | **HELD** | deliverability gate `manual.provider.ts:84-110` (fail-closed, `INVENTORY_CORRUPT` → post-rollback operator alert `checkout.service.ts:708-723`); claim + order one tx | (same) | n/a |
| M15 | **HELD** | V1-M25 FK RESTRICT `migrate.ts:1495-1584` (orphan probe → alert-skip; definition probe; canonical boot names); V1-M26 arithmetic CHECKs `applyMoneyArithmeticChecksStage:1612` (cited range `:1612-1662` accurate); V1-M28/M29 referral family `:1803-2023` (`applyReferralFksRestrictStage:1831`, `applyDomainCheckConstraintsStage:1945`); schema twins verified (`orders.ts:38,41,131`, `wallet_ledger.ts:76`, `users.ts:91-92`); chain mirror `0018_large_speedball.sql:53-56` | `:1495-1584`, `:1612-1662`, `:1803-2023` | exact/±2 |
| M16 | **HELD** | checkout signal-object decl `:330-333` → post-commit fire `:782-789`; topup notifications post-tx `topup.service.ts:578-635` (referralCredited/welcomeGranted gate on in-tx flags); refund `:397-440` (logAdminAlert + provider release both after commit); money alert family unchanged since R130 (see §4) | `:288-291`/`:737-744` (checkout), `topup.service.ts:572-625` | +42…+45 / +6…+10 |
| M17 | **HELD** | frontend `formatCurrency` `frontend/src/lib/utils.ts:22` (en-US grouping + «د.ل», now ~190 refs); backend `formatLyd`/`formatLydNumber` `lib/money.ts:59-66`; R130→R134 frontend money-display delta (cart.tsx/checkout.tsx/product.tsx) all rides `formatCurrency` / `computeFlashSalePrice` | `utils.ts:22`, `lib/money.ts` | exact |

**Walk result: 17/17 HELD, zero money-structure changes since the R130
proof.** The A7-F3 roundLyd completion (7 sites) is confirmed in-place at
`adjustment.service.ts:123,147,213`, `loyalty.ts:195`,
`checkout.service.ts:316,465`, `refund.service.ts:223`,
`topup.service.ts:545` — every balance-mutation boundary now rides
`roundLyd`. A fresh repo-wide toFixed census (§3 F2/F3) found **no NEW
unrounded balance-mutation arithmetic since R130**; the two residuals are
pre-existing and classified.

### A4-F1 [P4 — doc] FINAL_MONEY_INVARIANTS.md line cites drifted up to +45 lines (M1/M4/M5/M6/M7/M16)

The table's source-of-truth cites still point at the R128 tree. R130's own
insertions moved every checkout cite by +39…+45 (the `firstClaimableVariant`
block at `checkout.service.ts:139-167` + A7-F3 comment blocks) and the
topup/refund cites by +1…+18. Spot-verified stale pairs (doc → current):
M4 `:294`→`:335`, `:253`→`:292`; M5/M6 `:142-168`→`:183-199`; M16
`:288-291`→`:330-333`, `:737-744`→`:782-789`; M1 `:407-433`→`:421-436`;
M7 `:394-400`→`:397-403`; M16-topup `:572-625`→`:578-635`. The wallet.ts /
manual.provider.ts / migrate.ts / utils.ts cites are still exact. **Fix
sketch (one edit, no code):** refresh the seven stale cite pairs in the M1,
M4, M5, M6, M7, M16 rows to the anchors in the table above and stamp the
header "re-verified R134 (A4) at `5d5227c`". Per the audit brief, cite drift
is itself a finding — a future auditor starting from the doc would land on
the wrong lines for 6 of 17 invariants (none dangerously: all drift is
forward into adjacent same-function code, verified by this walk).

---

## 2. Mandate 2 — A7-F4 implementation spec: durable idempotency `body_hash`

**Problem being closed (R130 A7-F4, verified still true at HEAD):** the
Redis middleware's R122 body-hash defense never fires in production (no
Redis — `middlewares/idempotency.ts:238-248` passes through). The durable
`idempotency_keys` row stores NO body fingerprint, so within the 48h
retention a client reusing one Idempotency-Key with a DIFFERENT body gets
the original result replayed (200 + `Idempotent-Replayed`) instead of the
designed 409. Money-safe (no second charge, scoping + ownership re-check
hold — M5/M6 suites prove it), but the client's record diverges from the
platform's.

### (a) Table + column

`idempotency_keys` (created V1-M12; schema twin
`shared/db/src/schema/idempotency-keys.ts:48-80`; 0020 snapshot
`meta/0020_snapshot.json:1877-1913`):

```sql
ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS body_hash VARCHAR(64);  -- sha256 hex = 64 chars
```

- **Nullable, no default** — expand-first. NULL means "legacy claim, written
  pre-deploy" → replay on match-by-key (today's behavior); the NULL
  population ages out with the 48h retention prune
  (`jobs/idempotency-retention.ts:17,49-57`) — the transition window is
  ≤48h by construction, no backfill needed or wanted.
- Schema twin: `bodyHash: varchar("body_hash", { length: 64 })` in
  `idempotency-keys.ts` (after `referenceType`), with the module doc
  extended (R134/A7-F4 paragraph).

### (b) Every WRITER path that inserts an idempotency claim (complete enumeration, grep-verified)

`claimIdempotencyKey` (`lib/idempotency.ts:199-207`) has exactly 4
production call sites — all must now pass the hash:

| # | Site | referenceType | Body to hash |
|---|---|---|---|
| W1 | `services/checkout.service.ts:656` — in purchase tx, after order+ledger | `"order"` (default) | the purchase body (see (c)) |
| W2 | `routes/wallet.ts:524` — in topup-create tx | `"topup.create"` | the topup submission body |
| W3 | `routes/loyalty.ts:251` — in convert tx | `"loyalty.convert"` | the convert body |
| W4 | `services/adjustment.service.ts:238` — in adjust/setBalance tx | `"admin.adjustment"` | the adjustment body |

No other writer exists (tests + the migration stage itself are the only
other `idempotencyKeysTable` inserters). Signature change:
`claimIdempotencyKey(client, scopedKey, orderId, referenceType = "order", bodyHash?: string | null)` —
additive trailing optional so every existing 3-4-arg call (incl. tests)
stays byte-identical.

**Hash source — one shared primitive:** export the R122 canonical
serializer + hasher from the middleware
(`middlewares/idempotency.ts:109-140` — `canonicalJsonStringify` +
`bodyHash`) into `lib/idempotency-body-hash.ts` (or
`lib/idempotency.ts`), and have the middleware import it back — ONE
definition of "the same request", so the durable 409 fires exactly when
the Redis one would have. **Pass the hash from the ROUTE layer**
(`req.body`, post-`express.json`), not re-derived inside the services —
the services receive parsed/normalized inputs and would silently define a
second equivalence relation:
- `routes/orders.ts:191` — add `idempotencyBodyHash: canonicalBodyHash(req.body)` to the `CheckoutService.purchase({...})` call (mirror of the existing `idempotencyKey` pass-through); extend `CheckoutInput` (`checkout.service.ts:126-137`).
- `routes/wallet.ts` — compute at the top of the POST handler (next to `scopeIdempotencyKey`, `:403`).
- `routes/loyalty.ts:158` — same.
- `routes/admin/users.ts:343` — same; thread into `AdjustOptions.idempotencyBodyHash` (`adjustment.service.ts:68-79`).
- Known edge to document in-code: a client that re-submits a
  semantically-equal body with cosmetic changes (extra unknown field;
  `10.555` re-sent as `10.56` after learning the rounding) hashes ≠ and
  gets the 409. This is the SAME semantics the Redis layer has today —
  cross-layer consistency is the point.

### (c) The exact pre-tx lookup predicate change (hash match → replay; mismatch → 409)

Change the two lookup helpers to return the row, not a projection:

- `findIdempotentOrderId(scopedKey, referenceType)` (`lib/idempotency.ts:123-156`) →
  `{ orderId: number; bodyHash: string | null } | null` (select `bodyHash`
  alongside `orderId`).
- `findIdempotencyClaimed(scopedKey)` (`lib/idempotency.ts:164-183`) →
  `{ key: string; bodyHash: string | null } | null` (truthiness still works
  for the existing `if (await ...)` callers, but see the 409 branch below).

Then, at all **six** lookup sites, the predicate is:

```
row exists
  └─ row.bodyHash === null            → legacy claim → REPLAY (today's behavior; ages out in 48h)
  └─ row.bodyHash === expectedHash    → REPLAY (200 + Idempotent-Replayed / the intent's existing replay shape)
  └─ row.bodyHash !== expectedHash    → 409 IDEMPOTENCY_KEY_REUSE
```

The six sites and their mismatch arms:

1. `checkout.service.ts:190-198` (pre-tx): mismatch → new failure envelope
   `{ ok: false, reason: "CONCURRENCY_ERROR", code: "IDEMPOTENCY_KEY_REUSE", message: <the middleware's exact Arabic reuse message> }`
   — the route (`orders.ts`) maps it to 409. (Reuse the middleware's 409
   body verbatim — `middlewares/idempotency.ts:276-285`, code
   `IDEMPOTENCY_KEY_REUSE` — so clients see ONE shape whether Redis is up
   or not.)
2. `checkout.service.ts:768-773` (post-23505 winner): same comparison
   before `replayOriginalOrder`; mismatch → the same 409 envelope instead
   of replaying a winner that was a different body.
3. `wallet.ts:405-424` (pre-tx): mismatch → 409 reuse envelope (NOT the
   200 replay); match/null → existing `formatTopup` replay.
4. `wallet.ts:549-561` (post-23505 winner): same comparison.
5. `loyalty.ts:159-168` (pre-tx `findIdempotencyClaimed`): mismatch → 409
   with the reuse code; match/null → the existing "already converted" 409
   (both 409 — assert distinct `code`/message in tests).
6. `admin/users.ts:344-353` (pre-tx): mismatch → 409 reuse; match/null →
   the existing "already applied" 409.

**Invariant to preserve (money-safety net if the hash ever disagrees with
reality):** a mismatch NEVER falls through to a fresh mutation at sites
1/3 — that would re-open the exact divergence being closed. It is always
the classified 409.

### (d) Migration stage + mirrors

- **Runtime stage — V1-M32** `applyIdempotencyBodyHashStage` in
  `backend/src/migrate.ts`, appended to the chain registration directly
  after `applyRetentionPruneIndexesStage()` (`migrate.ts:4111`) with the
  standard header comment. Shape: the V1-M30 column-drop probe inverted —
  catalog-probe `information_schema.columns` for
  `table_name='idempotency_keys', column_name='body_hash'` → if absent,
  plain `ALTER TABLE ... ADD COLUMN body_hash VARCHAR(64)` (probe-first
  keeps the steady-state zero-DDL contract; the V1-M19/M23
  `ADD COLUMN IF NOT EXISTS` belt-on-plain-probe idiom at `migrate.ts:518-519`
  is the precedent for keeping both). No data touched, no default, no
  backfill — pure expand; nothing for the V1-M9 count-probe discipline to
  gate.
- **Drizzle mirror:** the `bodyHash` schema-twin column (a) + a new chain
  entry **0021** via `drizzle-kit generate` (journal idx 21, snapshot) —
  the drift gate must end clean: `drizzle-kit generate` → "No schema
  changes" → `git diff --exit-code -- shared/db` clean. The mirror emits
  the same `varchar(64)` nullable shape.
- **Ordering/laws honored:** expand-first (nullable add — no lock rewrite,
  no rewrite of readers); probe-gated (zero DDL on every steady-state
  boot); **no `db:push` ever** (the `push` script is guarded by
  `shared/db/scripts/guard-drizzle-push.mjs` — keep it that way); **Neon
  never rolls back** (no destructive statement exists in the stage; the
  rollback runbook's "never past r108" floor is untouched).
- The stage changes the migration fingerprint → first post-deploy boot
  runs the full reconcile once and applies it; steady state returns to
  zero DDL.

### (e) Test surfaces to pin it (existing files — extend, don't fork)

| File | New cases |
|---|---|
| `backend/src/services/__tests__/checkout-idempotency.test.ts` | same key + different product body → 409 envelope, never a second order/debit; same key + same body (reordered JSON keys) → replay; pre-seeded NULL-hash row → replay (legacy window) |
| `backend/src/routes/__tests__/orders-idempotency-route.test.ts` | HTTP shape: 409 + `code: "IDEMPOTENCY_KEY_REUSE"` + no `Idempotent-Replayed` header; 200 + header on the true replay |
| `backend/src/routes/__tests__/wallet-topups-durable-idempotency.test.ts` | same key + different amount → 409 reuse; same body → 200 replay; NULL-hash row → replay |
| `backend/src/routes/__tests__/loyalty-durable-idempotency.test.ts` | same key + different points → reuse-409 ≠ already-converted-409 (distinct code) |
| `backend/src/routes/__tests__/admin-adjustment-idempotency.test.ts` | same key + different delta → 409 reuse |
| `backend/src/routes/__tests__/cross-intent-durable-idempotency.test.ts` | referenceType filter still holds with hash present (orders-vs-topups key reuse stays classified, now by BOTH type and hash) |
| `backend/src/middlewares/__tests__/idempotency.test.ts` | if the canonical serializer moves to lib, keep the direct 14 green + one import-parity test (middleware hash === lib hash) |
| `backend/src/jobs/__tests__/migrate-v1m12.test.ts` (or new `migrate-v1m32.test.ts`, the V1-M24+ per-stage convention) | stage idempotence (apply ×2), column shape (`varchar(64)`, nullable), probe no-op on second run; apply M12+M19+M32 together as the harness already does for M19 |

**Sizing:** ~1 column + 1 stage + 1 chain entry + 4 writer args + 6
predicate branches + 1 shared hasher export; the claims/replays/scoping
machinery is untouched. Suggest landing the lib-hash export + middleware
import swap first (pure refactor, direct-suite green), then the stage +
schema twin + 0021, then the predicate branches + tests.

---

## 3. New findings (fresh-eyes, ranked)

### A4-F2 [P4 — pre-existing residual, first-filed] cart display pricing re-implements the flash-sale percent math with the raw toFixed idiom

`backend/src/routes/cart.ts:83-85` —
`salePrice = +(basePrice * (1 - discountPercent / 100)).toFixed(2)`.
The canonical stage (`lib/pricing.ts:314-317`
`computeFlashSalePrice = roundLyd(listPrice * (1 - d/100))`) exists and is
used by products.ts + checkout; `pricing.ts:27-29` says pricing.ts is "the
*only* place the discount math should live". A 2dp base with a whole-percent
sale hits the exact half-cent class money.ts documents: 89.99 × 50% =
44.995 → binary double 44.994999… → toFixed(2) **44.99**, roundLyd
**45.00** — the cart line (and `subtotal`/`total` at `:99`/`:156`, derived
from it) shows one cent less than the catalog and the charge. Display-only
(checkout re-quotes server-side; the frontend never calls GET/PATCH
/api/cart — only `DELETE /api/cart` at `frontend/src/pages/cart.tsx:133`);
pre-existing since the original cart routes (`baff5d0`), missed by the
R123-E1 and R130-A7-F3 censuses because it is display math, not a
balance mutation. **Fix sketch (one line + import):** `const salePrice =
discountPercent > 0 ? computeFlashSalePrice(basePrice, discountPercent) :
null;` and optionally `roundLyd` the `subtotal`/`total` folds — pinned by
a half-cent case in `cart.test.ts`.

### A4-F3 [P4 — pre-existing, safe-by-construction, footnote] computePricing's final subtraction is the last raw toFixed at a charge-producing boundary

`backend/src/lib/pricing.ts:290` — `+(basePrice - discountAmount).toFixed(2)`.
Both operands arrive roundLyd'd to 2dp, so the difference is 2dp-exact in
decimal and cannot land on a half-cent; safe by construction — but it is
the same class the R128/R130 conversions eliminated at every sibling
boundary, and the R123-E1 comment (`:305-312`) covers only the two pure
functions below it. **Fix sketch:** `roundLyd(basePrice - discountAmount)`
+ one-line comment; zero behavior change (pin: existing
checkout-stacked-discounts suite).

### A4-F4 [P3 — doc] Invariants-doc "re-verified" stamp is two rounds stale while claiming to be the auditor's starting checklist

Same family as A4-F1 but worth its own line: the header
(`FINAL_MONEY_INVARIANTS.md:4-7`) last stamps R128 (`eb50024`); R130 and
R133 both re-walked (per `docs/inspection-r130/A7-money-paths.md:100` and
the R133 CHANGELOG) without refreshing the stamp or the suite-index counts
("43 files" — the routes/__tests__ dir alone now holds 74; cart.test.ts
grew 3 R133 cases; `variant-availability-pricing.test.ts` is new since
R130 and is not in the §2 index). **Fix sketch:** fold into the A4-F1 doc
edit — refresh the header stamp to R134/`5d5227c`, re-count §2, and add
the two missing money-suite files (`variant-availability-pricing`,
`cart` variant-parity block).

**No P0/P1/P2.** Nothing found in: checkout chain, wallet credit/debit
enumeration (all six lanes re-walked: topup create/approve/reject, refund,
admin adjust, loyalty convert, referral credit — all transactional,
audited, retry-safe), coupon consumption/return, points award/reversal,
inventory claim, price snapshot, Telegram money path (untouched since
R130 — no diff), roundLyd discipline (no NEW unrounded money arithmetic).

---

## 4. Mandate 3 — fresh eyes on money-adjacent surfaces changed since R130

The full backend/shared delta `fd702d6..5d5227c` (16 files, of which the
money-relevant ones are enumerated here; arabic-search/web-vitals/a11y/
admin-UI changes are out of surface):

| Change | Verified |
|---|---|
| `cart.ts` R133 A7-F2 parity (GET active-only pool `:123-136`, PATCH variant load `:317-331`) | Landed as documented; the retired-variant fallback runs on BOTH routes via `buildCartItemResponse`'s variant-undefined leg `:75-79`. **Consumer check: GET /api/cart has ZERO production consumers** — the frontend's only server-cart call is `DELETE /api/cart` (`cart.tsx:133`; full-repo grep); the local cart store (`lib/cart.tsx`) is the checkout surface and re-quotes live at charge time. The active-only pool therefore breaks nobody and the fix is contract-correct + pinned by the 3 new `cart.test.ts` cases (`:281-373`). Residual: A4-F2's display math in the same builder. |
| `checkout.service.ts` A7-F1 `firstClaimableVariant` (`:139-167`, wired `:249`) | Landed exactly as the R130 fix sketch; legacy-path only; one grouped pool query; fallback to `productVariants[0]` keeps OUT_OF_STOCK semantics; pinned by `variant-availability-pricing.test.ts` (298 lines, new). The A7-F1 display arm (`products.ts:250-268 displayBaseFromVariants`) + frontend arms (`checkout.tsx:445-470` drained-variant stock 0, PDP stock badge, catalog invalidation `:1100-1110`) all landed. |
| `adjustment.service.ts` / `refund.service.ts` / `topup.service.ts` / `loyalty.ts` / `money.ts` A7-F3 roundLyd completion | All 7 sites converted (cite list in §1 walk); `money.ts` doc note added (`:36-40`). No other logic change in these files (adjustment's type-union reformat is cosmetic). |
| `shared/db/src/schema/index.ts` (+18) | Comment-only (the R130-A8-F1 index-ordering convention note). No schema change. **Money-schema note for M15: no new money column since R130** — the CHECK/RESTRICT census is stable. |
| Money alert family (`alertLogger.ts`, watchers, telegram-webhook) | **Zero diff since R130.** The money alerts (`coupon_maxed`, `inventory_corrupt`, `refunded_live_credentials`, coupon/flash expiry) all still fire post-commit/post-outcome (M16 anchors in §1). No new alert type; no pre-commit emission introduced. |
| Admin mass operations — bulk refund loop (`admin/orders.ts:488-592`) | Re-read end-to-end: sequential per-order `RefundService.refundOrder` (each its own tx), partial failures surfaced (`successes`/`failures`), FINANCE permission gate `:498-508`, B2-F4 batch cap, idempotency middleware mount `:437`, audit row `:577-584`, stock-sweep trigger post-batch. Matches the documented-deliberate shape (exclusion honored); the non-refund legacy path keeps the F-1/F2/F3 status-machine guards (`:646-654`). |
| New money routes since R130 | **None.** Route census (wallet/orders/loyalty/cart/coupons + admin/orders bulk): identical set to R130; the only route-level diffs are cart parity + products search (read-only catalog). |
| roundLyd discipline — NEW unrounded money arithmetic since R130? | **None.** Full toFixed census re-run (all non-test hits reviewed): every balance-mutation boundary rides roundLyd; the only residuals are A4-F2 (cart display) + A4-F3 (2dp-exact subtraction) + the documented non-LYD/percent/SEO classes (pricing-calculator margins, loyalty-policy estimates, forecast rates — pre-existing, justified in-code). |

## 5. Exclusions honored (not re-filed)

A7-F4 (this report specs it, §2) · A7-F5 Telegram 409 branch (untouched
since R130 — still `telegram-webhook.ts:182-186` shape, still cosmetic) ·
A8-F2 `idx_wallet_ledger_type` · A8-F3 `payment_reference` nullability ·
admin mass-refund loop deliberate design (§4 row above).

## 6. Mission checklist

- [x] M1–M17 re-walked against `5d5227c` with current line anchors (17/17 HELD; §1)
- [x] roundLyd discipline re-censused (no new unrounded balance mutations; two display residuals filed P4)
- [x] A7-F4 implementation spec: table+column, all 4 writers, all 6 predicate sites, V1-M32 stage + 0021 mirror + drift gate, 8 test surfaces (§2)
- [x] R133 cart parity fix re-reviewed with consumer analysis (dead surface, contract-correct)
- [x] money alert family, admin mass ops, new-money-route census (§4)
- [x] no code changes, no commits, no test runs, no production writes
