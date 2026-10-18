# ADR — Order Group (batch) identifier for multi-order checkouts

- **Task**: R162-F (Lane F — multi-order acknowledgement and money-path architecture)
- **Status**: **IMPLEMENTED BY R165** (2026-10-18 — `docs/engineering/R165/round-close.md`;
  the semantics below shipped as designed: stage V1-M35 + chain 0026, the
  body-field transport, the parsed-body route wiring, the §5 matrix pinned.
  The ONE disclosed deviation: the group-token load's subset-tolerant
  fingerprint — `frontend/src/components/checkout/checkout-group-key.ts` +
  R165 §3). Historical status: PROPOSED — DEFERRED (do not implement in
  R162; designed for a dedicated money round — which R163/R164's SEO and
  GA-activation rounds then outlived, taking the round numbers while this
  ADR waited).
- **Decision** (historical, R162): this round shipped this ADR only. No
  code, no schema, no API change. Read-only analysis; the only file
  written was this document.
- **Effort estimate for the implementing round**: ~1.5–2 focused agent-days
  as a single dedicated lane (breakdown in §11).

---

## 1. Context

### 1.1 How checkout actually works today (verified in code this round)

A cart confirm is **N independent HTTP unit-orders**, not one request.
`frontend/src/pages/checkout.tsx` `handleConfirm` loops lines → units
(`MAX_UNITS_PER_LINE` clamp per line) and fires one `createOrder` per unit
(`checkout.tsx:446-574`), each carrying:

- its own **`Idempotency-Key`** — minted lazily per unit, persisted in
  localStorage with a 10-min TTL + line fingerprint
  (`components/checkout/checkout-unit-key.ts`), so a network retry replays
  instead of double-charging;
- a body `{product_id, variant_id?, coupon_code?}` (`CreateOrderBody`).

Each POST `/api/orders` runs the full atomic purchase
(`backend/src/services/checkout.service.ts` `purchase()` — inventory claim +
wallet debit + coupon + order row + ledger + points + durable idempotency
claim, ONE transaction, M4) and returns a serialized `Order`
(`backend/src/routes/orders.ts` `formatOrder`).

The only thing the N unit-orders share today is `user_id` + roughly-equal
`created_at`. There is **no server-side concept of "one checkout attempt"**.

### 1.2 The honesty history

- **R160-AUDIT (NO-GO)**: a multi-unit full success navigated to order #1's
  receipt with zero mention of the N−1 siblings — classified
  "needs a backend batch/id concept to be honest; M effort" and deferred
  (docs/engineering/R160/round-close.md ledger item 1).
- **R161-G (delivered)**: the honest *UI-level* fix — full success with
  `created.length > 1` now lands on **/orders** (`checkout.tsx:719`), the
  toast already counts every order («تم إنشاء 2 طلبين بنجاح»), and
  `checkout-idempotency-keys.test.tsx` pins both landings (N=1 → receipt deep
  link, N>1 → /orders). The R161-G-AUDIT verdict that motivated it: partial
  success shows a banner with the honest count + a «راجع طلباتك المنشأة»
  link to /orders; **every created order is reachable and identifiable**
  (codes, amounts, statuses, newest-first) on /orders — the audit found **no
  today-path where a customer cannot identify their orders**. Re-verified
  this round against `orders.tsx:502-649` (each row: image, name, variant
  label, mono `order_code`, date, coupon chip, amount, status badge — every
  row a Link to its receipt).

### 1.3 What a group ID would still buy (the honest delta)

1. **Order-detail sibling awareness** — the last remaining surface gap: a
   customer browsing history later opens one receipt of a 3-order purchase
   and sees no hint the others exist (back row + «كل طلباتي» are the only
   paths). Today this is mitigated, not closed (the checkout landing already
   lands multi-order successes on /orders).
2. **/orders visual clustering** — orders from one attempt sit adjacent but
   unmarked; a second purchase minutes later is visually indistinguishable
   from the first's siblings.
3. **Support referenceability** — one group ID vs N order codes.
4. **Foundation for any future basket-level receipt.**

None of these is a correctness or honesty defect. All are enhancements.

---

## 2. The order-group contract (the semantics this ADR proposes)

