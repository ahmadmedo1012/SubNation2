# R128-B6 — SEO live + Arabic copy quality (discoverability & language excellence)

**Agent:** R128-B6 · **HEAD:** `7d469d5` (= live production — entry hash `index-DU6n5OLO.js` re-confirmed via shell probes today) · **Mode:** READ-ONLY (this report + one worklog append only). Live guest-level GET/HEAD probes + one Playwright Chromium instance (ar-LY); backend parity suites executed read-only (2 files, 14 tests, green). Zero mutations.

**Read first, not re-reported:** R127-B12 (SEO live), R127-B14 (Arabic/data quality), R126-A8 (copy sweep + canon table), R126-A11, R128-B1 (residual ledger — items 5/12/14 cover the copy-canon + B14-C1/C2/C3 carry), R128-A4 (typography), R128-A2 (storefront visual — owns /products dead-route + gate UX), R128-B3 (security). All known items are pointer-only here.

---

## 1. R127 fixes — live verdicts (the core verification duty)

| R127 fix | Live evidence today | Verdict |
|---|---|---|
| **Home shell meta** (808fa75 — express.static directory-index bypass) | `curl -s https://subnation.ly/` (no JS): title `سوق الاشتراكات الرقمية في ليبيا \| SubNation` (43 ch) + description «متجر إلكتروني متخصّص لشراء اشتراكات الخدمات الرقمية في ليبيا — نتفلكس، سبوتيفاي، يوتيوب، ديزني+ وأكثر. الدفع بالدينار الليبي، تسليم فوري، دعم محلي.» (147 ch) + og twins + canonical `https://subnation.ly/` + `index,follow`. | **FIXED & LIVE** — B12-F1 closed. The money query («سوق الاشتراكات الرقمية في ليبيا») now leads the shell title for non-rendering engines. |
| **Flash-sales de-stale** (B12-F2) | Shell description = 140 ch «عروض فلاش بخصومات حقيقية لفترة محدودة على اشتراكات نتفلكس وسبوتيفاي و ChatGPT و VPN — بالدينار الليبي مع تسليم فوري بعد الدفع في كامل ليبيا.» — the A10-F3 copy, byte-equal to `flash-sales.tsx`. | **FIXED & LIVE** |
| **Route-parity suite (6 tests)** | Read in full + executed: `spa-shell-route-parity.test.ts` (6 tests: home ×2, flash-sales/support/terms via `it.each` ×3, flash pin ×1) + `spa-shell-category-parity.test.ts` (8 tests) → **14/14 green** (12.3 s). The suite extracts each page's `useSeo` block **as text**, brace-matches it, and pins title+description VERBATIM against `SHELL_HOME_META`/`SHELL_STATIC_ROUTE_META`. | **PINS ALL STATIC BASELINES.** Static surface = home (this suite) + flash/support/terms (this suite) + 7 categories (category suite) + products (DB-backed per-slug rewrite). No static baseline rides unpinned copy. |
| Arabic copy batch 9e65bab (spot-verified at HEAD, shipped live) | «رمز الإحالة» canon: `register.tsx:116/137`, `referrals.tsx:159/324`, `profile.tsx:348`, `topup.service.ts:549/603` — all رمز, zero كود. Wallet allowlist honesty: `wallet.ts:317` = «شبكة الدفع غير صالحة (المسموح: ليبيانا، مدار، سداد، LyPay)» — all 4 allowlist values, matches `PAYMENT_NETWORK_ALLOWLIST` (wallet.ts:49). Enrichment digit mandate: `services/enrichment/prompts.ts:46/68/90` — «استخدم الأرقام الغربية (0-9) في كل المخرجات» ×3 (B14-6 closed). | **HELD at HEAD** |

**Redirect digit churn (observation, matches the N1 prediction):** today `http→https` = **302** (B12 saw 307 on 10-09), `www→apex` = **301** (B12 saw 308). Both path-preserving, single-hop from www. `OPERATIONS_RUNBOOK.md:451-461` already carries the "Traefik-regen-dependent" parenthetical — the doc's current «301» happens to match today; the standing ops item (permanent scheme redirect) is unchanged. No action beyond the already-filed N1 doc-class note.

---

