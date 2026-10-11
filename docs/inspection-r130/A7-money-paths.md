# R130-A7 — Money paths, idempotency, payment/top-up/refund invariants

**Tree:** fd702d6 (+ the parent's uncommitted R130 edits reviewed in-flight —
availability-aware pricing is server-side DB logic; cart addItem's boolean
return is honest-toast UX; no new trust of client input).
**Method:** full reads of checkout.service.ts, topup.service.ts,
refund.service.ts, adjustment.service.ts, wallet.ts, cart.ts, orders.ts,
telegram-webhook.ts, loyalty.ts, manual.provider.ts,
lib/{idempotency,middlewares/idempotency,idempotency-retention,ledger,money,pricing}.ts,
migrate.ts V1-M24..M31, schema twins, ProductCard.tsx, lib/cart.tsx,
checkout.tsx, plus `git diff 7d469d5..fd702d6` on every backend money file.

**Verdict: 0 P0 · 0 P1 · 0 P2.** The money core holds end-to-end at HEAD.
The A2 mixed-state chain is HALF-REAL: the code chain confirmed, the
mischarge a structural FALSE POSITIVE — what remains is a latent
buyer-facing dead end (P3, FIXED R130).

## A7-F1 [P3 — latent] Mixed-state quick-add resolves an unavailable variant → guaranteed 409 at charge, zero money moved
1. Display min ignores availability — CONFIRMED (products.ts :268/:453-454).
2. Quick-add never filters availability — CONFIRMED (ProductCard.tsx:252-271).
3. cart.ts null-variant pricing leg — CONFIRMED CODE, DEAD SURFACE (the
   production frontend never reads the server cart; only DELETE /api/cart).
4. Checkout resolution — CONFIRMED, but BY PRICE (orderBy priceLyd :199 —
   productsVariants[0] is cheapest ACTIVE, not insertion order).
5. **The mischarge is structurally impossible:** per-variant availability =
   scoped>0 OR generic>0, and generic stock is per-PRODUCT — so "cheapest
   variant unavailable" strictly implies scoped(cheapest)=0 AND generic=0;
   the claim pool is provably empty; the pre-tx fast-fail returns
   OUT_OF_STOCK before ANY mutation; the wallet CAS debit runs only after a
   successful in-tx claim. The buyer is charged exactly nothing. (The
   "product row price from a different variant" scenario cannot charge:
   products.price is consulted only when the product has ZERO active
   variants — where display uses the same products.price.)
6. The real residual: in the mixed state the card showed available + a
   stock badge, quick-add succeeded, and the buyer hit a hard 409 at
   confirm. Latent today (live probe: zero products in the mixed state; the
   only sellable product has all variants available).
**FIXED R130** (both closes): (a) displayBase = cheapest AVAILABLE variant
(both DTOs, fallback drained-min / row price); (b) legacy null-variant
resolution prefers the cheapest variant that can CLAIM a unit
(`firstClaimableVariant` — one grouped pool query on the legacy path only;
falls back to productsVariants[0] where the fast-fail answers OUT_OF_STOCK
with identical semantics). Charge-affecting for legacy clients (cheapest-any
→ cheapest-available) — pinned by
`variant-availability-pricing.test.ts` (the legacy path now charges 80.00
for the claimable variant and fulfills from its pool; all-drained still
fails closed).

## A7-F2 [P4 — VERIFIED — FIXED R133, dead surface today] cart.ts PATCH/GET disagree on variant pricing
PATCH (:299) omits the variant argument → variant lines re-priced off
`productsTable.price`; GET prices the same line correctly; GET's pool loads
inactive variants too (:123-126). Display-only (checkout re-quotes
server-side; VARIANT_NOT_FOUND fails closed) and the frontend never calls
these routes — but it is an authenticated public contract. Smallest fix when
touched: fetch the line's variant in PATCH (mirror GET) + add the isActive
filter.
**FIXED R133**: PATCH loads the line's ACTIVE variant (mirror of GET's
pool filter); GET's pool is now active-only — a retired-variant line falls
back to the product-level price on BOTH routes. Pinned by 3 new cases in
`cart.test.ts` (variant pricing parity, GET fallback, PATCH fallback).

## A7-F3 [P4 — VERIFIED] roundLyd adoption incomplete at balance-mutation boundaries — FIXED R130
money.ts's "five legacy sites" claim was true but incomplete: the census
missed `adjustment.service.ts:124,148,214`, `loyalty.ts:193` (the balance
WRITE — the convert itself was converted), `checkout.service.ts:424` and
`refund.service.ts:221-224` (newLifetimeSpend), `topup.service.ts:542`
(balanceBeforeWelcome). All safe by construction today. **FIXED R130**: all
seven sites now ride roundLyd + the money.ts doc corrected.

## A7-F4 [P4 — VERIFIED, dormant] The R122 body-hash defense never fires in production; durable same-key-different-body silently replays
Production runs without Redis (documented in-code; the middleware passes
through). The durable layer stores no body hash — within the 48h retention,
a client reusing one Idempotency-Key for a DIFFERENT product on POST /orders
gets the ORIGINAL order replayed (200 + Idempotent-Replayed) instead of the
designed 409. Money-safe (no second charge, no cross-user leak — scoping +
ownership re-check), but the client's record diverges from the platform's.
Smallest fix: a `body_hash` column (one V1 stage + one predicate at the
pre-tx lookup), or document the durable layer as replay-regardless-of-body.

## A7-F5 [P4 — VERIFIED, cosmetic] Telegram concurrent double-tap loser gets a retry-hint instead of "already processed"
`telegram-webhook.ts:182-186` catches every approve/reject throw as «حاول
مجدداً»; the 409 "تمت معالجته مسبقاً" ServiceError should branch to the
honest message + keyboard strip. Money state machine airtight regardless
(advisory lock + guarded flip + always-200 retry absorption).

## Mission checklist (walked, no findings beyond the above)
Checkout chain (single tx: freshness re-checks → FOR UPDATE SKIP LOCKED
claim → triple-column CAS debit → atomic coupon → order insert → ledger rows
→ in-tx idem claim; post-commit events only); idempotency (durable claims,
23505 → replay/409, never double-charge); every wallet credit/debit path
enumerated (topup create/approve/reject, refund, admin adjust, loyalty
convert, referral credit — all transactional, audited, retry-safe); Telegram
callback (secret constant-time + admin allowlist + guarded flip); referral
(self-referral structurally impossible; exactly-once via referee UNIQUE +
guarded flips); V1-M26 CHECKs present in schema twins (no new money column
in the R128/R129 delta); price re-quoting server-authoritative; live-DB
verification stands at R128-B4 §5 (not re-probed — no DB access this round).

## Inherited — VERIFIED CLOSED at fd702d6
M1-M17 money canon re-walked; R122 idempotency body-hash (Redis middleware;
production reachability caveat = A7-F4), dead-!order fallback → assertion,
points-replay bound; R129-A1 F1 (B-11) genuinely wired (with the
product-level snapshot caveat = the A7-F1 family, now fixed).
