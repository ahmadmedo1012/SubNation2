# R160 — The funnel-integrity & affordance round

Date: 2026-10-17. Status: gated locally (all gates green), committed
9d0d67e, pushed, CI 39047951341. Execution model: one read-only audit
lane (the checkout funnel — the money path's first dedicated pass) +
three parallel implementation lanes under ponytail discipline +
coordinator completion (the audit's 11 findings + the F1 regression
test + one intentional re-pin).

## Method

1. **Audit (R160-AUDIT, read-only)**: cart → checkout → payment →
   coupon → order receipt, plus onboarding/status (never audited
   end-to-end in 40+ rounds). The funnel's own 69-test battery was run
   green BEFORE judging pins, so the audit verified the tested
   contract rather than re-deriving it.
2. **Implementation (3 lanes, disjoint file sets)**: IMPL-A (coupons +
   risk sort affordances — the R158-A P3 ledger item, copying the
   R159-IMPL-B orders blueprint), IMPL-B (the three e2e gap specs from
   R159-AUDIT + the tablet-768 project), IMPL-C (the admin ellipsis
   dialect retirement). All three returned full reports and appended
   worklog entries.
3. **Coordinator completion**: all 11 audit findings closed in one lane
   (F1–F11 below), one new regression test, one intentional re-pin
   (semantics-depth's onboarding h1 spot-pin follows the new
   ref/tabIndex attributes in), one DESIGN.md rule amendment.

## The P1 — checkout money-path honesty (F1)

`pages/checkout.tsx` `handleConfirm`: the unit loop's HTTP-partial
branch (`failureMessage && created.length > 0`) called
`setPartialCount(created.length)` so `OrderErrorBanner` rendered the
honest partial verdict. The network-level `catch` did not — it set
`orderError` only, so a 2-unit purchase where unit 1 confirmed (2xx,
wallet charged) and unit 2's fetch dropped (TypeError → the outer
catch) rendered «تعذّر إتمام الطلب … لم يتم خصم أي مبلغ. راجع الرصيد
والمخزون ثم أعد المحاولة.» — a fabricated full-refund claim the
wallet view contradicts on arrival. The catch's own comment admitted
"if any unit was already charged, the wallet moved too".

Fix: the catch mirrors the HTTP-partial branch —
`if (created.length > 0) setPartialCount(created.length)` before
`setOrderError`, and the destructive toast is gated on
`created.length === 0` (the HTTP-partial register is banner-only).
`created[]` holds confirmed 2xx `Order` objects, so the partial
branch's «تم إنشاء N بنجاح قبل توقف العملية» + the
«راجع طلباتك المنشأة» recovery link are the honest verdict.

Regression-pinned (`checkout-idempotency-keys.test.tsx`): 2-unit
basket, unit 1 resolves + unit 2 rejects TypeError → the partial
banner renders, the recovery link points at /orders, the fabricated
claim is absent, no toast.

## The P2/P3 cluster (coordinator, one lane)

| # | Finding | Fix |
|---|---------|-----|
| F2 | onboarding step swap unmounts the focused «التالي» → focus falls to `<body>`; RouteAnnouncer is silent on same-route swaps | `tabIndex={-1}` on both step h1s + a mounted-guarded focus effect (`stepHeadingRef`); first paint does not steal focus |
| F3 | the «هنا» skip control rides ~17px in its `text-2xs` paragraph (the R122 class «السابق» already fixed) | `inline-flex min-h-11 px-2 -my-3` — the 44px floor with the negative-margin rhythm keep |
| F4 | tooltip-twin gaps (DESIGN.md: "both, always"): cart steppers ×3, coupon clear, banner dismiss | `title` mirrors every (dynamic) `aria-label` |
| F5 | status-page refresh has zero in-flight feedback | `isFetching` + `animate-spin` on RefreshCw + `aria-disabled` |
| F6 | checkout empty-basket renders the whole payment column over a phantom basket | `{!isEmpty && (…PaymentMethodCard + CouponCard + trust…)}`; the aside keeps its droppedLineNotices hoist |
| F7 | onboarding progress dots carry no step semantics | `role="group"` + `aria-label="الخطوة N من 2"` |
| F8 | coupon apply button loses its accessible name while checking | sr-only «جارٍ التحقق…» twin beside the spinner |
| F9 | DESIGN.md money-ink paragraph stale vs the R138/R139 receipt register | amended: the terminal «الإجمالي» emphasizes by weight+size only — never color (pinned by money-path-chrome-r139) |
| F10 | checkout — the only funnel page with no in-page back affordance | the order-detail back-row idiom as a `<Link href="/cart">` + mirrored in `route-skeleton.tsx` CheckoutShell (zero vertical reflow on the chunk swap) |
| F11 | order-detail support link rides ~18px | `min-h-6` (the 24px text-link floor) |

