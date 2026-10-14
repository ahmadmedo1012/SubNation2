# Lane L4 findings — Catalog, product discovery & search (R143, HEAD 528ef39)

Read-only audit of the R143 catalog/search lane. Method: mandatory-first reads
(.hermes.md, R142 findings-ledger, lanes/findings-I.md) → deep-read of the
search path (backend/src/lib/arabic-search.ts, services/catalog.service.ts,
routes/products.ts, routes/cart.ts, routes/seo.ts, routes/admin/products.ts,
routes/admin/product-variants.ts, services/providers/manual.provider.ts,
shared/db/src/schema/inventory.ts) and the discovery surfaces
(frontend home.tsx, ProductsGrid.tsx, category.tsx, flash-sales.tsx, product.tsx
+ product/* extracts, catalog-filters.ts, categories.ts, product-seo.ts,
onboarding.tsx, GuestHero.tsx, ProductCard.tsx, lib/cart.tsx) → targeted test
runs + a live expansion probe.

**Test evidence (this lane's runs, all green):**
- backend: `arabic-search.test.ts` 120 ✓ · `products-arabic-search.test.ts` 40 ✓
  (pglite, real SQL/router) · `catalog-security.test.ts` 8 ✓ ·
  `variant-availability-pricing.test.ts` 6 ✓ · `product-detail-shape.test.ts` 3 ✓
  · `product-recommendations.test.ts` 3 ✓ · `spa-shell-category-parity.test.ts` 8 ✓
- frontend: `home-filters-url.test.tsx` 5 ✓ · `orders-filter-url.test.tsx` 3 ✓ ·
  `home-decomposition-r136.test.ts` 8 ✓ · `category-error-state.test.tsx` 2 ✓ ·
  `flash-sales.test.tsx` 5 ✓
- live behavior probe: `tsx` harness over `expandArabicSearch` — 23 queries
  (phrase windows, riders, mixed script, digits, modifiers, Persian glyphs,
  single-char, containment) — output quoted per-finding below.

---

## R142 fix verification

| Fix | Status | Evidence |
| --- | --- | --- |
| **I-1** token-window multi-word lookup | **VERIFIED** | `backend/src/lib/arabic-search.ts:484-487` (`MAX_PHRASE_WINDOW = 4`, "longest consecutive-token window tried against the alias/category lookups"), `:626-650` (window loop, `i += len - 1` token skip). Probe: `اشتراك شات جي بي تي` → `["ashtrak","chatgpt"]`; `شات جي بي تي برو` → compound `{brand:"chatgpt",modifier:"pro"}`; `في بي ان سنوي` → vpn + `{brand:"vpn",modifier:"year"}` + variantTerms `["سنوي"]`. Bonus: the window scan at every unresolved position also resolves NON-contiguous phrases (`شات اشتراك جي بي تي` → chatgpt via the trailing `جي بي تي` window). Tests: `arabic-search.test.ts:334`, `products-arabic-search.test.ts:603-617`. Suites green (120 + 40). |
| **I-2** duration variant-label EXISTS branch | **VERIFIED** | `backend/src/lib/arabic-search.ts:488-490` (`MAX_VARIANT_TERMS = 6`), `:537-551` (`addVariantTerm` + ta-marbuta twin `ه→ة`), `:604-607` (modifier→variant term wiring); `backend/src/services/catalog.service.ts:354-363` (`variantLabelExists` — `EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND (pv.duration_label ILIKE … OR pv.plan_label ILIKE …))`), `:411` (OR'd into the search condition). Live-shape seed (`شهر واحد`/`سنة كاملة` labels on brand-level names) + 5 route tests `products-arabic-search.test.ts:537-578`, incl. archived-invisible-to-EXISTS. Probe: `شهر` → variantTerms `["شهر"]`; `سنة كاملة` → `["سنه","سنة"]`; `نتفلكس ١٢ شهر` → compound with `digits:"12"`. Residual gap → **L4-2**. |
| **I-3** search edge-cache removed | **VERIFIED** | `backend/src/routes/products.ts:69-75`: `if (hasSearch) res.set("Cache-Control", "no-store");` with the B6-02 parity comment. Pinned both ways: `products-arabic-search.test.ts:630-637` (search → exactly `no-store`) and `:639-645` (no-search list keeps `public, max-age=0, s-maxage=60, stale-while-revalidate=300`). |
| **I-5** honest empty copy under «المتوفّر فقط» | **VERIFIED** | `frontend/src/components/home/ProductsGrid.tsx:147-165`: available-only-sole-filter branch renders «كل المنتجات المطابقة نفد المخزون حالياً» + «قد تكون هناك نتائج مطابقة لكنها نفدت — جرّب إلغاء فلتر «المتوفّر فقط» لعرضها»; mixed-filter case keeps the maybe-sold-out hint alongside the generic retry line. No dedicated test pins the new strings (P4 one-liner class — acceptable, noted). |
| **F1** GuestHero chip aria-label category-level truth | **VERIFIED** | `frontend/src/components/home/GuestHero.tsx:216-224`: `aria-label={inStock ? \`${brand.ar} — فئة فيها منتجات متوفرة\` : brand.ar}` with the F1 rationale comment; the decorative dot stays `aria-hidden` (:244-252). |
| **I-4** streaming landing copy + hero chip | **VERIFIED** (with one residue → L4-1) | `frontend/src/lib/categories.ts:49-54` (intro drops Shahid VIP + Crunchyroll), `:64-70` (metaDescription drops Shahid VIP); `frontend/src/components/home/catalog-filters.ts:114-119` (Shahid VIP chip swapped for Paramount+); `backend/src/lib/spa-shell.ts:293-299` (shell twin carries the same edit; `spa-shell-category-parity.test.ts` 8 ✓ pins the pair verbatim). Residue: `onboarding.tsx:176` still names شاهد → **L4-1**. |
| **J-3** product-seo.ts OOS fallback meta | **VERIFIED** | `frontend/src/components/product/product-seo.ts:55-63`: fallback description branches on `product.is_available` — OOS arm reads «…بالدولار الليبي على SubNation — راجع صفحة المنتج لمعرفة التوفر الحالي.» (no «متوفر…تسليم فوري» claim); JSON-LD Offer still threads the real `isAvailable` (:83, D2-F2). |

All seven fixes exist at HEAD 528ef39, each with its implementation comment and
its R142 test pin (I-5 copy excepted), and every relevant suite re-ran green in
this lane.

---

## Findings

### L4-1 · P3 · I-4 residue: the onboarding first-run screen still advertises Shahid — a brand the live catalog doesn't sell

- **Evidence:** `frontend/src/pages/onboarding.tsx:176` — `description="نتفلكس، ديزني+، شاهد، سبوتيفاي وأكثر."`, under the comment at `:169-175`: «…شاهد (Shahid VIP) is verified-live in streaming.» That verification claim was true at R122 and is false since the brand went unstocked — the I-4 fix itself cites "lane I's 2026-10-13 probe: search=شاهد → 0" (`categories.ts:49-51`).
- **Root cause:** the I-4 sweep edited `categories.ts`, `catalog-filters.ts`, `GuestHero.tsx` and the backend shell twin, but this fourth copy surface (first-run onboarding, `robots`-excluded but user-facing post-registration) escaped the sweep; its in-code "verified-live" comment now actively contradicts the catalog.
- **Proposed fix:** drop «شاهد، » from the description and delete/repair the stale comment (one line + comment). Mirror of the R122 PlayStation sweep that DID clean this file (`:169-173` cleaned بلايستيشن here).
- **Test requirement:** none (copy-only; optionally add onboarding copy to any future brand-sweep checklist test).
- **Risk:** minimal — new users are promised a brand the shop cannot sell; the exact F1/I-4 truthfulness class, on the very first screen after signup.

### L4-2 · P3 · The I-2 duration EXISTS arm ignores `pv.is_active` — deactivated duration variants still surface in search

- **Evidence:** `backend/src/services/catalog.service.ts:360-363` — `EXISTS (SELECT 1 FROM ${productVariantsTable} pv WHERE pv.product_id = ${productsTable.id} AND (pv.duration_label ILIKE ${pattern} OR pv.plan_label ILIKE ${pattern}))` — no `pv.is_active` predicate. Contrast the display path: `fetchVariantPoolData` filters `eq(productVariantsTable.isActive, true)` (`catalog.service.ts:112`), so a deactivated variant never renders in the PDP selector (`VariantSelector.tsx:87-119` disables sold-out plan pills with «— نفد»).
- **Root cause:** the R142 I-2 branch was written against the label axis only; variant deactivation is a live admin write path (`PATCH /products/:id/variants/:variantId` accepts `is_active:false` — `routes/admin/product-variants.ts:380-382`), so the mismatch is reachable without exotic data.
- **Effect:** `search=شهر` (or «نتفلكس شهر») surfaces a product whose ONLY month variant was retired — the result promises a duration the product page's selector will not offer. Same truthfulness class the storefront polices elsewhere (a chip/filter that leads to nothing to buy).
- **Proposed fix:** add `AND pv.is_active = true` to the EXISTS subquery (one predicate); extend `products-arabic-search.test.ts`'s R142 I-2 block with one row: deactivate the month variant → product drops out of `search=شهر` unless another active variant matches.
- **Test requirement:** the row above (pglite route test, real SQL).
- **Risk:** low — strictly narrows recall to sellable-from-the-selector durations.

### L4-3 · P3 · Client-side available-first re-sort overrides the search relevance tiers whenever no explicit sort is picked

- **Evidence:** `frontend/src/pages/home.tsx:298-301` — `const displayProducts = useMemo(() => { if (sort) return products; return [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available)); }, [products, sort]);` — the memo keys on `products`/`sort`, NOT on `search`; `ProductsGrid` renders `displayProducts` (`ProductsGrid.tsx:213`). The backend tiers (`catalog.service.ts:477-501`: tier 0 compound → tier 1 prefix → tier 2, id DESC) are therefore re-sorted client-side for SEARCH results too.
- **Root cause:** R120-B1 (A3-F3/A4-F4) predates the R132 tier system; its comment says "available products lead the DEFAULT view", but the implementation applies to every no-explicit-sort view including search. Lane I recorded the interplay ("knowingly overrides relevance tiers for sold-out rows") without filing it.
- **Effect today:** any in-stock product that matches a search through ANY OR branch — most easily the I-2 variant-label EXISTS arm («شهر» matches nearly every product with a month variant) — jumps to position 1 above exact brand matches. With the live catalog ~98% نفد, a loosely-matching stocked product systematically outranks the tier-0/tier-1 intent (e.g. «نتفلكس شهر»: a stocked non-Netflix month-plan product leads Netflix's rows).
- **Proposed fix:** gate the re-sort on browsing only: `if (sort || search) return products;` (one condition). The نفد-first-UX concern is a browsing problem; a searcher's intent ordering is the relevance tiers.
- **Test requirement:** extend `home-decomposition-r136.test.ts` (or a small ProductsGrid/home test): with search active and no sort, display order === products order when availability differs.
- **Risk:** low — sold-out exact matches will again lead their own queries (intended: they match the intent; the نفد badge + default-view re-sort still front stock for browsing).

### L4-4 · P4 · Explicit sorts lack a deterministic tiebreaker (price_asc / price_desc / popular)

- **Evidence:** `backend/src/services/catalog.service.ts:474-476` — `query.orderBy(productsTable.price)` / `orderBy(sql\`${productsTable.price} DESC\`)` / `orderBy(sql\`${orderExpr} DESC\`)` — single-key ORDER BY, no `id DESC` tiebreak; the default and relevance paths DO carry it (`:500-502`). Live tie-group for `sort=popular` is essentially the whole catalog (most products have 0 completed orders). The only sort pin is first-row-only (`products-arabic-search.test.ts:456-468`).
- **Root cause:** the R118/R132 ordering work added tiebreaks to the tiers it touched; the three explicit sorts predate that discipline.
- **Proposed fix:** append `, id DESC` (or ASC) to each of the three; one test asserting full deterministic order over a tie group.
- **Test requirement:** route test: two same-price rows + `sort=price_asc` → stable documented order across two calls.
- **Risk:** none (ordering-only; result sets unchanged). Note: the no-search list is 30 s in-process cached, so instability mainly shows on uncacheable `search+sort` requests.

### L4-5 · P4 · `GET /api/products/:id/recommendations` answers 200 + live peers for hidden (archived/deactivated) product ids

- **Evidence:** `backend/src/services/catalog.service.ts:717-721` — the category-lookup select (`SELECT category FROM products WHERE id = ?`) has NO `is_active`/`is_archived` filter, so `found: true` for hidden ids; the peers query itself filters (`:749-756`). Contrast the sibling detail routes, which 404 for deactivated/archived (R110 110-F, pinned in `catalog-security.test.ts:273-295`) — the recommendations route is the one public product surface without the visibility mirror.
- **Root cause:** the 110-F sweep covered `/by-slug` and `/:id`; the recommendations loader's first stage was missed.
- **Proposed fix:** add `eq(productsTable.isActive, true), eq(productsTable.isArchived, false)` to the lookup; one route test row (archived id → 404).
- **Test requirement:** `product-recommendations.test.ts` currently pins unknown-id → 404 only (`:141-145`); add archived/deactivated rows.
- **Risk:** none user-visible today (the PDP 404s before the rail mounts) — it's an API-contract inconsistency and a latent leak surface for future consumers.

### L4-6 · P4 · `POST /api/cart/items` accepts ARCHIVED products (is_active-only visibility check)

- **Evidence:** `backend/src/routes/cart.ts:207-214` — `where(and(eq(productsTable.id, product_id), eq(productsTable.isActive, true)))` — no `isArchived` predicate; the 201 response returns the archived product's name/slug/price via `buildCartItemResponse`. Every catalog surface (list/search `catalog.service.ts:366`, detail `:610-612`, sitemap `seo.ts:261,291`) excludes archived; checkout refuses it (PRODUCT_STALE re-read `checkout.service.ts:474-479`).
- **Root cause:** the cart add guard was written against the single-flag model; the archived flag post-dates it.
- **Proposed fix:** add `eq(productsTable.isArchived, false)` to the product lookup; test row: archived product add → 404.
- **Test requirement:** `cart.test.ts` extension (one row).
- **Risk:** none — display-only surface (the route's own comment: "the frontend never calls these routes"), and checkout already fails closed.

### L4-7 · P4 · Persian glyph folds still missing (I-6 recorded debt — re-confirmed at HEAD)

- **Evidence:** probe at HEAD: `normalizeArabicText("دیزنی")` → `"دیزنی"` unchanged; `expandArabicSearch("دیزنی")` → `nameTerms: ["dzn"]`, no disney term → 0 results. `arabic-search.ts:61-86` folds Arabic-Indic digits only (٠-٩); no `ی→ي` (U+06CC), `ک→ك` (U+06A9), or Persian digits ۴-۹ (U+06F0-F9).
- **Root cause / status:** recorded R142 debt (ledger P4 list: "I-6/I-7/I-8 … recorded as debt"). Libyan Arabic keyboards emit standard Arabic; likelihood low (paste-from-Persian-site failure mode).
- **Proposed fix (when touched):** three map entries as lane I specified.
- **Test requirement:** unit rows for each fold.
- **Risk:** rare users get silent zero-result searches — the honest empty state (I-5/R132 category escapes) now cushions it.

### L4-8 · P4 · Dormant contract: product-level stock counts variant-scoped units that a deactivated variant can no longer sell

- **Evidence:** the product-level stock aggregates count ALL deliverable unsold units regardless of variant visibility (`catalog.service.ts:423-431` stockSub; detail `:620-636`), while sellability is claim-pool-scoped to ACTIVE variants (`manual.provider.ts:50-79`: selected variant's scoped pool + generic; `fetchVariantPoolData:112` active-only). If a variant holding scoped stock is deactivated (PATCH is_active:false — no unsold-scoped-units guard, `product-variants.ts:380-382`), the card/PDP would show «متوفر (N)» while every selectable option is نفد → checkout OUT_OF_STOCK — the R142 F1 class verbatim.
- **Why P4 and not P3:** the schema itself documents this seam as a KNOWN dormant contract — `shared/db/src/schema/inventory.ts:29-39`: "Dormant today (no production write path sets variant_id — scoped uploads are consciously-deferred work), but the moment scoped uploads ship, the admin variant-DELETE guard MUST also 409 on unsold scoped units for that variant — ship the guard in the SAME change." Verified: admin inventory upload inserts generic-pool rows only (`admin/products.ts:923-935`, no variantId), the claim UPDATE stamps only `isSold/soldAt` (`manual.provider.ts:114-118`), and no script writes variant_id (`rg variant_id scripts/` → none).
- **Proposed fix:** when scoped uploads ship (per the schema contract), add the same guard to the PATCH-deactivate path (409/warn on unsold scoped units), and consider gating product-level `is_available` on "any ACTIVE variant claimable OR generic pool > 0" (it already equals that in the generic-only world).
- **Test requirement:** none now (no reachable write path); a guard test ships with scoped uploads.
- **Risk:** zero today; recorded so the contract survives the next round.

### L4-9 · P4 · I-7 search-history dropdown debt re-confirmed (re-opens on first keystroke, rows unfiltered)

- **Evidence:** `frontend/src/pages/home.tsx:130` — `setShowSearchHistory(val.length > 0 && searchHistory.length > 0);` inside `handleSearchChange`; rows render the raw history with no prefix filter. Recorded R142 debt (ledger: "I-6/I-7/I-8 … recorded as debt"). Still present at HEAD; one-line fix as lane I specified.
- **Risk:** cosmetic oddity on every typed search with history present.

---

## Verified-OK highlights (no finding)

- **Hidden products don't leak** into search/list (`catalog.service.ts:366` `is_active ∧ ¬is_archived`; pinned `products-arabic-search.test.ts:188` + `:578` for the EXISTS arm), the sitemap (`seo.ts:261,291`), or the detail routes (110-F, `catalog-security.test.ts` 8 ✓ — the one gap is recommendations' lookup stage, L4-5).
- **Filter composition is honest ANDs:** search ∧ category composes (test `:197`, live-checked lane I); stale-filter + empty-result UX is the I-5 honest copy; URL-driven state is whitelisted + pinned (`home-filters-url.test.tsx` 5 ✓ incl. bogus-value whitelisting and replaceState mirroring; `orders-filter-url.test.tsx` 3 ✓). No duration/price/brand FACET filters exist by design (45-product catalog) — brand chips navigate to category landings.
- **Availability truth is otherwise solid:** product-level `is_available` = deliverable-unit stock (R102 ghost rows excluded — `deliverableUnitCondition` `catalog.service.ts:62-67`); «تبدأ من» is availability-aware (R130 `displayBaseFromVariants` `:237-245`); flash-sales cards filter `is_available` (`flash-sales.tsx:234-246`); category pages show REAL counts (`category.tsx:356-358`) with an honest empty state (`:381-397`); Product-LD Offer asserts OutOfStock when the UI says نفد (D2-F2 via `product-seo.ts:83`); low-stock signal is single-definition (`cart.tsx:122` `LOW_STOCK_THRESHOLD = 3`, shared by card + cart lines, «متبقٍ N فقط»).
- **Sold-out variant handling mid-checkout exists at three layers:** cart mount re-quote drops drained/archived lines with notices (`checkout.tsx:241-301`, pinned by `checkout-variant-drain.test.tsx`); PDP pre-buy re-quote aborts on price/variant change (`product.tsx:250-315`); the claim itself is `FOR UPDATE SKIP LOCKED` + fast-fail OUT_OF_STOCK (`checkout.service.ts:339-369`, `manual.provider.ts:40-80`).
- **Pagination/boundedness:** public list is LIMIT 500 by design (no pagination UI — catalog-sized, `catalog.service.ts:468-472`); admin products list capped at 200 with scoped aggregates (`admin/products.ts:94-133`); sitemap capped at 50 000 − statics.
- **Search robustness re-verified at HEAD:** LIKE-wildcard escaping on every expanded term incl. the EXISTS pattern (`escapeLikeTerm`, `catalog.service.ts:361,406-412`); adversarial bounds intact (≤8 tokens, ≤6 variant terms, ≤3 skeletons, ≤4 windows/position — probed); mixed-script English↔Arabic rides along with Latin-twin dedup (probe: `نتفلكس netflix` → single netflix branch); single-char queries degrade to the honest empty state (probe: `ن`/`نت` → no branches); prefix beats containment and explicit sorts beat relevance (pinned `products-arabic-search.test.ts:446-468`).
- **Category↔SEO parity:** backend shell meta is pinned verbatim to `categories.ts` by source-parsing (`spa-shell-category-parity.test.ts` 8 ✓); the I-4 edit propagated to all four copies (frontend meta, shell meta, hero chips, BRANDS table).

**Verdict:** all seven R142 catalog/search fixes are real at HEAD and green under
re-run. What remains in this lane is polish-grade: one stale-copy residue of the
I-4 sweep (L4-1), one missing `is_active` predicate on the new I-2 EXISTS arm
(L4-2), one deliberate-but-now-questionable client re-sort that inverts search
relevance under the sold-out catalog (L4-3), and contract-hygiene items on the
sort tiebreak, the recommendations/cart visibility mirrors, and two recorded
debt confirmations.
