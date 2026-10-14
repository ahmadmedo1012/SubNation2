# R147 — the honest-availability round: closing report

Round base: `c4bd51f` (R146 close) → this round's code. Method: the
repo's standing Ponytail ruleset (root `AGENTS.md`) applied with parallel
specialist lanes; Caveman methodology (hmzainjamil/caveman-prompt-compression,
read from upstream — no executable middleware exists in the remote session,
applied manually for instruction density) + Scroll Craft SKILL.md fetched
from nateherkai/scroll-craft upstream as composition reference (the R145
homepage composition was left intact — no evidence it is insufficient).

## The live baseline that picked the lanes

Live inspection (production, desktop 1440 + mobile 390, browser-verified):
**the catalog runs 44/45 products sold out** — `lifetime-cloud-storage`
is the only in-stock product (API `available_only=true` → 1). On that
inventory the highest-impact defects are availability-honesty defects,
verified before any code moved:

1. **PDP «قد يعجبك أيضاً» buried the only buyable product.** The
   recommendations DTO carried no availability and no stock-first
   ordering — on live `/product/cpanel` the one in-stock peer rendered
   LAST, behind three نفد cards that looked buyable.
2. **Category landings gave zero availability orientation.** A Google
   landing on `/category/streaming` met a wall of نفد cards with no
   in-stock count, no guidance.
3. **Admin defects** (scoping lane, file:line verified): blank dashboard
   above-the-fold for non-finance admins; dead sidebar
   «قيد الانتظار فقط» context action (`?status=` never applied on
   same-path nav); no per-row busy state on admins enable/disable and
   promotions activate/stop/delete (double-click races on
   session-kill/store-reprice actions); placeholder-only naming on the
   four primary list search inputs.
4. **One money-display bypass** in the account lane:
   `loyalty/StatsRow` rendered the raw `toFixed(2)` points-value string
   (no thousands grouping, bypassing formatCurrency).

Competitor benchmark (streamcode/mdcard/ramaida/spinor/eneba; likecard
blocked): from-price + availability badges are already in place;
inline card variant pickers SKIPPED (ProductCard quick-add already adds
the cheapest AVAILABLE variant — full pickers would duplicate the PDP);
payment-method matrix SKIPPED (checkout is wallet-only by documented
design); bottom-sheet drill-down SKIPPED (45-product catalog). The
accepted finding — availability truth at discovery time — became lanes
1-2 below.

## The lanes (all verified against current code before fixing)

| Lane | Fix | Files |
| --- | --- | --- |
| 2-a recommendations honesty | `loadProductRecommendations` gains the list loader's deliverable-stock subquery (is_sold=false + ≥1 credential field — there is no `products.is_available` column), stocked-first `orderBy`, `is_available` in the DTO; spec + orval regen; the rail renders ProductCard's exact نفد overlay (bg-black/75 + Lock) and neutral price ink (`text-foreground`, the R145/D4 rule) | `backend/src/services/catalog.service.ts`, `shared/api-spec/openapi.yaml`, both generated clients, `frontend/src/components/product/RecommendationsSection.tsx`, 2 test files |
| 2-b category availability truth | One honest line under «منتجات {label} (n)»: in-stock count with the CategoryRail success-dot idiom, or «كل منتجات هذه الفئة نفدت مؤقتاً — يتجدّد المخزون باستمرار» when the category is drained; computed off the UNFILTERED array (the home `categoryHasStock` truth rule); nothing while loading | `frontend/src/pages/category.tsx`, `category-error-state.test.tsx` |
| 2-c admin | Dashboard renders the honest scope notice when `!canSeeMoney` (AdminScopeGate register); topups reads `?status=` via `useSearch` + sync effect (the orders.tsx:500-511 idiom — the state→URL half already existed, pinned not re-added); `toggling`/`busyId` per-row busy states on admins + promotions (the coupons/topups idioms); aria-labels on the four toolbar search inputs | `dashboard/topups/admins/promotions.tsx`, `AdminAccountCard`, `PromotionsList`, 4 toolbars, 8 test files |
| 2-d account surfaces | StatsRow points-value rides `formatCurrency` (grouped + «د.ل»); every other surface verified-clean byte-identical (wallet/orders/order-detail/profile/support/loyalty/referrals) | `frontend/src/components/loyalty/StatsRow.tsx`, `loyalty-history.test.tsx` |

## Gates (all green, this exact tree)

- lint: **0 errors / 62 warnings** (= the R146 baseline)
- typecheck: clean (libs + backend + frontend + scripts)
- backend: **2,523 tests / 275 files** (R146: 2,518 — net +5; run in
  directory chunks on this 4GB/no-swap sandbox because the monolithic
  run is OOM-killed — every chunk green, counts summed)
- frontend: **2,488 tests / 263 files** (R146: 2,475/262 — net +13/+1;
  same chunked method)
- contract gates: OpenAPI routes ✅ (84 ops) · error codes ✅ (55) ·
  header params ✅ (7/7)
- production build: green; eager path **146,690 B gz — byte-identical
  to R146** (all changed components live in lazy route chunks), under
  the 150 KiB warn / 160 KiB hard budget

## Honest limits

- The recommendations `is_available` field deploys with the backend;
  until the release lands, the rail renders exactly as before (no
  badge) — the old DTO shape is a subset of the new one.
- Visual verification of lanes 2-a/2-b ran as pinned render tests (the
  sandbox's remote browser cannot reach local dev-server ports);
  post-deploy live smoke covers the rendered result on production.
- Admin lane verified by its 326 targeted tests + tsc; no production
  admin authentication was used (not authorized) — admin fixes are
  code-verified, not live-verified.
- Not checked this round: Playwright e2e (CI's dispatched run owns
  that surface), Redis/worker topology paths (production runs
  REDIS_URL unset + single-instance).