NO-GO → ledger: multi-order receipt acknowledgment (a multi-unit
purchase lands on order #1 with no in-page mention of the siblings —
needs a backend batch/id concept to be honest); Navbar-units vs
cart-lines count semantics (conventional, dismissed);
`formatBalance(null)` dead path (caller-guarded).

## Sort affordances (IMPL-A — the R158-A P3 ledger closes)

**Risk events — server-side** (`backend/src/routes/admin/risk.ts`):
the list is cursor-paginated, so the ordering rides the SQL ORDER BY
(a client-side sort would rank only the loaded page). `?sort=`
zod-whitelisted `created_at`/`score` × asc/desc; 400 `INVALID_DATA`
with the allowed values in Arabic (the `?eventType=` idiom); absent
param = the frozen `created_at DESC, id DESC` default, byte-identical.
Explicit sorts append `desc(id)` as the pagination-stability tiebreaker
(score ties are common on the 0..100 integer scale).

The cursor-protocol decision (the lane's stop-clause was NOT needed):
the score column is an integer by schema check
(`chk_risk_score_range` 0..100), so a score-encoding cursor variant
`"<score>:<id>"` with a strict digits:digits regex is float-safe by
construction. The keyset filter mirrors the ORDER BY in all four
variants (`gt` for asc continuations); the emitted `next_cursor`
encodes the ACTIVE sort's tuple. A cross-format cursor (a stale client
mixing sorts) fails the regex → ignored (first page) or matches
nothing → empty page; both self-inconsistent, neither duplicates nor
drops rows; our client restarts the query on flip (sort in the query
key).

Frontend: page-owned `sortBy` + two-way `?sort=` sync + النقاط/الوقت
`aria-sort` th headers with keyboard-operable buttons inside (the
OrdersTable idiom) + `RiskEventsMobileList` FilterTabs chips. openapi
documented + codegen (idempotent, re-verified).

**Coupons — client-side** (`pages/admin/coupons.tsx` +
`coupons-meta.ts`): the admin list API returns the ENTIRE capped list
(≤200) in one fetch, so the sort ranks the full dataset in memory
(the users-directory precedent — a server-side param would be
indirection with zero user value). `sortBy` + `?sort=` round-trip +
in-memory sort by the raw numeric `value` + a FilterTabs chips bar.
Deliberate deviation, documented: NO desktop `aria-sort` th —
CouponsTable is the R-140-l frozen div-grid (pinned: no table/th
retrofit); the chips bar is the one control for both breakpoints,
exactly the users directory's own client-side-sort dialect.

## e2e gap specs (IMPL-B — the R159-AUDIT proposals)

- **`tablet-768` project** (playwright.config.ts): the 640–1024 band
  had NO project (1280 + 390 only) — the R157 PDP affordance split
  (sticky bar `<lg`, buy panel `≥lg`) was never exercised at its own
  width.
