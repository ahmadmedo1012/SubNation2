# Lane I findings — Search & catalog intelligence (R142, HEAD a9f5e83)

Read-only audit. 9 inventory files deep-read end-to-end; 16 cross-cut files reviewed
(products route/service/cache/schema, home+category pages, filter components, SEO
importer, sitemap, api-client, CI). All 141 backend inventory tests + 2 frontend a11y
tests re-run GREEN at HEAD. Live probes against https://subnation.ly on 2026-10-13.

What this lane covers: the Arabic search path end-to-end (frontend input → API →
normalization/expansion → SQL → ranking → UI), the catalog filter/sort/pagination
query path, and docs/SEO_PRODUCTS.json vs the live catalog. Load assumed: the live
production storefront (45 products, ~1 stocked, ~600 req/min rate budget) with a
Scale lens at 10k products.

---

## 1. The search path map (verified against code + live)

```
[Input]   home.tsx CatalogFiltersBar — <Input type="search" aria-label="البحث في المنتجات">
          no min-chars gate; typing debounced 320 ms → setSearch(val.trim()) (home.tsx:128-145);
          Enter commits immediately + writes search-history (commitSearch :150-165, cap 8,
          dedupe-move-to-front — R94-A1 #16: history only on committed search);
          URL mirror via replaceState (:214-231); mount seeds from ?search= with
          category/sort whitelists (catalog-filters.ts:65-80).
[Request] useListProducts({fields:"list", search, category, sort, available_only})
          → GET /api/products?… (api.ts:1657-1682, URLSearchParams serialization);
          React Query keepPreviousData + staleTime 3 min.
[Route]   routes/products.ts:32-85 — catalogCache middleware sets edge Cache-Control
          (see I-3); hasSearch ⇒ skips withCatalogCache (B6-02 in-process fix);
          loader → services/catalog.service.ts loadProductList.
[Expand]  expandArabicSearch (arabic-search.ts:477-620): normalizeArabicText →
          tokenize (TOKEN_JUNK strip, ≤8 tokens) → whole-query collapsed phrase lookup
          (I-1 gap) → per-token: category exact/≥4-containment → modifier exact →
          brand exact → brand ≥4-containment → transliteration skeleton (≥3 chars,
          ≤3) → compounds brand×modifier (≤4) → bounded output.
[SQL]     catalog.service.ts:355-459 — WHERE is_active ∧ ¬is_archived
          [∧ LOWER(category)=LOWER(?)] [∧ (raw ILIKE ∨ nameTerms ILIKEs ∨ latinTerms
          ∨ compound AND-branches ∨ category equalities)] — every term escapeLikeTerm'd;
          LEFT JOIN stockSub (deliverable units) + orderSub (completed orders);
          available_only ⇒ COALESCE(stock)>0; LIMIT 500 ($dynamic).
[Rank]    :461-491 — price_asc / price_desc / popular(order_count DESC) explicit;
          default-with-search: tier 0 compound → tier 1 prefix (name ILIKE 'term%')
          → tier 2 rest, id DESC tiebreak; default-no-search: id DESC (الأحدث).
[Respond] rows + flash-sale → availability-aware displayBase + one variants
          follow-up query → ProductListItem[] (list projection omits variant tree).
[Render]  home grid: available-first re-sort when no explicit sort (R120-B1) —
          knowingly overrides relevance tiers for sold-out rows; count + filter-aware
          h2 (dir="auto"); distinct loading/error/empty states + category escape
          links on search dead-end.
```

Sorts ↔ real queries: الأحدث → `id DESC`; الأكثر مبيعاً → `COALESCE(order_sub.order_count,0) DESC`
(left join on completed orders — live: Netflix leads with 2); السعر → `products.price`
asc/desc (import maintains price = MIN(variant price)). All verified live. No
pagination on the public list (LIMIT 500 ceiling by design — catalog-sized).