## 2. Per-route meta sweep (live shell, no-JS + rendered DOM)

18 shells fetched + 6 rendered via Playwright. **All indexable routes: Arabic keyword-forward titles (21–53 ch), unique, complete descriptions (87–147 ch, no mid-word truncation), self-canonical, `index,follow`.**

| Route (shell) | Title (ch) | Robots | Canonical | og:image | Notes |
|---|---|---|---|---|---|
| `/` | سوق الاشتراكات الرقمية في ليبيا \| SubNation (43) | index,follow | self | opengraph.jpg + 1280×720 pair | rendered adds og:url/locale `ar_LY`/site_name + twitter:title |
| `/flash-sales` | عروض فلاش — SubNation (21) | index,follow | self | opengraph.jpg + dims | desc 140 ch de-staled |
| `/category/streaming` | البث المباشر في ليبيا — Netflix و Disney+ \| SubNation (53) | index,follow | self | opengraph.jpg | 7/7 categories identical pattern |
| `/category/music` | اشتراكات الموسيقى في ليبيا — Spotify \| SubNation (48) | index,follow | self | — | |
| `/category/software` | مفاتيح Windows وبرامج أصلية في ليبيا \| SubNation (48) | index,follow | self | — | |
| `/category/vpn` | اشتراكات VPN في ليبيا — ExpressVPN \| SubNation (46) | index,follow | self | — | rendered H1 = title-minus-brand ✓ |
| `/category/ai-tools` | اشتراك ChatGPT Plus في ليبيا \| SubNation (40) | index,follow | self | — | names 2 real products incl. Shopia AI |
| `/category/seo-tools` | أدوات SEO في ليبيا — Ahrefs و Semrush \| SubNation (49) | index,follow | self | — | |
| `/category/education` | اشتراكات Skillshare و Scribd في ليبيا \| SubNation (49) | index,follow | self | — | |
| `/product/netflix-premium` | Netflix — اشتراك أصلي بالدينار الليبي \| SubNation (49) | index,follow | self | **`/products/netflix.webp`** (dims pair correctly stripped — 0 occurrences) | og:type lifts to `product` rendered |
| `/product/chatgpt-plus` | ChatGPT Plus — … (54) | index,follow | self | `/products/chatgpt-plus.webp` | |
| `/product/spotify-premium` | Spotify Premium — … (57) | index,follow | self | `/products/spotify-premium.webp` | |
| `/product/windows-10-pro` | Windows 10 Pro — … (56) | index,follow | self | `/products/windows-10-pro.webp` | |
| `/product/ipvanish` | IPVanish VPN — … (50) | index,follow | self | `/products/ipvanish.webp` | |
| `/login` `/register` | SubNation — سوق الاشتراكات الرقمية (34) | **noindex,follow** | **stripped** | opengraph.jpg | robots.txt-Disallowed too |
| `/cart` | SubNation — … (34) | **noindex,follow** | **stripped** | — | rendered upserts «سلة المشتريات — SubNation» + desc «راجع مشترياتك قبل إتمام الطلب.» |
| `/status` | SubNation — … (34) | **noindex,follow** | stripped | — | |
| `/product/dead-slug` | shell 404 → rendered «الصفحة غير موجودة — SubNation» | noindex,follow | rendered → `/404` | — | known #12 (synthetic canonical) |
| `/category/gaming` (retired) | — | **noindex,follow** | — | — | coherent retired-family policy |
| `/product/does-not-exist-xyz` | **HTTP 404** (real status) | — | — | — | soft-404 fix held |

