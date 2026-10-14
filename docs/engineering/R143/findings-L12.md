# R143 Lane L12 — SEO & crawlability audit (findings)

**Task ID:** R143-L12 · **Scope:** R142 fix verification (K-1/K-2/K-3/B-1/J-3), live shell probing of every route family, meta/OG/JSON-LD truthfulness (J-3 class), canonical/www/trailing-slash consistency, sitemap + robots, hreflang/lang signals, SPA-crawlability design check, noindex-wall completeness. Read-only — zero source edits, zero production writes.
**Verified at:** HEAD `528ef39`, tree clean (`git log --oneline -1` = `528ef39 test(admin,r142): harden the TOTP end-to-end…`). Live probes against https://subnation.ly on 2026-10-14 (GET-only: 56 sitemap URLs, 45 product shells swept, 20+ route families, WhatsApp-UA share cards ×2, headless render ×3 pages via agent-browser). Test evidence at HEAD: backend `spa-shell-rewrite` + `routes/seo` + `share-card-bot-split` = **90/90 green**; frontend `seo-head-inject` + `shell-head-anchors` + `seo-builders` + `jsonld-completeness-r140` + `meta-quality-r140` + `product-seo-availability` + `seo-money-pages-r120` = **112/112 green**.

**Live deployment includes the R142 wave:** the K-2 og:url/og:type rewrites and the K-1 word-boundary clamps are observable in production HTML (below), so live truth = HEAD truth for this lane.

---

## R142 fix verification

| Fix | Verdict | Evidence (code · test · live) |
|---|---|---|
| **K-1** title clamp word-boundary | **VERIFIED** | `backend/src/lib/spa-shell.ts:192-203` — `clampSeoTitleForShell` is now the verbatim MetaTags algorithm (`sliced = slice(0,59).trimEnd()`, last-space cut, ellipsis; identical to `frontend/src/components/seo/MetaTags.tsx:93-105`). Test `spa-shell-rewrite.test.ts:346-379` seeds BOTH live money-page titles and asserts `… |…` with a `not.toMatch(/SubN/)` shard ban. **Live 2026-10-14:** `/product/lifetime-cloud-storage` title = `Lifetime Cloud Storage — اشتراك أصلي بالدينار الليبي |…` (len 55, no `SubN` shard); `/product/hallmark-movies-now` = `Hallmark Movies Now — اشتراك أصلي بالدينار الليبي |…` (len 52). Raw = hydrated (parity restored). |
| **K-2** og:url/og:type rewrite arms | **VERIFIED** | `spa-shell.ts:431-437` (`ogUrl?`/`ogType?` on `SpaShellMeta`), `:597-602` (both rewrite arms, no-tag-no-change contract), set at category `:646`, product `:712-713` (`ogType:"product"`), statics `:725`. Tests `spa-shell-rewrite.test.ts:490-532` (product self-URL+product type, numeric→slug og:url, category URL+website, flash-sales, home/noindex keep static identity). **Live:** product shells `og:url=https://subnation.ly/product/<slug>` + `og:type=product`; `/category/vpn` `og:url=…/category/vpn` + `website`; `/flash-sales`,`/support`,`/terms` self `og:url`; home/noindex keep the apex baseline (by design). |
| **K-3** noindex it.each ×7 | **VERIFIED** | `spa-shell-rewrite.test.ts:560-596` — the `it.each` now carries 18 rows covering all 15 SHELL_NOINDEX_RES families, including the 7 previously-unpinned: `/forgot-password`, `/onboarding`, `/auth/telegram-callback`, `/loyalty`, `/referrals`, `/status`, `/notifications` (+ `?page=2` variant), with the R142 (K-3) comment explaining the regression it closes. Deleting any wall line now fails CI. Suite re-ran green at HEAD. |
| **B-1** GSC anchor comment-aware | **VERIFIED** | `frontend/src/lib/seo.ts:104-120` (`execOutsideComments` — the regex twin of `indexOfOutsideComments`, same fail-safe on unclosed comment) used as the PRIMARY viewport anchor at `:167`; fallback `:180` unchanged. Regression test `shell-head-anchors.test.ts:223-248` — decoy viewport meta inside a comment is skipped, injection lands after the REAL multiline `data-rh` viewport tag. **Live:** the production home shell carries `<meta name="google-site-verification" content="" />` at byte 953, outside every comment, immediately after the real viewport meta (comment-stripped index gsc=374 > viewport=227). |
| **J-3** OOS fallback meta honesty | **VERIFIED** | `frontend/src/components/product/product-seo.ts:61-63` — the last-resort description fallback is now availability-gated (in-stock arm keeps «متوفر…تسليم فوري»؛ OOS arm says «راجع صفحة المنتج لمعرفة التوفر الحالي»). Pinned both arms by `product-seo-availability.test.tsx:160-184` (`not.toContain("متوفر")` / `not.toContain("تسليم فوري")` on OOS while Offer LD says OutOfStock). **Live:** 45-shell sweep found ZERO availability/instant-delivery claims in any product meta description; live-rendered OOS `/product/cpanel` (API `is_available:false`) emits Product LD `availability=OutOfStock`, `price=99.80`, `priceCurrency=LYD` and the page renders «نفد المخزون» — meta, LD, and UI agree. |