## 2. Arabic normalization coverage (query side; product names are English by design)

| Fold | Status | Evidence |
|---|---|---|
| Tashkeel diacritics U+064B–U+065F + superscript alef U+0670 | ✅ stripped | arabic-search.ts:49; test :17-21 (`نَتْفَلِكْس`) |
| Tatweel U+0640 | ✅ stripped | same regex; test :22-23 (`نتـفـلـكـس`) |
| Alef variants أ إ آ ٱ → ا | ✅ | :52; test :25-27 (`أمازون`, `إكس`, `آيتونز`) |
| Ta marbuta ة → ه | ✅ | :55; test :29 (`سحابة`) |
| Alef maksura ى → ي | ✅ | :58; test :31 (`ديزنى`) |
| Arabic-Indic digits ٠-٩ → 0-9 | ✅ | :61-86; test :32-34; live `نتفلكس ١٢ شهر` |
| Spaces collapsed for phrase keys («في بي ان» ≡ «فيبيان») | ✅ | :283-290, :382-388 |
| ZWJ/ZWNJ/invisible joiners | ✅ stripped per token (TOKEN_JUNK :414) | probe: `كو‌بوز`→qobuz, `نتفلكس‍`→netflix |
| Standalone hamza ء / carriers ؤ ئ | ⚠️ translit-only (ء→"", ؤ→w, ئ→y), not folded in normalizeArabicText | :102,131-132 — no live alias carries them |
| Persian yeh ی (U+06CC) / kaf ک (U+06A9) / digits ۴-۹ (U+06F0-F9) | ❌ not folded | probe at HEAD: `دیزنی`→skeleton "dzn", no disney term; `۴۵` unchanged then dropped (I-6) |

Prior-round normalization (R122/R132) verified present and real — the alias map's 95
entries all resolve against the live 45-product catalog (checked one-by-one);
restock-ready aliases (شاهد, بلايستيشن…) return [] cleanly (live: search=شاهد → 0).

## 3. Missing-test answer

If نتفلكس stops matching, three layers fail: `arabic-search.test.ts` unit pin
(`["نتفلكس", ["netflix"]]`), `products-arabic-search.test.ts` route integration
(pglite + real router — REAL SQL, zero mocks; ran 30/30 green), and the CI e2e
DOM-parity spec (E2E_ENABLED=1 in ci.yml:565-569). Normalization is genuinely
exercised, not mocked away. The coverage holes are exactly the two gaps below:
no test for multi-word phrase + extra token (I-1), and the route-test seed fabricates
a name shape ("Netflix Premium 1-Month") that the live catalog doesn't use (I-2).

---

## Findings

### I-1 (P3) — Multi-word Arabic phrases break when any other word rides along