**Definition**: an *order group* is the set of order rows created by ONE
logical checkout attempt (one confirm intent, including its partial-failure
retries). It is **informational only** — it never participates in money
math, idempotency claims, refunds, or inventory.

1. **Minting authority: the CLIENT.** The server cannot infer group
   membership — each unit is an independent POST, and only the client knows
   they belong to one attempt. The checkout page mints one UUID
   (`crypto.randomUUID()`) at the start of a confirm attempt, **reuses it for
   every unit-order of that attempt, and reuses it across partial-failure
   retries of the same basket** (persisted like the unit keys — localStorage
   envelope via `lib/intent-envelope.ts`, TTL 10 min mirroring
   `CHECKOUT_KEY_TTL_MS`). The server records it verbatim; it never mints,
   validates beyond a length cap, or interprets it.
2. **Always minted, not only for multi-unit baskets** — a group with 1 order
   is valid (e.g. a 3-unit attempt where 2 units were skipped by another tab
   and 1 created). Uniform contract, zero client branching; the UI only
   renders grouping affordances where ≥2 rows share a group.
3. **Partial success = a group with fewer orders.** No phantom rows for
   failed/skipped units, ever. The per-order `status` fields carry the truth
   exactly as today.
4. **Group membership is immutable after commit** — no update sites for
   `order_group_id` (mirrors the M10 `orders.amount` discipline: zero update
   sites, enforced by a pin). Refunds stay per-order; `RefundService` is
   untouched.
5. **Idempotent replay preserves the group.** The replay path returns the
   stored row (`replayOriginalOrder` selects the whole row); the group rides
   the order, not the idempotency claim — `claimIdempotencyKey` is untouched.
   M5/M6 hold by construction.
6. **Historical orders**: `order_group_id IS NULL` = singleton/legacy —
   rendered exactly as today, never backfilled.

### 2.1 Transport decision: body field, not a header

**`order_group_id` rides `CreateOrderBody`** (nullable string, `maxLength:
36`, zod-generated), not an `Order-Group-Key` header. Rationale:

- **The header path is a known trap in this repo**: orval's react-query
  target drops every declared header param — the R142 N-1 class, guarded by
  `scripts/check-openapi-header-params.ts` (7 rows today). A new header
  means: a `KNOWN_DROPPED` ledger row + the per-call RequestInit escape
  hatch + growing that gate's census. The body field is typed end-to-end by
  the existing codegen for free.
- **The body-hash interaction is a feature**: `canonicalBodyHash(req.body)`
  already includes every body field (R134 A7-F4), so a retry that
  re-minted the group under a still-live unit key fails the durable reuse
  predicate → classified 409 `IDEMPOTENCY_KEY_REUSE` — **fail-closed**,
  never a second charge. The client therefore MUST keep the group token
  stable across retries (§2.1.1), and this is exactly the same
  lifecycle discipline the unit keys already follow.