All five R142 dispositions in this lane's scope: **landed, tested, and deployed live.**

---

## Live shell probe matrix (raw HTML, comment-stripped extraction; 2026-10-14)

| Route family | HTTP | title | canonical | robots | og:url / og:type | Verdict |
|---|---|---|---|---|---|---|
| `/` (home) | 200 | `سوق الاشتراكات الرقمية في ليبيا \| SubNation` | `https://subnation.ly/` | index,follow | apex / · website | **PASS** — rewritten home meta (B12-F1), 1 title tag, `lang=ar`, `content-language: ar` |
| `/product/spotify-premium` | 200 | curated seo_title | self slug URL | index,follow | self · **product** | **PASS** — K-2 live; og:image = real `/products/*.webp`, baseline 1200×630 dims stripped |
| `/product/lifetime-cloud-storage`, `/product/hallmark-movies-now` | 200 | word-boundary clamped `…\|…` | self | index,follow | self · product | **PASS** — K-1 live (see L12-4 for the brand-drop nuance) |
| `/product/61` (numeric id) | 200 | curated | **slug** canonical | index,follow | **slug** og:url | **PASS** — R117 F-4 numeric→slug consolidation incl. the new og:url arm |
| `/product/cpanel` (OOS row) | 200 | curated | self | index,follow | self · product | **PASS** — no availability claim in meta; LD OutOfStock (rendered) |
| `/product/never-existed-l12-probe` | **404** | baseline | **none (stripped)** | noindex,follow | static apex (unindexable) | **PASS** — A7-F7 real 404 + honest shell |
| `/category/vpn` | 200 | curated category meta | self | index,follow | self · website | **PASS** — K-2 category arm |
| `/category/gaming` (retired slug) | 200 | baseline | none | noindex,follow | static | **PASS** — A7-P1-2 unknown-category wall |
| `/flash-sales`, `/support`, `/terms` | 200 | curated statics | self | index,follow | self · website | **PASS on shape** — flash-sales meta CONTENT contradicts the live page (L12-1) |
| `/admin`, `/login`, `/register`, `/forgot-password`, `/onboarding`, `/auth/telegram-callback`, `/cart`, `/checkout`, `/wallet`, `/orders`, `/orders/W-1234`, `/loyalty`, `/referrals`, `/profile`, `/notifications`, `/status` | 200 | baseline | **none (stripped)** | **noindex,follow** ×15/15 | static apex | **PASS** — the whole noindex wall holds live, 3-layer consistent (robots.txt Disallow = SPA NOINDEX_ROUTES = SHELL_NOINDEX_RES) |
| `/this-route-does-not-exist-l12-probe` | 200 | baseline | none | noindex,follow | static | **PASS** — SPA-404 UX + honest raw shell |
| `/products` (retired alias) | 200 | baseline | none | noindex,follow | static | **PASS** — walled server-side; client redirect owns UX |
| `/?search=netflix` | 200 | home meta | **apex `/`** | index,follow | apex | **PASS** — search query space consolidated into home by canonical |
| `/category/vpn/`, `/product/<slug>/` (trailing slash) | 200 | same as canonical form | **non-slash** self | index,follow | non-slash self | **PASS w/ P4 note** — 200 duplicate consolidated by canonical, not 301 (L12-6) |
| `www.subnation.ly` | **301** → `https://subnation.ly/` | — | — | — | — | **PASS** — www→apex 301 (canonical host everywhere) |
| `http://subnation.ly` | **301** → https | — | — | — | — | **PASS** |
| `/robots.txt` | 200 | — | — | — | — | **PASS** — byte-identical to `ROBOTS_BODY` (routes/seo.ts:70-119): 6 Allow, 17 Disallow, Crawl-delay 1, sitemap pointer; nothing SEO-relevant blocked (assets/fonts/art under /assets/, /products/, / all allowed; /api/ correctly disallowed) |
| `/sitemap.xml` | 200 | — | — | — | — | **PASS** — 56 URLs (11 statics + 45 active products); **all 56 return 200 + index,follow + self-canonical** (swept); zero stale/hidden-product entries (matches the 45 active rows in `/api/products?fields=list`) |
| WhatsApp-UA `/product/spotify-premium`, `/product/cpanel` | 200 | — | — | — (card has no robots meta — unfurler-only surface) | self · product; real art URL; price-suffixed description, **no availability claim** | **PASS** — bot split intact (card for unfurlers, shell for indexers) |
| Rendered `/` (agent-browser) | — | hydrated title = raw shell title | self | — | self | **PASS** — Organization + WebSite (SearchAction → `/?search=`, `inLanguage:"ar"`) + ItemList(45 items) JSON-LD, all parse |
| Rendered `/product/cpanel` | — | = raw shell | self | index,follow | self · product | **PASS** — Product(OutOfStock/99.80 LYD) + BreadcrumbList + FAQPage; three-layer parity holds |
| Rendered `/flash-sales` | — | = raw shell | self | index,follow | self | **FAIL (content truth)** — page body «لا عرض نشط حالياً» vs meta «خصومات حقيقية…» (L12-1) |

