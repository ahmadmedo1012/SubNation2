# R127-B12 — SEO live deep audit (measurement + code)

**Agent:** R127-B12 (read-only auditor) · **Commit:** f53a886 (= production subnation.ly, verified live 2026-10-09+) · **Method:** live guest-level GETs/HEADs (curl + headless Chromium via agent-browser for the rendered DOM), full code walk of `frontend/src/components/seo/*`, `frontend/src/lib/seo-builders.ts`, `frontend/src/hooks/useSeo.tsx`, `frontend/src/App.tsx` (routes + `NOINDEX_ROUTES` + fallback), `backend/src/app.ts` (SPA shell rewriter :1150-1524), `backend/src/routes/seo.ts` (robots/sitemap), `frontend/vite.config.ts` (seoHeadInject), `Dockerfile`, `docs/deployment/COOLIFY_FINAL_SETUP.md` §2.2. Raw artifacts in `/tmp/b12-seo/` (ephemeral). Zero production mutations, zero commits.

**Headline verdicts**

| Scope item | Verdict |
|---|---|
| 1. JSON-LD | **PRESENT — complete for the site's shape; NO implementation plan needed.** Live-rendered: home = Organization+WebSite(+SearchAction)+ItemList, product = Product(+Offer LYD, honest OutOfStock)+BreadcrumbList+FAQPage, category = BreadcrumbList+FAQPage+ItemList, support = FAQPage. Client-injected (JsonLd component) — known, documented SPA tradeoff (R124-A10 §3); raw HTML ships 0 ld+json scripts. |
| 2. Sitemap truth | **56/56 URLs → 200. Product set == live active catalog (45=45 exact). lastmod = per-entity real `updated_at` (code-verified) but all 54 values fall inside the 2026-09-20 20:14:59→20:15:19 import window (no content edits since import) — known carryover, honest-not-fabricated. hreflang = 56×`ar` self + 56×`x-default` self, no phantom `en` — single-locale CORRECT. Unstocked-inclusion policy: KEEP all 45 (justified §2.4).** |
| 3. Redirects | `http→https` = **307** temporary (digit drifted 302→307; the standing ops item). `www→apex` = **308** permanent (docs said "301 since R124 redeploy, stable ×3" — stale again, as the regen-dependence prediction said). `/products` plural = 200 direct (**R126-L6 fix LIVE**, no double hop). Trailing slash: 200 + identical etag + canonical → no-slash form (consistent). `/index.html` = 200 (known A11-F6). Dead slug = **real 404**. |
| 4. Meta completeness | Rendered head complete (og:url/locale/site_name/type=product, full twitter set — live-verified). Static no-JS baseline = minimal-but-sufficient card (known #11). og:image resolves 200 `image/jpeg` **real 1280×720 = declared dims**; product art 200 `image/webp` 449×449 with dims correctly omitted. Titles Arabic, keyword-forward, unique per product. |
| 5. robots.txt | Sane: private-surface Disallow set + `Allow` surface + `Sitemap:` apex + Crawl-delay 1. `/api/` disallowed (correct). No accidental over-blocking. |
| 6. Runtime coverage | **Complete.** 10 storefront pages carry page-level `useSeo`; every remaining route is in `NOINDEX_ROUTES` (App.tsx:179-194) with the fallback stamping `noindex,follow`; 404 page noindex (live-verified). Admin family: robots-disallowed + shell noindex — correct. |
| 7. GSC readiness | **Nothing else blocks verification.** Empty-content meta ships on every page (build-time inject). Exact operator runbook in §7. |
| 8. Findings | **P0 0 · P1 0 · P2 0 · P3 2 (new, same family) · +2 informational notes.** The surface is unusually mature; the two P3s are SPA-shell-vs-rendered copy drift. |

---

## 1. Structured data — verdict: PRESENT, no plan needed

The brief's hypothesis ("if absent, likely THE biggest SEO gap; produce implementation plan") is **disproven** — this was already audited as VERIFIED-OK in R124-A10 §3 and remains true at f53a886, now with fresh **live rendered-DOM evidence** (headless Chromium, `document.querySelectorAll('script[type="application/ld+json"]')`):

| Route | Live LD types (rendered) | Offer facts (live, netflix-premium) |
|---|---|---|
| `/` | `Organization`, `WebSite` (with SearchAction → `/?search={search_term_string}`), `ItemList` (top 50) | — |
| `/product/netflix-premium` | `Product`, `BreadcrumbList`, `FAQPage` | `price:"79.80"`, `priceCurrency:"LYD"`, `priceValidUntil:"2027-12-31"`, `availability:"https://schema.org/OutOfStock"` (honest — matches UI «نفد المخزون»), `itemCondition:NewCondition`, `url` top-level, `sku:"subnation-netflix-premium"`, absolute image |
| `/category/vpn` | `BreadcrumbList`, `FAQPage`, `ItemList` | — |
| `/support` | `FAQPage` (code-pinned by `support-faq-copy.test.tsx:111`) | — |

**Code inventory** (`frontend/src/lib/seo-builders.ts`, 6 builders, all `@context: https://schema.org`): `buildOrganizationLd` (:21, LY address + `areaServed` Libya/Wikidata Q1016), `buildProductLd` (:81, slug-canonical URL, brand=SubNation seller, category via `categoryLabel`, availability threads real `is_available` — R111 D2-F2), `buildBreadcrumbLd` (:159), `buildFaqLd` (:182), `buildWebsiteLd` (:204, `inLanguage:"ar"`, publisher ref, SearchAction), `buildItemListLd` (:244, slug URLs). Injected by `components/seo/JsonLd.tsx` (CSP-safe inline `application/ld+json` treated as data, `<`/`>`/`&`/`'` escaped, removed on unmount) via `hooks/useSeo.tsx`. Pinned by tests: `seo-builders.test.ts`, `product-seo-availability.test.tsx:108-150`, `seo-money-pages-r120.test.tsx:98`, `support-faq-copy.test.tsx:111`.

**Per-route mapping vs the brief's plan sketch:** home = WebSite+Organization ✅ (shipped); product = Product+Offer+`priceCurrency:LYD` ✅ (shipped); category = BreadcrumbList ✅ + **ItemList instead of CollectionPage** — deliberate and correct: Google has no rich result for `CollectionPage`; `ItemList` is the useful collection signal, and `BreadcrumbList` covers trail. **No action.**

**Gaps reviewed and waved (not defects):** `aggregateRating`/`review` absent — no review system exists; fabricating would be a rich-results violation (correct omission). `hasMerchantReturnPolicy`/`shippingDetails` are merchant-listing (Shopping-tab) fields, optional for product snippets; return policy lives on /terms. `sameAs: []` empty — honest (no social profiles to cite). Raw HTML carries 0 ld+json scripts (client-injected only) — the known, documented SPA tradeoff (R124-A10 §3 "justified by SPA architecture"); Google renders JS, so rich-result eligibility exists, and the one non-rendering consumer class (WhatsApp unfurlers) gets og: meta instead, which the shell serves.

---

## 2. Sitemap truth (live `https://subnation.ly/sitemap.xml`, 21,542 B)

### 2.1 URL health
56 `<loc>` = 11 static (`/`, 7 categories, `/support`, `/terms`, `/flash-sales`) + 45 products. **HEAD sweep: 56/56 → 200** (8-way parallel, `/tmp/b12-seo/head-sweep.txt`). All apex-absolute, all slug URLs.

### 2.2 lastmod honesty
- **Code:** per-entity (seo.ts:233-243, `p.updatedAt` per product; the 9 catalog-rendering statics share `MAX(updated_at)`; /support + /terms omit the tag entirely — R122 A7-P2 policy).
- **Live data:** 54 values, 45 distinct; **all inside `2026-09-20T20:14:59.099Z → 20:15:19.151Z`** — the one-time catalog-import window (products ~450 ms apart), i.e. **real per-product timestamps that all share one import event because no product has been content-edited since**.
- **Verdict:** honest-not-fabricated (the values are the DB's actual `updated_at`; the code would diverge the moment any product is edited). The cluster is the known carryover (R124-A7 Finding 7, re-observed R125-A11 item 5). Do NOT "fix" by faking recent dates — noisy lastmod is what the R122 policy explicitly avoided; divergence arrives free with the first real catalog edit.

### 2.3 hreflang
56 × `hreflang="ar"` (self) + 56 × `hreflang="x-default"` (self) per URL (seo.ts:197-198). Single-locale site: **correct, and NOT half-broken** — no `en` alternate pointing at Arabic content (the comment at :192-196 documents the deliberate refusal). Page-HTML hreflang absent (sitemap-only mechanism) — known consistency note (R126-A11), no action.

### 2.4 Unstocked-product sitemap policy — DECISION: keep all 45 listed (correct as-is)
Live catalog: **45 active products, exactly 1 `is_available` (`lifetime-cloud-storage`)** — the known operator stocking backlog (R127-B8 snapshot: 3 products / 4 unsold codes). Sitemap includes all 45 active+non-archived (seo.ts:221 `isActive=true, isArchived=false`). This is the right call, on four grounds:
1. **Google's own outage policy:** out-of-stock is temporary — keep pages indexable while the product is expected to return; noindex/410 only when it's gone for good. These are restockable digital-delivery catalog rows (stock = deliverable codes), not retired SKUs.
2. **The site marks availability honestly everywhere:** live Product LD asserts `OutOfStock` (verified on netflix-premium) mirroring the UI's buy-gate — Google explicitly supports annotated out-of-stock offers; that is the mature e-commerce pattern, not a rich-results violation.
3. **Sitemap = discovery hint, not an indexing directive:** dropping 44/45 would slow re-crawl exactly when restock lands (operator's pending action) and strip long-tail brand landing pages («شراء اشتراك Netflix ليبيا») that still render full content (long descriptions, FAQs, related products).
4. **The permanent/gone boundary is already correctly drawn elsewhere:** 14 archived products are excluded from the sitemap (same WHERE clause) and retired category pages (e.g. `/category/gaming`) serve `noindex,follow` (live-verified). Active-but-unstocked = keep; archived = drop. Policy coherent.
*Escalation trigger (ops note, not a defect): if specific products stay `OutOfStock` for many months with no restock plan, flip those to noindex — an inventory-policy decision tied to the operator's stocking plans, not a code change.*

---

## 3. Canonical & redirects — live matrix (2026-10-09, curl -sI)

| Probe | Today | Assessment |
|---|---|---|
| `http://subnation.ly/` | **307** → `https://subnation.ly/` | Temporary — the standing ops item ("http→https 301 + gzip exclusions", CHANGELOG R126 Deferred). Digit drifts per Traefik regen (302 in R124/R125 → 307 now). SEO impact ≈ nil: every canonical signal (sitemap, robots, og, rel=canonical, GSC-to-be) is https-apex. |
| `http://subnation.ly/product/netflix-premium` | 307 → https, path-preserving | same |
| `https://www.subnation.ly/` | **308** → apex | Permanent ✅ (308 ≡ 301 for canonicalization, method-preserving). See note N1: docs said "301 since R124 redeploy, stable ×3" — stale again. |
| `http://www.subnation.ly/` | 308 → `https://subnation.ly/` single hop | ✅ |
| `https://subnation.ly/products` (plural) | **200 direct** (text/html, no-store) | **R126-L6 `redirect:false` fix LIVE** — the A11-F2 double hop is gone. |
| `/category/vpn` vs `/category/vpn/` | both 200, **identical etag** `2cc6-…`, canonical → `…/category/vpn` | Canonical-consolidated, one form declared — consistent (no slash-normalization 301; documented stance). |
| `/product/netflix-premium/` | 200, canonical → no-slash | same ✅ |
| `/index.html` | 200, canonical → `/` | Known (A11-F6, P3): consolidates; 301 would be cleaner. |
| `/product/does-not-exist-xyz` | **HTTP 404** (HTML shell) | ✅ real 404 for dead slugs; rendered SPA then shows noindex not-found (§6). |
| `/Product/Netflix-Premium` (mixed case) | 200 noindex,follow shell, canonical stripped | ✅ no duplicate-content leak. |
| `/category/gaming` (retired) | 200 `noindex,follow` | ✅ matches seo.ts:150-151 comment. |

**Edge-canonical verdict for the brief:** production TODAY = http→https **temporary (307)**, www→apex **permanent (308)**, both path-preserving, single-hop from www; the only true edge-leftover is the scheme redirect's temporary status — the known ops item, unchanged.

---

## 4. Meta completeness live (no-JS baseline vs rendered)

### 4.1 Static shells (curl, no JS)
**Home** (`/`, 10,944 B): title `SubNation — سوق الاشتراكات الرقمية`; description = R120-B3 default (Arabic, ~135 chars, names real categories + LYD + Libya); robots `index,follow`; canonical `https://subnation.ly/` (R117 standing); og:title/description/type=website/image absolute + **declared 1280×720 = real file size**; twitter:card. Missing from static: og:url/og:locale/og:site_name/twitter:title|description|image — known #11 (runtime-upserted; WhatsApp still unfurls fine).
**Product** (`/product/netflix-premium`, 10,773 B): title = DB `seo_title` «Netflix — اشتراك أصلي بالدينار الليبي | SubNation» (49 chars); description = DB `seo_description`; canonical self; **og:image = per-product `https://subnation.ly/products/netflix.webp`** (R126-L6 fix LIVE) with the 1280×720 dims pair correctly stripped (449×449 art — omitted beats wrong); og:type=website in shell (runtime lifts to `product`).
**Uniqueness spot-check (shells):** Netflix 49 · ChatGPT Plus 54 · Spotify 57 · Windows 10 Pro 56 chars — all ≤60, all Arabic keyword-forward + brand suffix, each product-specific. The 13/45 long `seo_title`s clamp at 60 with Arabic-safe word-boundary ellipsis (MetaTags.tsx:86-98) — known #6.

### 4.2 Rendered head (headless Chromium)
Product page: full set live-verified — `og:type=product`, `og:url` self, `og:locale=ar_LY`, `og:site_name=SubNation`, twitter:title/description/image, canonical self, robots `index,follow`. Home rendered title «سوق الاشتراكات الرقمية في ليبيا | SubNation» + intent description (~145 chars). → **Runtime upserts (MetaTags) work exactly as designed on production.**

### 4.3 og:image resolution
- `https://subnation.ly/opengraph.jpg` → 200 `image/jpeg`, 39,597 B progressive, **`file`: 1280×720 = declared** ✅ (R120-B3 standing).
- `https://subnation.ly/products/netflix.webp` → 200 `image/webp` 449×449, `max-age=2592000` — per-product art path live ✅.

### 4.4 Split-shell family (NEW findings F1/F2 below)
Home and /flash-sales shells ship copy that differs from what the hydrated page renders — the exact class R122 (A7-P1-1) fixed for products and R124-A10-F3 fixed for the rendered flash-sales page. Products/categories/support/terms have shell↔rendered parity (categories test-pinned; support/terms measured equal: 87/106 chars both surfaces).

---

## 5. robots.txt (live, matches seo.ts:48-94 verbatim)
Sane and complete: `Allow` surface (`/`, `/product/`, `/category/`, `/support`, `/terms`) mirrors the indexable surface exactly; Disallow covers auth flows, cart/checkout, user-private pages, **`/admin` + `/admin/`, `/status`, `/api/`**; `Crawl-delay: 1` (soft hint, Googlebot ignores — harmless); `Sitemap: https://subnation.ly/sitemap.xml` (apex — consistent with every other canonical signal). **No accidental over-blocking:** nothing indexable is disallowed, nothing disallowed is sitemap-listed (set-diff of sitemap URLs vs Disallow families = empty). Admin noindex-vs-blocked: robots-blocked AND shell-noindexed (`SHELL_NOINDEX_RES` app.ts:1249-1264) — blocked-crawl means Google may never read the noindex, which is the standard private-surface belt-and-suspenders (no external admin links exist); correct as-is. `/api/` in robots = correct (JSON API has no SERP value; dead-slug API 404s honestly).

## 6. Runtime MetaTags coverage (code, complete map)
Page-level `useSeo`: home, product (with not-found branch), category, support, terms, flash-sales, cart (noindex), checkout (noindex), status (noindex), not-found (noindex). Every other storefront route (login, register, onboarding, /auth/*, wallet, orders, loyalty, referrals, profile, admin family) is matched by `NOINDEX_ROUTES` (App.tsx:179-194) so the fallback MetaTags (App.tsx:778-784) stamps `noindex,follow` + default title/description. **No route is missing a title/description upsert and no indexable route rides the fallback.** 404 page: `not-found.tsx:13-18` noindex — **live-verified rendered** on a dead slug (title «المنتج غير موجود — SubNation», robots `noindex,follow`, self-canonical, 0 LD). The R124-A10-F1 soft-404 fix is confirmed live on both layers (server 404 + rendered noindex). Known-open in this family: noindex pages still carry self-canonicals + NotFound canonical → synthetic `/404` (#12), admin pages ride the generic fallback title (R125-A6).

## 7. GSC readiness + exact operator runbook
**Nothing else blocks verification.** The `google-site-verification` meta ships **with empty content on every page** (build-time `seoHeadInject`, vite.config.ts:210; `Dockerfile:108` ARG → :143 build env; live-confirmed in home + product shells). The tag requires no JS, is on an indexable, robots-allowed homepage, and the R97 J-2 injection bug is long fixed — the token was simply never supplied.

**Operator steps (≈5 minutes + one redeploy):**
1. https://search.google.com/search-console → **Add property → URL prefix → `https://subnation.ly`**.
2. Verification method → **HTML tag** → copy the token (the `content="…"` value).
3. Coolify → the subnation application → **Configuration → Build args** (the §2.2 panel in `docs/deployment/COOLIFY_FINAL_SETUP.md`) → set `VITE_GSC_VERIFICATION=<token>` → Save.
4. **Redeploy** (the tag is baked at Vite build time — a plain restart is NOT enough).
5. Verify the deploy: `curl -s https://subnation.ly/ | grep google-site-verification` → non-empty `content`.
6. Back in GSC → **Verify** → **Sitemaps → submit `https://subnation.ly/sitemap.xml`**.
7. Post-verification (same session): URL-inspect one product page (e.g. `/product/netflix-premium`) → Rich Results Test → confirm Product/FAQ eligibility renders (it will — §1 evidence); check Coverage for the 56-URL set and any "Duplicate without user-selected canonical" noise (expect none — §3 matrix is clean).

---

## Findings

### B12-F1 [P3 · confidence 5/5 · effort S] Home SPA shell meta ≠ rendered home meta — split title+description for every non-rendering engine
**Live evidence:** shell (no-JS) title `SubNation — سوق الاشتراكات الرقمية` + R120-B3 default description vs rendered title `سوق الاشتراكات الرقمية في ليبيا | SubNation` + intent description (`home.tsx:412-427`: "متجر إلكتروني متخصّص لشراء اشتراكات الخدمات الرقمية في ليبيا — نتفلكس، سبوتيفاي، يوتيوب، ديزني+ وأكثر…"). Both surfaces live-measured today.
**Code cause:** `backend/src/app.ts:1391` — `if (norm === "" || norm === "/") return { status: 200 }; // homepage shell is already correct` — the parity claim is false; every other surface got parity (products DB-backed :1450-1462, categories test-pinned :1187-1223, statics :1226-1241), the homepage passes through with the generic build-time default.
**Impact:** non-rendering engines and the no-JS unfurl card see the weaker brand-first title + default description where the page renders the keyword-forward Arabic SERP title («سوق الاشتراكات الرقمية في ليبيا» is the money query). Mild but it is exactly the split-signal class R122-A7-P1-1 eliminated for products ("a split title signal for every non-rendering engine").
**Fix:** add a `/` case to `resolveSpaShellMeta` rewriting title + description + og:title + og:description to `home.tsx`'s copy, parity-pinned by a test mirroring `spa-shell-category-parity.test.ts` (source-of-truth duplication is already the established pattern). Effort S.

### B12-F2 [P3 · confidence 5/5 · effort S] `/flash-sales` shell description still the pre-R124 53-char copy — the A10-F3 fix shipped frontend-only
**Live evidence:** shell description measured **53 chars** — `خصومات حصرية لفترة محدودة على أفضل الاشتراكات الرقمية` — while the rendered page upserts the 140-char R124-A10-F3 copy.
**Code cause:** `backend/src/app.ts:1227-1230` — `SHELL_STATIC_ROUTE_META["/flash-sales"].description` was never synced when `flash-sales.tsx:226+` landed the fix (whose own comment says "R124 (A10-F3): 53 → 140 chars — /flash-sales is an indexable money page (sitemap priority 0.8, changefreq daily)").
**Impact:** the sitemap-priority-0.8 money page shows non-rendering engines the exact half-length snippet A10-F3 was filed against; a Google rendering pass then sees a different description than the one indexed at the shell level.
**Fix:** paste the 140-char description from `flash-sales.tsx` into `SHELL_STATIC_ROUTE_META` (or export one shared constant; parity-test like categories). Effort S.

### Informational notes (no P-number)
**N1 — www→apex digit flipped back to 308; runbook line stale again (docs-truth, predicted class).** Live today: `https://www.subnation.ly/` → **308**. `OPERATIONS_RUNBOOK.md` §13 (post-R125-A12-F22) and `docs/project-state/source-of-truth.md` say "301 since the R124 redeploy 2026-10-09, stable ×3" — no longer true, exactly as the "digit is Traefik-regen-dependent" parenthetical predicted. Also `http→https` now reads **307** (was 302 in R124/R125). SEO behavior is correct (permanent for www; scheme-redirect temporary is the standing ops item). Fix: one-line doc edit — drop the specific digit, say "permanent, 301/308 regen-dependent". Effort S.
**N2 — 44/45 catalog OutOfStock is an index-quality watch item, not a defect.** Policy decision §2.4 says keep; the mitigations (honest availability LD, rich per-product content/FAQs, restock backlog tracked as ops) hold. If restocking keeps slipping, the long-tail pages' engagement (and thus ranking) decays — the remedy is the operator's pending inventory action, not SEO code.

---

## Known-items pointer table (NOT re-reported; verified states as of today)

| Known item | Source | Today's state |
|---|---|---|
| GSC verification token unset (P2, ops) | R124-A10 #2; CHANGELOG R126 Deferred | **STILL OPEN** — `content=""` live on every page; §7 runbook is the close path |
| http→https 301 + gzip exclusions (ops, edge) | R124 Deferred; R124-A7 F2 | OPEN — now **307** (was 302); N1 |
| Sitemap lastmod = 2026-09-20 bulk-import window | R124-A7 F7; R125-A11 item 5 | UNCHANGED (54/54 in-window); per-entity code confirmed; §2.2 |
| Static baseline lacks og:locale/site_name/twitter:* | R124-A10 #11 | STILL OPEN — live shell minimal card |
| noindex pages carry self-canonicals; NotFound canonical → `/404` | R124-A10 #12 | STILL OPEN — `not-found.tsx:13-18` path `/404` |
| 13/45 `seo_title` > 60 chars (runtime clamps; admin hints show 200/320) | R124-A10 #6 | STILL OPEN — clamp verified live (sampled titles 49-57) |
| `/index.html` 200 instead of 301 | R126-A11 F6 | STILL OPEN |
| Admin pages ride generic fallback title (R125-A6) | R125-A6 | OPEN (robots-disallowed surface — cosmetic) |
| R117 static canonical / VITE_APP_ORIGIN apex | R117 | STANDING ✓ (live shell canonical `https://subnation.ly/`) |
| R120-B3 og fixes (dims 1280×720, default desc, brand-true categories) | R120-B3 | STANDING ✓ (file-verified) |
| R122 A7-P2 lastmod policy (support/terms omit tag) | R122 | STANDING ✓ (live: 54 tags, 2 statics omitted) |
| R122 search wiring (`/?search=` + WebSite SearchAction) | R122 | STANDING ✓ (live rendered WebSite LD) |
| R124-A10-F1 product soft-404 (index,follow + homepage canonical) | R124-A10 #1 | **CLOSED & LIVE-VERIFIED** — server 404 + rendered noindex + self-canonical |
| R124-A10-F3 flash-sales short description | R124-A10 #3 | Rendered FIXED; **shell half still open → B12-F2** |
| R124-A10-F4 `/terms#privacy` fragment in canonical/og:url | R124-A10 #4 | **CLOSED at HEAD** — `terms.tsx:224` now `path: "/terms"` (live shell canonical clean) |
| R126-A11-F2 `/products` 301 double hop | R126-A11 F2 | **CLOSED & LIVE-VERIFIED** — 200 direct (`redirect:false`, app.ts:1512) |
| R126-L6 product shells serve real og:image | R126 changelog | **CLOSED & LIVE-VERIFIED** — netflix.webp in shell, dims stripped |
| JSON-LD complete & client-injected | R124-A10 §3 | **STANDING ✓** — re-proven live rendered (§1) |

## Next actions (ordered)
1. **Ops:** execute the GSC runbook (§7) — still the single highest-leverage SEO action; it unlocks sitemap submission + rich-result visibility for everything below.
2. **Code S:** B12-F1 + B12-F2 in one commit (both are `resolveSpaShellMeta`/`SHELL_STATIC_ROUTE_META` copy syncs + one parity test each) — closes the last shell↔rendered drift on indexable routes.
3. **Docs S:** N1 one-liner (drop the redirect-digit specificity in runbook §13 + source-of-truth).
4. **Ops:** restock the catalog (the 44-OutOfStock backlog) — §2.4 policy holds only while restock is expected; first real catalog edit also naturally diverges sitemap lastmod.
5. Optional edge polish when the Coolify/Traefik file-provider is next touched: make http→https permanent and redirect `/index.html`→`/`.