- **File:** `backend/src/lib/arabic-search.ts:516-520` (whole-query collapse), `:521-590` (per-token loop).
- **What this is:** Brand/category phrases («شات جي بي تي», «في بي ان», «اتش بي او», «ساوند كلاود», «ذكاء اصطناعي») resolve only when the phrase IS the entire query: `collapsed = tokens.join("")` is looked up once. Any additional token — a filler («اشتراك»), a modifier («برو», «شهر») — makes the collapse miss, and every phrase word then falls through to ≤2-char skeletons that are dropped.
- **Problem (live-verified today):**
  - `search=اشتراك شات جي بي تي` → **0 results** — ChatGPT Plus is invisible; the highest-intent AI query in Arabic finds nothing.
  - `search=شات جي بي تي برو` → **5 results, none ChatGPT** (Grammarly Pro, Windows 10 Pro, HMA VPN Pro, UltimateGuitar Pro, Brain.fm Pro) — the orphaned `%pro%` branch surfaces every "Pro" product while the actual intent is lost.
  - `search=في بي ان سنوي` → **0 results** — even the vpn category branch dies (the category phrase key «فيبيان» only matches the whole-query collapse; the 2-char tokens «في/بي/ان» can't hit it).
- **Fix (minimal):** inside the token loop, when a token doesn't resolve, try collapsed windows of consecutive tokens (lengths 2–4, bounded) against `ALIAS_LOOKUP`/`CATEGORY_LOOKUP`; on a hit add the term and skip the consumed tokens. ~15 lines + two test rows (`اشتراك شات جي بي تي` → chatgpt; `شات جي بي تي برو` → chatgpt∧pro compound).
- **If we skip it:** brand-phrase queries with any natural prefix/suffix (اشتراك…, …برو, …شهر) keep returning empty or wrong-brand results — the exact r122-a11 defect class, one word away from the pinned cases.

### I-2 (P3) — Duration modifier search matches zero live rows: durations live in Arabic variant labels, not product names

- **Files:** `backend/src/lib/arabic-search.ts:355-373` (MODIFIER_ALIASES: شهر→"month", سنوي→"year"), `backend/src/services/catalog.service.ts:391-400` (name-column-only ILIKEs).
- **What this is:** The R132 modifier/compound tiers ILIKE Latin fragments (`%month%`, `%year%`) against `products.name`. Live product names are brand-level («Netflix», «IPVanish VPN», «Disney+») — durations live in `product_variants.duration_label`, stored in **Arabic** («شهر واحد», «سنة كاملة» — verified via `/api/products/by-slug/netflix-premium`).
- **Problem (live-verified):**
  - `search=شهر` → 0; `search=سنة` → 0; `search=شهر واحد` → 0 — «شهر واحد» is the EXACT string the site's own variant selector renders, and search returns nothing.
  - The compound tier «نتفلكس شهر» ranks nothing live (the hit comes from the plain `%netflix%` branch); the documented "«شهر» → every month-plan product" breadth never happens.
  - Tests stay green only because `products-arabic-search.test.ts:273-294` seeds names like "Netflix Premium 1-Month" — a naming shape the live catalog does not use (the seed comment claims it "mirrors the LIVE catalog's … convention"; it doesn't).
- **Fix (minimal, honest):** for duration modifiers, OR an `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id AND (v.duration_label ILIKE '%'||token||'%' OR v.plan_label ILIKE …))` branch — the Arabic token already matches the Arabic labels as-is. Also fix the test seed to the live shape (brand name + Arabic variant labels) so the tier is pinned against reality.
- **If we skip it:** every duration-word query (شهر/سنوي/اسبوع/يوم, alone or beside a brand) returns empty or unranked — plan-level intent, the headline R132 feature, is inert in production.

### I-3 (P3) — B6-02's "search stays uncacheable" holds only in-process; search responses ship edge-cache headers

- **Files:** `backend/src/routes/products.ts:32` (`router.get("/", catalogCache, …)` applies to search requests too), `backend/src/lib/http-cache.ts:23-31`.
- **What this is:** The R111 B6-02 fix removed search from the in-process LRU (route skips `withCatalogCache` when `hasSearch`) to kill the unbounded-key-space self-DoS. But the `catalogCache` middleware still stamps every list response — search included — with `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`.
- **Problem (live-verified):** `curl -D- '…/api/products?search=نتفلكس'` → `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` — byte-identical to the cached list shape. The middleware exists precisely so the CDN honors s-maxage; if it does, every unique `?search=` mints an edge entry for 60s+300s SWR — the same unbounded key space B6-02 eliminated, one layer up. (Whether Cloudflare caches JSON today depends on CDN rules outside the repo; the app's own advertised contract is wrong either way.)
- **Fix:** one line in the GET / handler — `if (hasSearch) res.set("Cache-Control", "private, no-store");` — plus a header assertion in `products-arabic-search.test.ts` (the repo already pins exact Cache-Control strings on other routes, e.g. auth-providers-cache.test.ts:199-200).
- **If we skip it:** the documented invariant and the shipped header disagree; the moment an edge rule honors it, search-result staleness (60s) and cache-key sprawl reappear without any code change here.

### I-4 (P3) — Category landing copy and hero chip advertise brands the live catalog doesn't sell

- **Files:** `frontend/src/lib/categories.ts:48-54` (streaming intro: «نوفر اشتراكات Netflix، Disney+، Shahid VIP، Amazon Prime Video، Apple TV+، Crunchyroll و YouTube Premium»), `:61-62` (metaDescription advertises Shahid VIP), `frontend/src/components/home/catalog-filters.ts:114` (BRANDS hero chip «Shahid VIP»).
- **Problem:** Live catalog has NO Shahid and NO Crunchyroll product (17 streaming names enumerated from `/api/products`; live `search=شاهد` → 0). The streaming landing page at `/category/streaming` — index,follow, FAQPage JSON-LD — promises subscriptions the store cannot sell. This violates the repo's own rules in the same files: catalog-filters.ts:92-97 (R120-B1/A7-F5: "every chip now references a brand the LIVE catalog sells … a chip that filters to nothing misleads shoppers") and home.tsx:370-373 ("every named brand here is verified against the active catalog"). The other 6 category intros were verified clean.
- **Fix:** drop «Shahid VIP» + «Crunchyroll» from the streaming intro and «Shahid VIP» from its metaDescription; swap the Shahid VIP hero chip for a stocked streaming brand (Paramount+/HBO Max). 3 lines. (Or the operator restocks the brand — then leave as is.)
- **If we skip it:** SEO copy on a live landing page keeps making a false availability claim — the exact class the rounds r120/r122 purged from the hero and home meta description.

### I-5 (P4) — `available_only` empty state claims "no match" when matches exist but all نفد

- **File:** `frontend/src/components/home/ProductsGrid.tsx:147-161`.
- **Problem (live-verified):** `search=افلام&available_only=true` → 0 rows while 17 streaming products DO match the search — the emptiness comes from stock, not relevance. The UI renders «لا توجد منتجات تطابق بحثك» + «جرّب تغيير الفلتر أو كلمة البحث» — a false statement about the catalog in a shop whose stated value is truthful availability messaging (98% نفد is a business state the repo insists on describing honestly, cf. R123-E4b's own reasoning).
- **Fix:** when `availableOnly` is the differentiator, vary the hint: «قد تكون هناك نتائج مطابقة لكنها نفد المخزون — جرّب إلغاء فلتر "متوفر فقط"». Copy-level, no new queries.
- **If we skip it:** shoppers conclude the shop doesn't carry what they searched for, when it does.

### I-6 (P4) — Persian glyph folds missing (ی U+06CC, ک U+06A9, ۴-۹ U+06F0-F9)

- **File:** `backend/src/lib/arabic-search.ts:49-86`.
- **Problem (probe-verified at HEAD):** `expandArabicSearch("دیزنی")` → skeleton "dzn" (the Persian yeh is dropped by ARABIC_TO_LATIN), no disney term → 0 results; `normalizeArabicText("۴۵")` leaves the digits, which TOKEN_JUNK then strips (silently dropped instead of folded). Likelihood is low — Libyan Arabic keyboards emit standard Arabic — but it's the paste-from-Persian-site failure mode.
- **Fix:** three entries: extend the digit map with U+06F0–U+06F9, add `ی→ي`, `ک→ك` to the fold chain (one replace each).
- **If we skip it:** rare users get silent zero-result searches with no explanation.

### I-7 (P4) — Search-history dropdown re-opens while typing and lists unfiltered entries

- **File:** `frontend/src/pages/home.tsx:130` (`setShowSearchHistory(val.length > 0 && searchHistory.length > 0)` inside `handleSearchChange`).
- **Problem:** Focus with an empty input opens the history listbox (intended); the FIRST keystroke keeps it open (`val.length > 0`), and the rows are the raw history — no prefix filter. Typing «سبو» shows «نتفلكس», «شاهد»… below the input; one stray tap fires a different committed search. Longstanding (present since commit fd106a9, verbatim through the R136 decomposition), not a regression.
- **Fix:** either close on first keystroke (`val.length === 0 && …`) or filter rows by prefix (`searchHistory.filter(h => h.includes(searchInput.trim()))`). One line.
- **If we skip it:** a cosmetic oddity on every typed search with history present.

### I-8 (P4, Scale lens) — `LOWER(category)` defeats the category index; per-request inventory/order aggregates on every live search

- **Files:** `backend/src/services/catalog.service.ts:357, :398` (`LOWER(products.category) = LOWER($1)`), `:410-428` (stockSub/orderSub), `shared/db/src/schema/products.ts:102-116`.
- **What this is:** The name ILIKEs ride `idx_products_name_trgm` (gin_trgm_ops — the 10k-products answer for search), and `idx_products_active_category` covers raw category equality — but wrapping the column in `LOWER()` makes it unusable, so category-filtered queries seq-scan. Separately, every UNCACHED search request joins a full `inventory GROUP BY product_id` and `orders GROUP BY product_id` aggregate. At 45 products this measured 6.5 ms; at 10k products + a grown inventory the category path is a scan and the aggregates scale with total units.
- **Fix (when crossing ~5k products, not before):** store/compare category slugs lowercase (drop LOWER — the values already are lowercase) or add a functional index on `LOWER(category)`; consider a materialized per-product stock count. Today: leave it; add a `shortcut:` note.

---

## Verified-OK highlights (no finding)

- **SEO_PRODUCTS.json**: 45 entries ↔ 45 live products, category counts exact (17/11/7/4/2/2/2), all fields complete, no retired-category entries. Sole consumer is `scripts/src/import-seo.ts` (operator tool, dry-run default, keep-unless-force, transactional, WARN-on-skip) — no build/runtime/sitemap consumer (sitemap reads the DB). The 4 stale slugs (netflix, disney-plus, prime-video, apple-tv-plus) all still import via the exact-name fallback; staleness is documented in three places. Snapshot-not-truth is a recorded decision, not a defect.
- **Filter interplay**: category ∧ search ANDs honestly (tests + live: «نتفلكس»&category=music → []; «موسيقى»&category=streaming → []); archived/deactivated products never surface in search; LIKE-wildcard queries stay literal (escapeLikeTerm); two different searches never cross-contaminate (uncacheable in-process).
- **Cache safety**: search-skip + 12 MB byte budget + 5,000-entry LRU + generation bump all test-pinned; throw-stores-nothing; null-flash-sale = permanent miss (documented trade-off).
- **Truthful availability**: `deliverableUnitCondition` (credential-bearing units only) flows into every stock count; «تبدأ من» is availability-aware (R130); sold-out cards render with نفد badge rather than hiding.
- **Tests are real**: 111 unit + 30 route (pglite, real SQL, real router) + 2 a11y + CI e2e — all green at HEAD in this lane's runs.

**Verdict:** the R122/R132 Arabic search bridge is genuinely built and genuinely
tested, but two of its headline behaviors are dead against the live catalog shape
(I-1 phrase breakage, I-2 variant-label durations) — both small, both
high-intent-query facing. Fix I-1 and I-2 first; I-3 is a one-line contract fix;
I-4 is three lines of honest copy.

**Lean:** no deletions proposed — the lane found no dead code; the arabic-search
module is dense but every table carries live consumers.

**Not checked:** e2e/search-arabic.spec.ts not executed (needs browser+deployed
base URL; statically reviewed + CI wiring verified); Cloudflare edge rules (outside
the repo — I-3 judged on the app's own emitted header); admin products/variants
routes (owner lane DB/backend); ProductCard internals (owner lane C).
