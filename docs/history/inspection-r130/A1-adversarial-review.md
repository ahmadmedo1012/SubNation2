> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r130/A1-adversarial-review.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R130-A1 — Adversarial Review of the R129 Delta (7eb9088, fabc7bd, f9fa15c, fd702d6)

**Method:** hunk-by-hunk read of all four R129 commits; full reads of
`lib/cart.tsx`, `cart.tsx`, `checkout.tsx`, `ProductCard.tsx`, `product.tsx`,
`products.ts` (backend), `checkout.service.ts`; every consumer of
`stockCount`/`lineStockNotice`/`cartHasBlockingStock` traced; loop-safety
hand-traced; CI status verified via the public GitHub API; GET-only live
probes of subnation.ly (HTML, CSS, cart/checkout JS chunks, /products,
/assets guard). Read-only.

**Headline:** the R129 P1 close is real. The stock-honest cart is wired
end-to-end AND deployed (live checkout chunk carries «نفد مخزونها — راجع
السلة», live cart chunk carries «عدّل كميتها», live CSS carries the 43%
primary-text token and both 1.4 beziers, /assets 404 guard live). No
P0/P1/P2 found. Six findings, all P3/P4 — three are residuals of the
flagship feature itself.

## Findings

1. **A1-F1 [P3] VERIFIED — Variant-drained lines escape the stock gate:** the
   snapshot is the product TOTAL (products.ts:644-653) while the server
   authority is variant-scoped (checkout.service.ts:260-272). A line whose
   own variant drained while others hold stock shows no verdict and 409s at
   charge. FIXED R130: `quoteLineFromProduct` quotes a drained variant with
   stockCount 0 (checkout.tsx) — the B-11 machinery then flags «نفد المخزون»
   and blocks the CTA. Pinned by `checkout-variant-drain.test.tsx`.
2. **A1-F2 [P3] VERIFIED — The success toast lied at the stock ceiling + the
   cart «+» silently no-oped** (both add sites toasted unconditionally;
   `capRaise` refused at the ceiling; the second quick-add of any ≤N-stock
   product). FIXED R130: `addItem` returns whether the quantity grew
   (computed from the committed-state mirror), both add sites toast
   «بلغت الحد الأقصى المتاح» on refusal, the cart «+» disables at the ceiling
   (`stockAwareCeiling` exported). Pinned by `cart-add-honesty.test.tsx`.
3. **A1-F3 [P3] VERIFIED — The blocked-state render/CTA gate had no
   feature-level test** (R129's own recipe half-executed: the refresh-path
   test asserted the CTA ENABLED only). FIXED R130:
   `checkout-variant-drain.test.tsx` renders the real CheckoutPage with a
   blocked line and pins the honest disabled CTA + verdict.
4. **A1-F4 [P4] VERIFIED — Cart block reason not on the disabled control**
   (CHANGELOG claimed "reason ON the control"; true on checkout only). FIXED
   R130: `aria-describedby="cart-stock-block-reason"` linkage (cart.tsx).
5. **A1-F5 [P4] VERIFIED — Stock-only reconcile can void an applied coupon
   silently** (the `[items]` void effect fires on identity change; the
   R129 stock-drift reconcile changes identity without a price change;
   window: coupon applied while the mount re-quote is in flight). ACCEPTED
   for now — pre-existing class for price changes; gate on
   `!pricingRecheckInFlight` if it ever bites.
6. **A1-F6 [P4] VERIFIED — The R129 round record's gate claim is stale**
   ("impeccable EXIT 0; CI green expected" — but f9fa15c's CI FAILED and the
   fixing commit fd702d6 isn't covered by the record; also 7eb9088/fabc7bd
   never got CI runs at all — the three R129 pushes landed within 43 s and
   the last two "success" runs were docs-only, skipping every heavy job).
   CORRECTED in the R130 record below; the R130 round re-ran every gate
   locally at fd702d6 (see CHANGELOG).

## Inherited — VERIFIED CLOSED at fd702d6

- R129-A1 F1/B1-1 (stock-honest cart dead code): wired + live-verified in
  production bundles; loop-safety traced (value-inequality guard +
  once-per-visit quotedProductIdsRef).
- A3-1 CI gate: fd702d6 config waiver byte-matches the CSS bezier (live).
- A1-F3 MetaTags 1200×630 doc block, A1-F4 DESIGN.md tier-silver #acb6c3,
  A1-F6/B1-10 offender char-count, B1-2 /products alias pin (real
  registration source-pin), B1-3 copilot trace pins — all verified.
- A2 contrast spot-checks: orders /80, login /75-drop, dark status-error 64%,
  light primary-text 43% — in source AND live CSS. 178 test files = "176+2".
- Live probes: /products 200 shell; /assets/<miss> 404 text/plain; bare
  /assets 404 (redirect:false holding).
