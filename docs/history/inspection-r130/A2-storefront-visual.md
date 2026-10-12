> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r130/A2-storefront-visual.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R130-A2 — Storefront Visual + Customer-Journey Audit (source-level)

**Verdict up front:** the storefront is in exceptional shape at fd702d6 —
bidi anchoring, product-404 recipe, gate-intent banners, /products alias,
leading-tight removal, B-11 verdicts + CTA block + role="status", R129 token
nudges, reduced-motion/fill-mode regime: ALL verified closed in source.
Counts at audit time: P0 0 · P1 0 · P2 1 · P3 1 · P4 3.

## Findings

### A2-F1 [P2→P3 · SUSPECTED→chain-CONFIRMED] Cheapest-variant pricing ignored variant availability end-to-end
The display min (backend products.ts detail :268 / list :453-454) rode ALL
active variants availability-blind; grid quick-add with `fields=list` built a
null-variant line at the unbuyable min; B-11's product-level snapshot blessed
it; the charge 409'd. A7's structural analysis (see A7-F1) proved the
"mischarge" half FALSE POSITIVE (the claim pool is provably empty → 409
pre-tx, zero money moved; resolution is by PRICE not insertion order) — the
real defect is the buyer-facing dead end. **Latent today** (live probe: zero
catalog products in the mixed state; the one sellable product has all 3
variants available). **FIXED R130** (all three closes):
- backend displayBase = min over AVAILABLE variants (fallback: drained min /
  row price) — `displayBaseFromVariants`, both DTOs;
- checkout.service null-variant resolution prefers the cheapest CLAIMABLE
  variant (`firstClaimableVariant`, one grouped pool query on the legacy
  path only);
- ProductCard's reduce filters `is_available` (fallback: availability-blind
  min when all drained).
Pinned by `backend/src/routes/__tests__/variant-availability-pricing.test.ts`
(6 cases: mixed detail+list, all-drained fallback, generic-pool parity,
claimable resolution + fail-closed OUT_OF_STOCK).

### A2-F2 [P3 · VERIFIED] The R129 «WifiOff /70» close missed the family's biggest consumers
`fetch-error-card.tsx:54,68,81` (all three sizes) + `product.tsx:842` kept
`text-status-error/70` (2.98:1 dark on the error/8 tile — 0.02 under the 3:1
non-text bar) — `git show fabc7bd` reached only admin pages. **FIXED R130**:
full `text-status-error` ×4 + `aria-hidden="true"` on the decorative icons
(FetchErrorCard render site included).

### A2-F3 [P4 · VERIFIED] Sold-out variant pills carried no sold-out signal
`product.tsx` plan pills (:2270-2292) + duration pills (:2304-2312) —
`disabled + opacity-40` only, while the page's own «متوفر (N)» badge sat
right above. **FIXED R130**: «— نفد» appended to the pill label + the
duration pill's aria-label.

### A2-F4 [P4 · VERIFIED] Money ink rode three different tokens with no documented convention
Grid card `text-foreground`, PDP `text-primary`, cart/checkout/orders
`text-primary-text`, wallet `text-foreground` — each AA-passing
individually. **DOCUMENTED R130** in `frontend/DESIGN.md` («Money ink»):
ambient=foreground, buy moment=primary, ledger=primary-text.

### A2-F5 [P4 · VERIFIED] Storefront icon gaps rode physical ml-/mr- (12 sites)
All render correctly in the RTL-only app (latent fragility only). **BATCHED
R130**: the 10 confirmed unique-context sites swapped to ms-/me-/border-s/
ps- (product ×5, cart, notifications, NotificationBell, loyalty, terms);
A4-F9's census classifies the remaining 156 line-hits as correct-today
latents to ride ordinary file touches.

## Inherited — VERIFIED CLOSED (sample re-derived, not trusted)
R128-A2 F1/F2/F3/F4, R128-A4 F1/F3, R129-A2F1/F4/F6, R129-A1F1 (B-11),
R128-A5-1 fill-mode, R128-A6 P4-4, R128 §4-7 MobileNav, R129-A2F11
neighbors. Inherited-open confirmed: R129-A2F7 (risk chip — now FIXED R130),
R129-A2F11 bell↔read-state parity (still open, by design). Verified-OK:
token discipline (0 raw hex in rendering code), formatCurrency 100%, h1
census, checkout money path, success receipt, reduced-motion, wallet 44px.