- **`pdp-band.spec.ts`**: runs under every project, branches on the
  live viewport — `<1024`: the sticky bar's guest CTA visible + the
  in-panel CTA hidden; `≥1024`: the inverse; keyboard operability
  (focus + Enter → `/login?intent=buy`). API-first product discovery
  (`available_only=true`) so every assertion is unconditional (the
  R128-IMP-4 evaporating-assertion lesson).
- **`cart-drain.spec.ts`**: the guest session round-trip the
  cart-gate precedent blesses — add via the width's own visible CTA
  twin → Navbar «السلة، 1 منتج» → `/cart` row/qty → trash →
  «سلتك فارغة» + badge «السلة، فارغة» → sonner «تراجع» undo → item +
  qty + badge restored.
- **`soldout-pdp.spec.ts`**: API ground truth, re-verified against the
  DETAIL payload (list-vs-detail cache TTLs can skew) — «نفد المخزون»
  role=status chip + zero buy/add/login CTAs at every width + the
  disabled aria-label + the recovery link; honest loud `test.skip`
  when the catalog has no sold-out product.

87 tests / 13 files registered under 3 projects; every asserted
string byte-verified against source. Local/CI only — never
production-blocking (the cart-drain session write policy).

## Dialect unification (IMPL-C)

The admin ASCII `...` dialect RETIRED: 19 displayed-copy strings
across 14 files normalized to «…» — the R159-AUDIT census (9 sites)
plus 5 census adds the audit missed (UsersToolbar, OrdersHeader,
BulkActionBar, ReferralsFilters, ProductEditorCard — the lane's own
re-census found them). 5 stale idiom comments updated to match.
12 test files re-pinned with in-line R160 rationale — including the
`global-search` + `admin-layout-pill-search-scope` regex pins
(`/بحث\.\.\./` → `/بحث…/`) that the audit's own risk list had missed
and that would have failed loudly. Residual census: 0 (JS spread
syntax + code-quoting comments only, verified). The
NavItem/BulkActionBar duration-100s were verified ALREADY landed by
the R159 coordinator (no duplication — the R159-IMPL-C findings
re-checked via `git show`). DESIGN.md's copy-dialects rule rewritten
to the unified state: one dialect repo-wide, «…».

## Gates (all green, on the combined tree)

- lint: 0 errors / 15 baseline warnings
- typecheck: clean (libs + api-server + subnation + scripts)
- backend: **2,585** tests green, 4 sequential chunks
  (lib+services 1,169; routes 876; middlewares+root 244; jobs 296) —
  +6 vs R159 (the admin-risk-sort suite)
- frontend: **280 files / 2,608** green — +2 files (coupons-sort,
  risk-sort), +16 tests (+7 +8 +1 the F1 regression)
- route parity 86 ops; error-code sync 55; header params 7/7
- codegen idempotent (re-run verified, no second diff)
- build green — eager 146,666 B gz (+36 vs R159, budget 150 KiB)

## Ledger (deferred with rationale)

1. **Multi-order receipt acknowledgment** (audit NO-GO): a multi-unit
   purchase lands on order #1's receipt with no in-page mention of
   the siblings; honest acknowledgment needs a backend batch/id
   concept. M effort, needs API design.
2. **105 seedUser factory sites / 123 auth-mock files** (R159-AUDIT
   re-verified NO-GO): adopt-on-touch stands; the hoisted `setTestAuth`
   module-mock helper remains the proposed shape when churn is
   affordable.
3. **`backend/src/routes/admin/risk.ts` at 971/1000** under the R143
   size gate (29 lines headroom — the products.ts tripwire precedent
   applies if it grows again).
4. **AlertsTypeChips** FilterTabs conversion: still blocked on the
   primitive's tone coverage (severity-chip dialect); mechanical once
   `low_stock` lands as a tone member.
5. **R161 audit candidates**: a live-browser/VLM pass of the rendered
   funnel (the R160 audit was source + test-trace based — explicitly
   listed as not-checked), the guest bar's footer-overlap geometry at
   640px portrait, and the multi-order receipt design.