- **Title uniqueness:** 45/45 live `seo_title`s unique (DB census via by-slug detail sweep), 46–64 ch; the 2 over-60 (`lifetime-cloud-storage` 64, `hallmark-movies-now` 61) clamp live with Arabic-safe word-boundary ellipsis — verified in the shell: `Lifetime Cloud Storage — اشتراك أصلي بالدينار الليبي | SubN…`.
- **noindex policy — consistent three layers:** robots.txt Disallow family ≡ `SHELL_NOINDEX_RES` (app.ts:1283-1298) ≡ `NOINDEX_ROUTES` fallback (App.tsx). Cart/login/wallet/checkout/orders/status/admin all `noindex,follow` + Disallowed + shell-canonical-stripped. index,follow appears ONLY on / + categories + products + support + terms + flash-sales. Coherent, belt-and-suspenders (blocked-crawl + noindex), correct for a storefront.
- **Layer asymmetry (known #12 family, pointer):** shell strips canonical on noindex routes; rendered MetaTags re-adds self-canonicals there (verified rendered `/cart` canonical → `/cart`, 404 → `/404`). Stance documented since R124-A10 #12.
- **hreflang:** sitemap-only, 56×`ar` self + 56×`x-default` self (112 tags verified) — single-locale CORRECT, the deliberate refusal of a phantom `en` is code-commented (seo.ts:192-196). Page-HTML hreflang absent (sitemap mechanism only — known R126-A11 note).
- **og:image resolution:** `opengraph.jpg` → 200 `image/jpeg` 39,597 B (real 1280×720 = declared); 5/5 sampled per-product `.webp` → 200 `image/webp` (~450px art, dims honestly omitted). R124's per-entity og fix **held**.

## 3. Structured data — verdict: PRESENT, complete, honest (no proposal warranted)

Rendered-DOM evidence (Playwright, today): `/` = `Organization`+`WebSite`+`ItemList`; `/category/vpn` = `BreadcrumbList`+`FAQPage`+`ItemList`; `/product/expressvpn` + `/product/sophia-ai` = `Product`+`BreadcrumbList`+`FAQPage`. Product facts live-verified: `price:"79.80"`, `priceCurrency:"LYD"`, `availability:"https://schema.org/OutOfStock"` (mirrors the live 1/45 stocking reality + the UI's «نفد» badge — the honest pattern), `category:"شبكات VPN"` (chip-brevity canon). CollectionPage-omission, aggregateRating-omission, and client-side injection are documented deliberate decisions (R124-A10 §3, re-verified R127-B12 §1). **No JSON-LD work is warranted; the minimal-correct proposal the brief asked for is already shipped and richer.** The one SEO unlock that remains is the operator's GSC token (§7).

## 4. Sitemap/robots truth

- **56/56 locs → 200** (8-way parallel HEAD sweep, zero non-200, zero redirects inside the sitemap — no wasted/redirecting locs).
- Set = home + 7 categories + support + terms + flash-sales + 45 products. **`/products` honestly absent** (the A2-F3 dead conventional route is not advertised). 14 archived products excluded; product set == live active catalog (45=45, via /api/products cross-check).
- **lastmod:** 54 tags, all inside `2026-09-20T20:14:59.099Z→20:15:19.151Z` (the bulk-import window) — unchanged since B12 (no catalog edits since). Per-entity code confirmed previously; honest-not-fabricated. **Do not fake freshness** — divergence arrives free with the first real catalog edit (also the stocking backlog's side effect).
- **changefreq/priority sane:** `/`=daily/1.0, `/flash-sales`=daily/0.8, 7 categories=weekly/0.9, 45 products=weekly/0.8, support=monthly/0.4, terms=yearly/0.3 — a rational tiering.
- **robots.txt** matches code verbatim; Allow surface == indexable surface; nothing disallowed is sitemap-listed (set-diff empty); `/api/` blocked (correct — JSON API has no SERP value).

## 5. Arabic copy quality hunt (beyond R126/R127) — LIVE-surface findings

Method: 45/45 live product details (`/api/products/by-slug/:slug` — `description_long` + `usage_terms` + 4-FAQ + features = **599 texts / 49,415 chars**), byte-precise codepoint scans (Arabic-Indic digits, double spaces, Latin commas in Arabic runs, mixed-script spacing, tanween placement, English common-word leaks), rendered-DOM reads (home hero/cards/alts, category bodies, PDP bodies), checkout label extraction, guest-gate probes. Clean at scale: **0 Arabic-Indic digits, 0 double spaces, 0 Latin commas in Arabic text, 0 empty fields, 45/45 usage-terms + FAQ + SEO coverage** (B14's aggregate re-held). What remains:

### Findings

| # | Sev/Conf | Site (live) | Exact copy (byte-verified) | Fix directive |
|---|---|---|---|---|
| **B6-F1** | **P3**/5 | `amc-plus` `seo_description` — **live meta on an indexable product URL** | «AMC+ بمسلسلات **The Walking Dead universe** وإنتاجات AMC وBBC America.» | **English leak in shipped meta**: "universe" is untranslated inside an Arabic sentence (compare the same entry's own `desc_long`, which renders it correctly as «مسلسلات The Walking Dead بكل فروعها», and disney-standard's «عالم ديزني»). → «بمسلسلات عالم The Walking Dead وإنتاجات AMC وBBC America». One DB edit + the enrichment prompt gains a no-untranslated-common-English line. |
| **B6-F2** | **P3**/5 | `netflix-premium` `description_long` (renders on the PDP) | «استمتع بمكتبة Netflix الضخمة من الأفلام والمسلسلات والوثائقيات **برمج عالمي،** بجودة تصل إلى 4K Ultra HD…» | **Broken iḍāfa from the LLM enrichment**: «وثائقيات برمج عالمي» (codepoints verified: بر-م-ج = `0x628 0x631 0x645 0x62c`, no article, masc. adj. on fem. plural noun) — reads as "documentaries programs worldwide". → «وثائقيات ببرامج عالمية» (or «وثائقيات وإنتاج عالمي»). One DB edit; flags the enrichment validator gap (validator.ts checks shape/digits, not grammar). |
| **B6-F3** | **P3-strategy**/4 | 45/45 product `seo_title`/`seo_description` vs `docs/SEO_PRODUCTS.json` | Live Netflix title: «Netflix — اشتراك أصلي بالدينار الليبي \| SubNation» vs the curated artifact: `primary_keyword:"اشتراك نتفلكس بريميوم"`, `seo_title:"اشتراك نتفلكس بريميوم 4K — تسليم فوري في ليبيا \| SubNation"` | **The keyword strategy never landed on the catalog.** Census: **0/45** live product metas contain the transliterated brand tokens Libyans type (نتفلكس/سبوتيفاي/يوتيوب); only ديزني (1, generic word) and تخزين سحابي (1) appear. `import-seo.ts` writes **description_long + faq only** — the JSON's researched titles/descriptions are "source of truth for editors" (import-seo.ts:47) but unapplied; live titles came from the brand-first pattern. The transliterations DO live on home meta + hero («نتفلكس وديزني+ وشاهد… سبوتيفاي… ويندوز… إكسبريس») and in `arabic-search.ts` (in-site search) — so the site ranks its home page for dialect queries but its **transactional landing pages** (the ones with Product LD + price) carry none. → Operator decision (data, not code): apply the JSON's keyword-forward `seo_title`/`meta_description` (all within 60/160 after the «\| SubNation» tail) to the 45 rows, or document brand-first as deliberate. Highest-ROI content action available without touching code. |
| **B6-F4** | P4/4 | repo ×18 sites + live DB ×8 (expressvpn, cpanel, +6) | tanween placement split for final-yāʾ adverbs: «عالميًا، شهريًا، سنويًا، علميًا، يدويًا، حاليًا، تلقائيًا، رقميًا» (يً ×18 repo / ×8 DB) vs «حالياً» ×30, «تلقائياً» ×19, «عالمياً» ×1, «يدوياً» ×6 (ياً ×56 repo / اً ×111 DB) | Both are defensible orthographies (يًا is the classically-correct seat, ياً the modern convention) — but the split is intra-codebase drift of exactly the B14-2/B14-9 class. → pick one (ياً is the 76%-majority + more common in web copy), sweep the 26 minority sites, add to the planned copy-canon doc (B1 item 5). |
| **B6-F5** | P4/4 | `docs/SEO_PRODUCTS.json` (Disney+ entry seo_title + keywords) | «اشتراك ديزني بلس — ديزني، **ماربل**، ستار وورز في ليبيا \| SubNation» (ماربل ×4 in file) | **Marvel misspelled in the editor source-of-truth** — live DB is correct (مارفل ×5, 0 ماربل). Would ship on the next force-import. → 4 byte edits. Same file: ~10 stale slugs (e.g. `netflix` vs live `netflix-premium`, `disney-plus` vs `disney-standard` — the B14-C1 naming mismatch mirrored into the artifact; import works via name-fallback but the drift is real). |
| **B6-F6** | P4/5 | `amc-plus` `description_long` (live PDP) | «عالم **AMC+ :** مسلسلات The Walking Dead بكل فروعها…» | Space before the colon after the Latin token («AMC+ :» → «AMC+:») — the spacing-bug family, RTL-rendering makes it a visible gap. One DB edit. |
| **B6-F7** | P4/3 | `semrush-classic` variant labels (live pill row) | «احترافي — شهري / **جورو** — شهري / أعمال — شهري / …» | Translation-policy mix inside one pill row: Pro→احترافي (translated), Business→أعمال (translated), Guru→**جورو** (transliterated). Extends the B14-C2 windows-8 mixed-axis family. → pick per-row policy (translate all: «خبير»؟ — or keep official plan names Latin: Pro/Guru/Business). Operator data decision. |
| **B6-F8** | P4-note/5 | `frontend/index.html:173` (no-JS body) | `<div id="static-offline">يتطلب الموقع تشغيل JavaScript</div>` — the entire raw-HTML body | **The no-JS baseline is a stub**: title/description/canonical/og are strong (§2), but the body carries one line and **zero headings, zero product content**. Google renders JS so indexing is unaffected (structured data + full copy verified rendered); secondary engines and link-unfurlers see meta-only. Fixing = SSR/prerender (M-L lane) — record as deliberate SPA tradeoff (it already is, R124-A10 §3) or backlog it. Not a regression; evidenced for the record. |

**Counts: P0 0 · P1 0 · P2 0 · P3 3 (F1-F3) · P4 5 (F4-F8).**

### Copy verified-OK on live surfaces (new evidence this round)
- **Home hero** (rendered): H1 «سوق الاشتراكات الرقمية في ليبيا» = the money query; hero paragraph is indexable-quality MSA marketing copy WITH the dialect transliterations: «سوق إلكتروني متخصّص في بيع الاشتراكات الرقمية للسوق الليبي. تجد على المنصّة اشتراكات البثّ المباشر مثل نتفلكس وديزني+ وشاهد، وخدمات الموسيقى مثل سبوتيفاي، ومفاتيح البرامج مثل ويندوز، وشبكات VPN مثل إكسبريس…»; dual-script chips («Netflix نتفلكس»); honest «نفد» badges; «تبدأ من 980.00 د.ل» Western digits.
- **Category meta quality** (all 7): each names 3-5 real catalog products + «بالدينار الليبي» + «تسليم فوري» + a Libya geo-token; rendered category H1 mirrors title; H2/H3 hierarchy clean («منتجات شبكات VPN (4)» / product names).
- **Image alts: 45/45 templated descriptive** — «{name} — اشتراك {category label}» (e.g. «Semrush Classic — اشتراك أدوات SEO»), documented rationale in-code (ProductCard.tsx:387-401 — "helps Google Image search"); the «أدوات ذكاء اصطناعي» alt form is the documented chip-brevity canon (utils.ts:150-156, R124-A10-F8c), NOT a defect; PDP mirrors the same builder.
- **Checkout labels** (source extraction): «تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة» (canon verb), «إتمام الطلب» CTA, honest per-line pricing labels; guest gate `/checkout → /login?redirect=/checkout` noindex; admin gate h1 «لوحة الإدارة» (canon, not لوحة الأدمن) noindex.
- **DB long copy at scale:** 599 texts — 0 numerals violations, 0 punctuation defects, 1 English leak (F1), 1 grammar slip (F2), 1 spacing bug (F6) — the R126→R128 enrichment pipeline output is ~99.5% clean Arabic.
- **API guest errors:** `/api/products/<dead-slug>` → 400 `«معرف غير صالح»/INVALID_DATA` (a 404 «المنتج غير موجود» would be more precise — cosmetic, machine-surface only); `/api/admin/products` → 401 `«غير مصرح»` (the FE code-map never surfaces raw API strings; B14-13's actionable-wording note covers the family).

## 6. Search-competitiveness snapshot (no SERP access — token-level assessment)

| Query an Arabic buyer would use | Where our high-intent tokens live today | Gap |
|---|---|---|
| «سوق الاشتراكات الرقمية ليبيا» | Home title+H1+description — exact match | — |
| «اشتراك VPN ليبيا» | `/category/vpn` title «اشتراكات VPN في ليبيا — ExpressVPN \| SubNation» + H1 | — (category is the landing page; strong) |
| «شراء ChatGPT بلس ليبيا» | `/category/ai-tools` title «اشتراك ChatGPT Plus في ليبيا…» + product title «ChatGPT Plus — اشتراك أصلي…» | product title lacks ليبيا (has بالدينار الليبي); tier word بلس absent (Plus only) — minor |
| «اشتراك نتفلكس بريميوم» | Home meta + hero ONLY; Netflix PDP title/description carry neither نتفلكس nor بريميوم | **B6-F3** — the transactional page is invisible for the dialect query |
| «رخصة سي بانل» | SEO_PRODUCTS.json only (`primary_keyword:"رخصة سي بانل"`); live cPanel title is «cPanel — اشتراك أصلي بالدينار الليبي» | **B6-F3** |

**Keyword strategy documentation:** no `docs/seo/` directory exists; the strategy lives as DATA in `docs/SEO_PRODUCTS.json` (45 entries: primary/secondary/long-tail/semantic keywords + search_intent + curated seo_title/meta_description — sampled 5: Netflix/Spotify/Disney+/cPanel/Lifetime Cloud Storage, all rich and honest, keyword density sane for an internal artifact: نتفلكس ×32 across a whole entry incl. keywords arrays is fine) + `docs/history/seo-enrichment-r116.md`. **The gap is not research, it's application** (F3) — plus the ماربل/stale-slug hygiene (F5). A one-page `docs/seo/KEYWORD_STRATEGY.md` stating the decision (apply-or-brand-first, dialect-transliteration policy per category) would close the documentation hole for ~zero effort.

## 7. Performance-adjacent SEO

- **No-JS body:** stub (B6-F8) — meta-complete, body-empty. Deliberate, documented SPA tradeoff since R124-A10 §3.
- **Rendered heading structure:** home h1 + 2 h2; categories h1/h2/h3 clean; PDP = h1 + one h2 («قد يعجبك أيضاً») with description/FAQ as `<details>/<summary>` accordions (FAQPage LD carries the structure; FAQ content fully in DOM — acceptable accordion pattern, not a defect; recorded as the PDP's flat-hierarchy note).
- **Alts:** 45/45 (§5); eager/lazy/fetchpriority choreography documented in-code (ProductCard.tsx:404-419).
- **GSC:** `google-site-verification` still ships `content=""` on every page (live-confirmed today) — the token remains the single highest-leverage SEO action (B12 §7 runbook stands, unchanged).

## 8. Next actions (ordered, smallest-effort-first)

1. **Ops (5 min + redeploy):** execute the GSC runbook (B12 §7) — unlocks sitemap submission + rich-result visibility for everything above.
2. **Data (2 DB edits):** B6-F1 (amc-plus seo_description English leak) + B6-F6 (colon spacing) — the only copy defects on a live indexable meta surface.
3. **Data (1 DB edit):** B6-F2 (netflix desc_long iḍāfa) + consider an enrichment-validator note (grammar-class checks are hard; at least pin the two defect classes seen).
4. **Judgment (data batch):** B6-F3 — apply the curated keyword-forward titles/descriptions from SEO_PRODUCTS.json to the 45 rows (or document brand-first as deliberate); ride with B14-C1's naming-convention decision (slugs/tiers) since both touch the same rows.
5. **Doc S:** B6-F5 (ماربل ×4 + stale slugs) + one-page `docs/seo/KEYWORD_STRATEGY.md`; fold B6-F4 (tanween canon) into B1 item 5's planned copy-canon doc + guard test.
6. **Operator (rides B14-C2):** B6-F7 variant-label translation policy.

**Verdict: SEO health 9/10 on engineering (meta/canonical/noindex/sitemap/LD all coherent, parity-test-pinned, live-verified end-to-end); the two open levers are content-strategy, not code — apply the researched product keywords (F3) and verify in GSC. Arabic copy baseline remains high; live-indexable-meta defects are exactly two strings.**

— R128-B6, 2026-10-10. Source untouched; live probes read-only; parity suites run read-only; probe artifacts ephemeral in /tmp/b6-seo/.