**Canonical consistency:** every indexable family canonicalizes to the absolute apex non-slash slug URL; www 301s to apex; http 301s to https; noindex/unknown/404 families strip the canonical. **Lang signals:** `html lang="ar" dir="rtl"`, `content-language: ar` on every HTML response probed, `og:locale=ar_LY` + `og:site_name=SubNation` in every shell (documented deliberate ar_LY — index.html:92-108), sitemap hreflang `ar` + `x-default` on all 56 entries (no phantom `en`). **OG/Twitter:** `og:image` resolves on all 45 product shells (sweep verified each URL 200) + `/opengraph.jpg` 200 (1200×630 declared = real) + `/subnation-logo.png` 200 (Organization LD logo); `twitter:card=summary_large_image` static everywhere, runtime adds `twitter:image`. **JSON-LD:** raw shells carry zero `ld+json` **by design** (D2-F1: indexers get the shell so Google's WRS renders the SPA; unfurlers get the card) — documented at `docs/history/inspection-r111/CONSOLIDATED-FINDINGS.md:120`.

---

## Findings

### L12-1 · P3 · flash-sales meta description advertises a live discount sale that does not exist — J-3/F1 class, static copy never sees the flash-sale state

- **Evidence:**
  - Live `GET /api/products/flash-sale` → `{"flash_sale":null}` (2026-10-14). Live catalog: 0/45 products carry `discount_percent`, 0 carry `sale_price`.
  - Live `GET /flash-sales` raw shell AND hydrated head (agent-browser render) both carry meta/og description: «عروض فلاش بخصومات حقيقية لفترة محدودة على اشتراكات نتفلكس وسبوتيفاي و ChatGPT و VPN — بالدينار الليبي مع تسليم فوري بعد الدفع في كامل ليبيا.»
  - The same rendered page's visible body: «لا عرض نشط حالياً» + «تابعنا أو راجع الكتالوج — العروض تعود قريباً!» (`frontend/src/pages/flash-sales.tsx:389-390`) and zero product links / zero discount text.
  - Source: `frontend/src/pages/flash-sales.tsx:279-287` — the `useSeo` description is a string literal; `backend/src/lib/spa-shell.ts:363-372` (`SHELL_STATIC_ROUTE_META["/flash-sales"]`) mirrors it verbatim (parity-pinned by `spa-shell-route-parity.test.ts`), so BOTH surfaces emit the claim unconditionally.
  - The URL is sitemap-advertised at `priority 0.8`, `changefreq daily`, lastmod = global catalog MAX (`routes/seo.ts:209`).
- **Root cause:** the R124 (A10-F3) copy was written for the always-on-sale world; the flash-sale singleton is nullable and the page honestly renders an empty state, but neither the shell rewriter nor the page's `useSeo` input gates the description on `activeSale` (the value the page ALREADY resolves at `flash-sales.tsx:333` for its subtitle).
- **Proposed fix (owner: lane FE, ~2 lines + test):** make the description data-aware exactly like product-seo's J-3 gate — `activeSale ? <current discount copy> : "صفحة عروض SubNation — تابع العروض الموسمية على الاشتراكات الرقمية بالدينار الليبي."` (honest hub copy). The shell side cannot be data-aware (static route family, no DB lookup) — either accept a one-shell-behind window like the share card's documented 60 s trade-off by resolving `/flash-sales` meta from the flash-sale singleton in `resolveSpaShellMeta`, or keep the shell copy permanently neutral (recommended: neutral hub copy in both layers, sale specifics live in the rendered page + share card only).
- **Test requirement:** extend `flash-sales.test.tsx` (or `seo-money-pages-r120.test.tsx`): render with `flash_sale:null` → description contains no «خصومات» promise and no brand enumeration; with an active sale → discount copy allowed. Pin the shell copy in `spa-shell-route-parity.test.ts` if it changes.
- **Risk:** low — copy-only. But it is the exact truthfulness class R142 closed (J-3 P3, F1 P3, I-4 P3) sitting on a sitemap-advertised money page: the SERP/WhatsApp snippet promises «real discounts, limited time» on 4 brand families while the page body says «no active offer».

### L12-2 · P4 · K-6 residual still open (documented debt): shell/client product fallback title formulas diverge — dormant while 45/45 rows carry curated seo_title

- **Evidence:** `spa-shell.ts:700` fallback `` `${row.name} — SubNation` `` and `:705` price-suffixed `buildShareDescription` fallback vs `product-seo.ts:51` `` `${product.name} — ${formatCurrency(seoPrice)}` `` and `:64` plain `.slice(0,160)` description fallback. Live sweep 2026-10-14: all 45 shell titles are the curated Arabic `X — اشتراك أصلي بالدينار الليبي | SubNation` form — zero fallback titles, zero price-suffixed descriptions rendered (45/45 rows carry both curated fields). R142 ledger records K-6 as documented debt (P4).
- **Root cause:** the two fallback formulas were never aligned; the parity guarantee is per-row-conditional.
- **Proposed fix:** when next touched, align the shell fallback to the client formula (drop the price suffix / adopt the same title tail) or pin the divergence with a comment naming the condition. No action this round.
- **Test requirement:** if changed, pin both fallback arms in `spa-shell-rewrite.test.ts` + `product-seo` tests.
- **Risk:** one admin edit (`seo_title=''` on a row) re-opens the split-title/split-description signal on that page only.

### L12-3 · P4 · K-4 residual still open (documented debt): no hostile-input test on the shell/card escaping path (`escapeHtmlAttr`)

- **Evidence:** `rg -i 'script>alert|hostile|injection|"><script' backend/src/__tests__/spa-shell-rewrite.test.ts backend/src/__tests__/share-card-bot-split.test.ts` → zero hits. `escapeHtmlAttr` (`spa-shell.ts:145-151`, `frontend/src/lib/seo.ts:131-133`) is correct in code (both quote styles + `&<>`), and every interpolation site double-quotes, but no backend test seeds a `"><script>` shaped `seo_title`/`name`/`slug`. R142 ledger records K-4 as debt.
- **Proposed fix (2 tests):** one hostile row in `spa-shell-rewrite.test.ts` asserting the rewritten `<title>`/`content="…"` stays inert; one in `share-card-bot-split.test.ts`.
- **Test requirement:** the two tests above.
- **Risk:** a regression in the one trust-boundary function of this layer would ship attribute injection to crawlers/unfurlers with zero red builds.

### L12-4 · P4 · The word-boundary clamp drops the brand tail on the 2 over-60 titles — raw=hydrated agree, but the SERP title loses «SubNation»

- **Evidence:** live `/product/lifetime-cloud-storage` title = `Lifetime Cloud Storage — اشتراك أصلي بالدينار الليبي |…` (len 55) and `/product/hallmark-movies-now` = `Hallmark Movies Now — اشتراك أصلي بالدينار الليبي |…` (len 52) — the last word boundary sits after `|`, so the brand is cut. K-1's goal (raw = hydrated, no mid-word shard) is fully achieved — MetaTags.clamp produces the identical string — this is the visible cost of the shared algorithm on a long pre-brand prefix.
- **Root cause:** operator content: the curated `seo_title`s spend 55+ chars before the brand. 2 of 45 live rows; K-1 noted 13 of 45 titles in `docs/SEO_PRODUCTS.json` are >60 — one import away from more.
- **Proposed fix:** operator content edit (shorten the two `seo_title`s to ≤60 incl. brand), not code. Optionally note the budget in the admin SEO field help text (lane C/D territory).
- **Test requirement:** none (clamp contract already pinned).
- **Risk:** cosmetic SERP-branding loss only; Google re-appends its own brand heuristics.

### L12-5 · P4 · GSC verification token is empty in production — Search Console HTML-tag verification is not activated

- **Evidence:** live home shell: `<meta name="google-site-verification" content="" />` (byte 953). `frontend/index.html:19-23` documents this as the unset-token placeholder (harmless, ignored by Search Console). The injector (B-1-hardened) is working; the token `VITE_GSC_VERIFICATION` is simply unset in the production build.
- **Root cause:** operator input pending (Coolify build secret) — per `.hermes.md` this is an explicit, user-ordered action, NOT a code fix.
- **Proposed fix:** none by any lane — report to the operator: set `VITE_GSC_VERIFICATION` to the Search Console HTML-tag token and redeploy when GSC ownership verification is wanted.
- **Test requirement:** none.
- **Risk:** Search Console ownership/inbox data (coverage, Core Web Vitals, manual actions) stays invisible to the team until activated.

### L12-6 · P4 · Trailing-slash duplicates serve 200 (canonical-consolidated, not redirected)

- **Evidence:** live `GET /category/vpn/` and `/product/spotify-premium/` → HTTP 200 with the canonical + og:url pointing at the non-slash form (`resolveSpaShellMeta` normalizes: `spa-shell.ts:615`). Internal SPA links are slash-free; the sitemap is slash-free; www/http 301 correctly. So both variants are crawlable but every consolidation signal (canonical, og:url, sitemap, internal links) names one form.
- **Root cause:** the edge (Cloudflare/app) serves the shell for both rather than 301-ing; the R116 f10bb9b fix deliberately removed in-app redirect logic.
- **Proposed fix:** optional edge rule (Cloudflare redirect rule, operator-side) 301-ing trailing-slash non-home paths to the canonical form. Not worth backend code.
- **Test requirement:** none (canonical behavior already pinned).
- **Risk:** minimal — Google honors the canonical; at worst crawl-budget duplication.

---

## Checked and clean (adjudicated, no finding)

- **Sitemap honesty (r140-m pins still hold live):** 7 distinct per-category lastmod values (a VPN edit does not freshen `/category/music` — live values differ per category); `/support` + `/terms` omit lastmod; home + `/flash-sales` = global MAX (`2026-09-20T20:15:19.151Z`, the true max row timestamp); 45 distinct product timestamps; hreflang `ar`+`x-default` only. All 56 entries 200 + indexable + self-canonical (full sweep). Zero stale entries — the 45 product URLs exactly equal the 45 active, non-archived API rows.
- **robots.txt correctness:** live body byte-matches `ROBOTS_BODY`; `Disallow: /api/` blocks the JSON surface only; every asset family a crawler needs (`/assets/`, `/products/*.webp`, fonts, `/opengraph.jpg`, `/manifest.json`, `/init.js`) is under the blanket `Allow: /` (live-verified 200s). Naming `/admin`/`/status` in robots.txt is standard SEO practice, not a leak — the surfaces are TOTP/auth-gated; hiding them from robots.txt would not hide them from attackers and would break the SEO wall.
- **Noindex wall completeness (the "should be noindexed but aren't" sweep):** all 15 route families walled in all three layers and live-probed 15/15 `noindex,follow` + canonical stripped. Account pages (wallet/orders/profile/loyalty/referrals/notifications), cart, checkout, auth flows, admin, status — all covered. Search has no dedicated route — `/?search=` consolidates into the home canonical live; the SPA's WebSite SearchAction target matches the page's real behavior. `/products` alias is walled + client-redirected. **No missing walls found.**
- **Bot split (D2-F1):** WhatsApp UA gets the card (`og:type=product`, self og:url, real art, price-only description — no availability claim even for the live OOS card); indexer UAs get the shell. `Google-InspectionTool` falls to the shell (correct). No availability assertion exists on the card, so the 60 s/`s-maxage=300` staleness trade-off cannot fabricate.
- **SPA-crawlability design:** no SSR/prerender for money pages — deliberate, documented (`docs/history/inspection-r111/CONSOLIDATED-FINDINGS.md:120` D2-F1): indexers get the SPA shell so Google's Web Rendering Service renders the full page + client JSON-LD; unfurlers get the card. Residual (accepted, documented): non-rendering engines see title/description/canonical/OG but zero JSON-LD and a no-JS body — the shell meta layer (title/description/canonical/og/robots) is exactly the mitigation for that class, and K-2 just closed its last identity gap.
- **og:locale `ar_LY` (not Facebook's `ar_AR`):** deliberate, documented at `index.html:92-108` (R-140-h verdict — Libya-only storefront). Facebook's parser falls back gracefully on unrecognized locales; WhatsApp ignores the field. No action.
- **JSON-LD no-fabrication:** `buildProductLd` carries no rating/review surface anywhere (`seo-builders.ts:80-96` documents the AggregateRating judgment; pinned by jsonld-completeness tests). Live-rendered Product LD on the OOS row: OutOfStock + real LYD price + slug URL — truthful. ItemList thin-LD guard suppressed the block on the empty flash-sales page (honest). Home/category descriptions name only brands with live active rows (the I-4 boundary); the J-3-class copy risk that remains is L12-1 (flash-sales).
- **Meta duplication:** exactly 1 `<title>`, 1 description, 1 canonical, 1 robots per shell (comment-stripped census on every probed family); the react-helmet twin class stays closed.

## Verdict

The R142 SEO layer is fully landed and live-verified — every fix in this lane's scope (K-1, K-2, K-3, B-1, J-3) holds in code, in tests re-run green at HEAD (202 backend/frontend SEO tests), and in production HTML. The crawlability posture is sound end-to-end: 56/56 sitemap URLs 200+indexable+self-canonical, three-layer noindex wall 15/15 live, canonical/host/scheme consolidation clean, lang/hreflang signals complete, JSON-LD truthful where it renders. The one new material residual is the flash-sales meta description contradicting its own empty-state page (L12-1, P3 — the exact J-3 truthfulness class, one money page, ~2-line fix in the owning FE lane); everything else is documented debt (K-4/K-6) or operator input (GSC token).

**Lean:** 0 deletions; L12-1 is ~2 lines of copy logic + 1 test when its lane picks it up.

**Not checked:** Google Rich-Results live validator (needs GSC auth — and the token is unset, L12-5); Bing Webmaster verification; post-hydration heads beyond the 3 rendered pages; admin-side SEO field editors (other lanes).