**2.1.1 The subtle requirement** (the one real design risk): the group token
must survive the cart-sync that clears *charged* units' keys
(`checkout.tsx:598-627` clears per-unit keys at sync; a partial failure
keeps the *remaining* units' keys). If the group were cleared with them, the
retry's remaining units would replay-409 against their own still-live keys
(same key, different body-hash). Lifecycle therefore: **minted on first
confirm attempt of a basket; cleared ONLY when the live cart fully resolves
(the same `liveAfterSync` empty check as the `clear()` guard) or TTL
expiry**; coupon removal mid-retry deliberately does NOT re-mint (same
purchase intent). A >10-min-late retry mints a fresh group alongside fresh
unit keys — the documented 98-F2 trade-off, applied consistently.

---

## 3. Schema plan

| Aspect | Decision |
|---|---|
| Column | `orders.order_group_id VARCHAR(36)` — **nullable, no default, no backfill** (NULL = pre-feature singleton). UUID-v4 string length; matches the house `varchar(n)` convention (`order_code 50`, `coupon_code 50`, `body_hash 64`). |
| Index | `idx_orders_user_group ON orders (user_id, order_group_id) WHERE order_group_id IS NOT NULL` — partial (the V1-M31 `idx_coupons_expires_at` idiom), composite because every consumer query is ownership-scoped (`user_id + group`), group IDs are random UUIDs so the second column is highly selective. Historical NULL rows stay out of the index. |
| **migrate.ts stage** | `applyOrdersGroupColumnStage` — **V1-M35** (next in the V1-M9..M34 sequence). Shape: the **V1-M32 idiom** (`stages/03-domain-org-r135-wave.ts:486-508`): `information_schema.columns` probe → `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id VARCHAR(36)` + `CREATE INDEX IF NOT EXISTS` (belt-on-probe, V1-M19 idiom) → steady-state boots issue **zero DDL**. Registered in `backend/src/migrate/index.ts` + called in the `migrate.ts` stage tail after `applyR135IndexWaveStage()` (`migrate.ts:2000`), before the "Migrations completed" log. |
| Schema TS twin | `shared/db/src/schema/orders.ts`: `orderGroupId: varchar("order_group_id", { length: 36 })` + the partial index declaration, with the R-tag docblock linking the stage + chain file. |
| Drizzle mirror | Chain **0026** — whatever name `pnpm --filter @workspace/db exec drizzle-kit generate` emits, then hand-hardened with the 0021/0023 conventions: header comment naming V1-M35 + declaring the file DECLARATIVE-ONLY (nothing executes it at runtime; CI only regenerates + diffs), `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Snapshot + `meta/_journal.json` regenerated with it. The CI drift gate (`drizzle-kit generate` → `git diff --exit-code`) stays green. |
| Test harness | `backend/src/test/db.ts` orders DDL gains the column + index, plus a `getTableConfig` compile-level assertion in `services/__tests__/schema-parity.test.ts` (the A10 round-93 contract: the harness certifies what production enforces). |
| Migration test | `backend/src/jobs/__tests__/migrate-v1m35.test.ts` (the `migrate-v1m32.test.ts` shape): column lands varchar(36) nullable; re-run = zero DDL; the mirror file carries the same statements; index is partial. |

**Never a `db:push`** — the runtime chain owns production; the drizzle chain
only mirrors it.

---

## 4. API plan

| Endpoint | Change |
|---|---|
| `POST /orders` | `CreateOrderBody` gains `order_group_id` (nullable string, `maxLength: 36`, not required — absent = NULL group; existing clients byte-compatible). Route parses it via the existing `CreateOrderBody.safeParse` (no raw `req.body` reads — the R120-B6/A6-F7 split-brain lesson) and passes it to `CheckoutService.purchase` as `orderGroupKey`. |
| `GET /orders` | No change (rows already carry the field once `formatOrder` adds it). No `?group=` filter — ponytail: the UI groups client-side from rows it already holds. |
| `GET /orders/{orderCode}` | No change beyond the shared `formatOrder` field. |
| `formatOrder` (`routes/orders.ts:37`) | `order_group_id: order.orderGroupId ?? null` — additive, after `order_code`. |
| `Order` schema (openapi.yaml `:6084`) | `order_group_id: ["string", "null"]`, NOT added to `required`. Documented as "client-minted checkout-attempt token; NULL on orders placed before the feature or by clients that omit it". |
| Codegen | `pnpm --filter @workspace/api-spec run codegen` → regenerated react-query + zod clients committed; re-run idempotent (the CI drift gate). The typed `Order` flows to the frontend automatically. |
| Wallet `/wallet` `recent_orders` block | **Deliberately unchanged** — that surface's contract (B6-03) omits display-only fields it doesn't render. |

**Service change surface** (`checkout.service.ts`): `CheckoutInput.orderGroupKey?
: string | null`; the value rides the existing `ordersTable` INSERT values
(one more column in the SAME M4 transaction — atomicity unchanged, no new
failure reason, no new side effects); `replayOriginalOrder` needs zero
changes (selects the whole row). No change to `idempotency_keys`, claims,
ledger, points, or events (M16 untouched).

---

## 5. Semantics contract — the full interaction matrix

| Scenario | Behavior |
|---|---|
| Single-item checkout | 1 order, group present (a valid 1-order group). UI shows no grouping (single row). |
| Multi-item full success | All N orders share one group; toast + /orders landing (unchanged R161-G behavior); /orders clusters the group's rows. |
| Partial success (HTTP rejection mid-loop) | Group contains exactly the k created orders; banner + count + «راجع طلباتك المنشأة» unchanged; the retry reuses the group for the remainder. |
| Network failure mid-loop | Same as HTTP-partial (R161-G made the catch mirror the partial branch); retry replays charged units (no double charge — the unit keys) and completes the remainder under the same group. |
| Idempotent replay (retry of a charged unit) | 200 + `Idempotent-Replayed: true`, the stored row's group returned verbatim. No second order, no second charge (M5/M6). |
| Same unit key + re-minted group (client bug / TTL edge) | Classified 409 `IDEMPOTENCY_KEY_REUSE` — fail-closed by the body-hash predicate. Never a second charge. |
| Skipped-by-other-tab units | Not created → not in the group. The other tab's orders carry THEIR tab's group. |
| Historical orders | NULL group → singleton, rendered exactly as today. |
| Refund | Per-order, unchanged. A refunded order keeps its group membership (informational). |

**What the group is NOT**: not a transaction boundary, not an amount
aggregate of record (any basket total shown is a display sum), not a refund
unit, not an admin bulk-action target (admin surfaces gain nothing in v1).

---

## 6. UI plan

1. **`checkout.tsx`**: mint/persist/reuse the group token (§2.1.1 lifecycle)
   and send it in each unit body. A new `checkout-group-key.ts` module beside
   `checkout-unit-key.ts` (same `intent-envelope` mechanics; clear-on-
   full-resolution instead of per-unit).
2. **`orders.tsx`**: consecutive rows sharing a group render under one
   cluster affordance (a subtle «عملية شراء واحدة» divider/chip — exact
   wording a design decision for the implementing round). Every row keeps
   its own identifier/amount/status (the mission's requirement) — grouping
   is presentational, rows stay individually linked.
3. **`order-detail.tsx`**: when `order_group_id` is present, a chip
   «جزء من عملية شراء متعددة» linking to /orders (the v1 shape). The
   richer alternative — embedding sibling order codes in
   `GET /orders/{orderCode}` — is a deliberate non-goal for v1 (response
   shape + query cost for marginal value; documented as the follow-up if
   product wants in-receipt sibling links).
4. All copy rides the Arabic-first register + «…» dialect + M17
   `formatCurrency` for any amounts.

---

## 7. Backward compatibility

- **Old clients / API consumers**: body field optional; response field
  additive; absent header-equivalents simply yield NULL groups. Generated
  clients are additive-typed (`order_group_id?`).
- **Historical rows**: NULL = singleton; no backfill (a backfill could only
  be a guess — `created_at` proximity heuristics would fabricate groups).
- **The idempotency 48h transition window** (V1-M32 precedent): orders
  written by mixed-version clients during a deploy converge naturally —
  NULL groups from old code, populated from new; both render correctly.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **Money-path blast radius** — the change touches `purchase()`'s INSERT (M4 territory) and the orders route. | One additive column in an existing INSERT; zero logic branches; the M4/M5/M6/M10 suites re-run unchanged + new cases (§10). |
| **Neon never rolls back** — the column + index are permanent. | Expand-first design: nullable, no default, partial index, probe-gated stage; if the feature is ever abandoned the column is inert (NULL) — no shrink required. |
| **Group-fragmentation bug class** — a client that re-mints the group mid-retry splits one attempt into two groups (cosmetic dishonesty), or 409s against its own live unit keys (availability bug, fail-closed). | The lifecycle contract in §2.1.1 + dedicated tests (partial-retry reuses group; post-TTL retry mints fresh group + fresh keys together). |
| **Drift-gate churn** — 4 mirrors must move in lockstep (migrate stage, schema TS, drizzle chain, harness DDL) + codegen. | All four gates already exist and fail loudly (drizzle drift, orval drift, schema-parity, header-params N/A for body transport). |
| **UI grouping on a heavily-pinned page** — `orders.tsx` render family suites re-pin cost. | Grouping is additive DOM; existing row pins assert per-row content (unchanged); new pins for the cluster affordance only. |
| **Scope creep** — admin group surfaces, `?group=` filters, basket receipts, group refunds. | All explicitly out of scope (§5 "NOT" list); the ADR is the fence. |

---

## 9. Acceptance test matrix (for the implementing round)

**New suites**
1. `migrate-v1m35.test.ts` — column/index shape, zero-DDL re-run, mirror
   parity (the §3 table).
2. Backend service tests (extend `checkout-idempotency.test.ts` family):
   group persisted on the order row; replay returns it verbatim; same key +
   different group → the classified 409; NULL group when omitted.
3. Backend route tests (extend `orders-idempotency-route.test.ts` family):
   body parse cap (37 chars → 400 INVALID_DATA per the maxLength idiom),
   `formatOrder` serialization, GET surfaces expose it.
4. Frontend: group token lifecycle (mint/persist/reuse/clear-on-resolution/
   TTL) + checkout sends it on every unit + orders-page clustering +
   order-detail chip.

**Scenario matrix (the mission's six)**
- single-item: one order, group present, UI unchanged;
- multi-item full success: shared group + clustered /orders;
- partial failure: k-order group + retry completes remainder in the same
  group;
- network failure: same as partial + replay of charged units (no second
  charge — assert wallet debits);
- retries: idempotent replay path returns group verbatim; post-TTL retry =
  fresh group (and fresh unit keys);
- historical records: NULL-group rows render byte-identical to today.

**M-invariant mapping (which suites guard it)**
- M4 atomicity — `checkout-claim-race`, `checkout-idempotency`: the group
  write is inside the same tx; assert rollback leaves no group rows.
- M5/M6 idempotency — `checkout-idempotency`, `orders-idempotency-route`,
  `middlewares/idempotency.test.ts`, `cross-intent-durable-idempotency`:
  replay/reuse behavior unchanged.
- M10 price freeze — `price-snapshot-immutability` (amount untouched; group
  must not appear in any amount assertion).
- M15 three-mirror schema guards — `schema-parity` + the migrate suites.
- M16 events-after-commit — `checkout-coupon-maxed-postcommit` (no new
  events; unchanged).
- M17 formatting — UI suites (any group-affordance amounts).

**Gates**: lint, typecheck ×4, full backend + frontend vitest, build,
route parity (+1 field → re-run the parity scripts), error-code sync,
codegen idempotent, **drizzle no drift**. Money slice = §2 of
docs/FINAL_MONEY_INVARIANTS.md re-verified.

---

## 10. Why NOT R162 (the deferral rationale)

1. **The honesty gap is closed.** R161-G delivered the customer-facing
   contract: every multi-order outcome shows a truthful count and lands on
   a surface listing every order with codes/amounts/statuses. This round's
   code re-verification found **no today-path where a customer cannot
   identify their orders** — the group ID is an enhancement, not a fix.
2. **Round capacity.** R162 carries five other landed lanes (census docs,
   SEO integrity + deterministic join + 6 tests, e2e heartbeat truth +
   dispatch verification, commercial-truth verification + the 8-test
   catalog-quality validator, authed rendered-UX report) plus coordinator
   integration + full gates + release. A money-path schema + API + codegen +
   UI change with the §9 battery cannot be completed to the repo's standard
   in what remains — and the lane rules forbid partial batch features.
3. **The one subtle design risk (§2.1.1) deserves fresh-round attention**,
   not end-of-round fatigue: the group-token lifecycle interacts with the
   cart-sync/unit-key machinery on the money page, and getting it wrong
   creates a new dishonesty (fragmented groups) or an availability bug
   (self-409s), the exact failure classes the R160/R161 honesty work
   eliminated.
4. **Permanence.** Neon never rolls back; the column shape, minting
   authority, and index are one-way doors. A designed, reviewed ADR is the
   right artifact to carry across the boundary.

## 11. Recommendation & effort

**DEFER to a dedicated money round (R163 candidate) as a single lane** —
the design here is complete enough to implement in one pass:

- Backend (stage V1-M35 + schema twin + harness + service + route + tests):
  ~0.5 day
- OpenAPI + codegen + regenerated clients + gates: ~0.1 day
- Frontend (group lifecycle + send + orders clustering + detail chip +
  tests): ~0.5 day
- Full regression battery + money suite + both suites + all gates: ~0.5 day

Trigger to revisit sooner: if product asks for in-receipt sibling links or
group-based support tooling, or if support volume shows customers confusing
same-day orders — otherwise this stays a P3 enhancement behind the honest
landing that already ships.
