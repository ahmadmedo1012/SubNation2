# R142 Lane K — SEO & delivery metadata audit (findings)

**Task ID:** 142-K1 · **Scope:** serve-time shell rewriter (spa-shell.ts), frontend SEO components/libs/builders, sitemap + robots, three-layer meta parity, JSON-LD truth. Read-only — zero source edits.
**Verified at:** HEAD `a9f5e83`, tree clean. 190 tests re-run green (95 backend across 6 suites, 95 frontend across 7 suites incl. meta-quality-r140). Live probes against https://subnation.ly on 2026-10-13 (10 route families × raw shell meta, all 45 product shells swept, WhatsApp-UA share card, robots.txt, sitemap.xml).

**What this layer does:** the backend rewrites per-route SEO meta into the static SPA shell at serve time (title/description/og twins/canonical/robots/og:image), serves a DB-backed OG card to link unfurlers, and splits unfurlers from indexing crawlers; the frontend owns the hydrated head (MetaTags upserts) and all JSON-LD; routes/seo.ts owns robots.txt + sitemap.xml. The r140 SEO layer (JSON-LD no-fabrication, noindex belts, honest lastmod, /notifications wall) **still holds** — every r140 pin re-ran green and every live probe agreed. The findings below are new, mostly parity + test-gap class.

---

## Findings

### K-1 (P3) — Shell title clamp is a raw character cut, not the claimed VERBATIM word-boundary mirror: live mid-word shards on 2 money pages, raw ≠ hydrated title

**Where:** `backend/src/lib/spa-shell.ts:186-194` (`clampSeoTitleForShell`) vs `frontend/src/components/seo/MetaTags.tsx:93-105` (`clamp`).

**What this is:** the shell clamps operator `seo_title` values over 60 chars for the no-JS shell with `title.slice(0, 59).trim() + "…"`. The docblock claims it mirrors `MetaTags.clamp(text, 60)` **VERBATIM**. It does not: MetaTags.clamp cuts at the last word boundary (the R122-A7 fix, introduced precisely because «Arabic shards like …الليب… leaked into titles … read as broken»), the shell does a raw character cut. The two surfaces emit **different titles for the same product** whenever a title exceeds 60 chars and contains a space — reopening the split-title signal R122 (A7-P1-1) closed, and shipping the exact mid-word shard class R122 (A7) fixed client-side.

**Concrete case (live, 2026-10-13):**
- `https://subnation.ly/product/lifetime-cloud-storage` raw shell `<title>` = `Lifetime Cloud Storage — اشتراك أصلي بالدينار الليبي | SubN…` — a mid-word Latin shard (`SubN…`).
- `https://subnation.ly/product/hallmark-movies-now` raw shell `<title>` = `… | SubNati…` — same class.
- The hydrated pages (MetaTags.clamp) render `… الليبي |…` (word boundary). Raw ≠ hydrated on both live pages.
- Live blast radius today: **2 of 45** product shells (full 45-page sweep). Latent: 13 of 45 titles in `docs/SEO_PRODUCTS.json` are >60 chars — one import away.

**Why the tests miss it:** `spa-shell-rewrite.test.ts:314-337` clamps `"T".repeat(70)` — an unbroken word, the *one* input shape where the raw cut and the word-boundary cut agree. The client's word-boundary behavior *is* pinned (`meta-quality-r140.test.ts:324`), so the two pinned contracts contradict each other.

**Minimal fix:** copy MetaTags.clamp's four lines into `clampSeoTitleForShell` (last-space cut + ellipsis), keep the comment now true; add one shell test with a **spaced** >60 title asserting the word-boundary output. ~5 lines + 1 test.

**If we skip it:** every long operator title shows a broken word to non-rendering engines and disagrees with the rendered SERP title.

---

### K-2 (P3) — The shell rewrite layer has no og:url / og:type arms: every non-home raw shell advertises itself as the homepage OG object

**Where:** `backend/src/lib/spa-shell.ts:402-419` (`SpaShellMeta` interface) + `:547-579` (`rewriteSpaShellMeta` — rewrites title/og:title, description/og:description, robots, og:image ± dims, canonical only). Static source: `frontend/index.html:91,111` (`og:type=website`, `og:url=https://subnation.ly/`).

**What this is:** the R120-B3 layer fixed per-route `canonical` but never added the two OG identity arms. The static baseline's homepage-shaped `og:url`/`og:type` survive every rewrite, so the raw document **contradicts itself**: canonical says «this is /product/x», og:url says «this object is the homepage», og:type says `website` on a product page. The runtime MetaTags upserts both per route, and the share card (unfurlers) carries the correct values — but the serve-time shell exists precisely for consumers that never run JS (Bing's raw-HTML pass, scrapers, any non-rendering parser), and for them every non-home page claims homepage identity. This is the same B12-F1 split-signal family the repo closed for title/description.

**Concrete case (live):** `https://subnation.ly/product/spotify-premium` raw shell — `canonical = https://subnation.ly/product/spotify-premium` but `og:url = https://subnation.ly/`, `og:type = website`. Identical on `/category/vpn` and `/flash-sales` (canonical = route URL, og:url = homepage).

**Minimal fix:** add `ogUrl?: string` to `SpaShellMeta`; in `rewriteSpaShellMeta` call the existing `rewriteMetaTag("property", "og:url", url)` wherever canonical is set; set `og:type=product` in the product branch (same one-line arm). ~6 lines + a test pinning og:url on a product + category shell.

**If we skip it:** non-rendering OG consumers consolidate every product/category page into the homepage object; OG identity stays one hydration behind canonical.

---

### K-3 (P3) — SHELL_NOINDEX_RES is the only unpinned of the three noindex walls: 7 of 15 families (incl. r140's own /notifications flag) have no shell-layer test

**Where:** `backend/src/lib/spa-shell.ts:379-399` (the wall) · gap in `backend/src/__tests__/spa-shell-rewrite.test.ts:465-489`.

**What this is:** the noindex belt has three walls — robots.txt `Disallow`, the SPA's `robotsForPath` (route-shapes.ts `NOINDEX_ROUTES`), and the shell's `SHELL_NOINDEX_RES`. Two of the three are hard-pinned to each other: `routes/__tests__/seo.test.ts` freezes the robots line set AND cross-checks it against the SPA's NOINDEX_ROUTES over the parsed routes.tsx registry (the pin that "would have caught the R128-IMP-5 /notifications gap"); `meta-quality-r140.test.ts:439-461` pins the SPA side for every walled family. **Nothing pins the shell copy.** The shell suite's `it.each` covers only 10 paths (login, register, cart, checkout, wallet, orders, orders/123, profile, admin, admin/users). Unpinned: `/forgot-password`, `/onboarding`, `/auth/*`, `/loyalty`, `/referrals`, `/status`, `/notifications`.

**Concrete case:** delete the `/^\/notifications(\/|$)/` line from `SHELL_NOINDEX_RES` today — **no test fails**. The raw shell stamps `index,follow` on the notifications wall while robots.txt Disallows it and the SPA stamps `noindex,follow`: the exact r140-m raw/SPA contradiction class, re-openable by a one-line edit. (The wall itself currently HOLDS — live-probed `/notifications`, `/admin`, `/wallet`, `/status`, `/login` all serve `noindex,follow` + canonical stripped. This is a missing-test finding, not a live bug.)

**Minimal fix:** add the 7 missing paths to the `it.each` (7 lines), or — stronger — a parity test that reads `SHELL_NOINDEX_RES` and cross-checks it against route-shapes.ts `NOINDEX_ROUTES` (the seo.test.ts text-extraction idiom, making the whole triangle self-checking).

**If we skip it:** the next route-family addition gets walled in robots + SPA but silently stays `index,follow` in raw HTML until someone remembers this file.

---

### K-4 (P4) — No injection test on the shell/card escaping path (spa-shell's escapeHtmlAttr is test-unpinned)

**Where:** `backend/src/lib/spa-shell.ts:145-151` (`escapeHtmlAttr`) + every interpolation site (`rewriteMetaTag`, `rewriteCanonical`, the share-card template `:915-931`).

**What this is:** the escaping is **correct in code** — `& < > "` are escaped, and every rewritten attribute is double-quoted (the replacement re-emits `content="…"`, so the un-escaped `'` can never sit in a break-out position). Both frontend twins ARE injection-tested (`seo-head-inject.test.ts:167-176` for the GSC token; `jsonld-completeness-r140.test.ts:402-435` pins `</script>` defusing in JsonLd). But no backend test ever seeds a product row whose `name`/`seo_title`/`seo_description`/`slug`/`imageUrl` carries `"><script>`, quote pairs, or `</script>` and asserts the rewritten shell + share card stay inert. A regression in `escapeHtmlAttr` (e.g. dropping the `"` branch) would ship unverified attribute injection to every crawler and unfurler with zero red builds.

**Concrete case:** insert a row with `seoTitle: '"><script>alert(1)</script>'`; nothing in the 95-test backend run exercises it.

**Minimal fix:** one hostile row in `spa-shell-rewrite.test.ts` (assert `<title>` content is escaped, `content="` does not break out) + one in `share-card-bot-split.test.ts`. Two tests.

**If we skip it:** the one trust-boundary function in this lane stays unpinned.

---

### K-5 (P4) — Stale 1280×720 prose in three places while the shipped baseline is 1200×630

**Where:** `backend/src/lib/spa-shell.ts:414-415` and `:567-570` (comments: «the 1280×720 pair belongs to opengraph.jpg»); `frontend/src/pages/__tests__/seo-money-pages-r120.test.tsx:18-19` (docblock: «dims default to the REAL /opengraph.jpg 1280×720 (the old hardcoded 1200×630 lied about every image)» — inverted).

**What this is:** the real `frontend/public/opengraph.jpg` is **1200×630** (`file`-verified; R128-L2 regenerated it at the spec-correct 1.91:1), the static pair in `index.html:54-55` is 1200/630, and the client default (`MetaTags.tsx:65-66`) is 1200/630 — pinned green by `seo-money-pages-r120.test.tsx:163-164`. Three comments still describe the old 1280×720 world (the seo-money-pages docblock even inverts the history: 1200×630 is the *current* truth, not the old lie). A maintainer "fixing" the numbers to match the comments would re-introduce the A7-F6 wrong-dimension declaration class.

**Concrete case:** `rg -n "1280" backend/src/lib/spa-shell.ts frontend/src/pages/__tests__/seo-money-pages-r120.test.tsx` — three hits, all prose, all stale (the 1280/720 values inside `spa-shell-rewrite.test.ts`'s stub shell are fine: the stub is not the real file).

**Minimal fix:** three comment edits. Zero code.

---

### K-6 (P4) — Product fallback meta formulas diverge between shell and client (dormant live: 45/45 rows carry curated overrides)

**Where:** shell `backend/src/lib/spa-shell.ts:668-673` (fallback title `` `${row.name} — SubNation` ``; fallback description = `buildShareDescription` → body + «— السعر X د.ل», ≤180) vs client `frontend/src/components/product/product-seo.ts:49-56` (fallback title `` `${product.name} — ${formatCurrency(seoPrice)}` ``; fallback description = `(description || hardcoded-available-line).slice(0,160)` — no price suffix).

**What this is:** the spa-shell docblock documents its fallbacks as «pre-R122 behavior», but the R122 A7-P1-1 claim «raw-HTML and post-render titles finally agree on the 45 money pages» holds only while **every** row keeps `seo_title` and `seo_description` populated. Clear either field on one row and that page's raw title («Name — SubNation») and hydrated title («Name — 49.00 د.ل»), or raw description (price-suffixed, 180 budget) and hydrated description (raw slice, 160), swap on paint — the B12-F1 split signal, per-row.

**Concrete case (live dormancy verified):** the 45-shell live sweep found **zero** price-suffixed descriptions and zero fallback titles — all 45 rows carry both curated fields today. One admin edit (`seo_title = ''`) re-opens it on that page.

**Minimal fix (pick one):** align the shell fallbacks to the client formulas (drop the price suffix, use the same title tail), or pin the current divergence with a comment that names the per-row condition — plus decide whether the price-suffixed shell description (a deliberate money-forward share line) stays. Not urgent; it is documented behavior with a live-clean catalog.

**If we skip it:** nothing breaks today; the parity guarantee is silently per-row-conditional.

---

## Three-layer meta parity map (static shell → serve-time rewrite → client upsert)

| Field | L1 static `index.html` | L2 serve-time `spa-shell.ts` | L3 client `MetaTags` | Verdict |
|---|---|---|---|---|
| `<title>` / `og:title` | brand-first baseline | home/category/statics **verbatim** (parity-pinned); product: `seo_title` with **raw-cut clamp** ⚠ or `name — SubNation` | product: `seo_title` with **word-boundary clamp** or `name — price` | **DIVERGES** >60-char titles (K-1, live ×2); fallback formulas differ (K-6, dormant) |
| `description` / `og:description` | catalog default | home/category/statics verbatim; product: `seo_description.slice(0,160)` | `product-seo.ts` slices 160 → clamp no-op | **parity** — both raw 160-cuts; all 7 category descriptions ≤160; all live rows populated |
| `canonical` | homepage | per-route (product slug-canonical incl. numeric→slug; stripped on noindex/unknown/404) | per-route | **parity** — live-verified on 10 route families incl. 404/unknown/noindex strips |
| `robots` | `index,follow` | `noindex,follow` ×15 families | page block or `robotsForPath` | **parity** (all three walls agree; the shell wall is the unpinned one — K-3) |
| `og:image` + dims | `/opengraph.jpg` + 1200×630 (real, `file`-verified) | product art absolutized + baseline dims **stripped** | product art + dims **evicted** | **parity** — live: spotify art URL, no dims tags |
| `og:url` | homepage | **not rewritten** (homepage) | per-route | **DIVERGES** (K-2) |
| `og:type` | `website` | **not rewritten** | `product` on PDP | **DIVERGES** (folded into K-2) |
| `og:locale` / `og:site_name` | `ar_LY` / `SubNation` | untouched | same | **parity** |
| `twitter:*` | card only | untouched (tags absent) | full set at runtime | benign — scrapers fall back to og |
| JSON-LD | none in shell | none (client-only by design — D2-F1: indexers get the shell so WRS renders; unfurlers get the card) | full per-page set | **by design** — live raw shells carry zero `ld+json` (verified) |

Duplication audit: live home shell census = exactly **1** `<title>`, 1 description, 1 canonical, 8 og metas — the react-helmet data-rh twin class is closed (data-rh attrs are documented inert markers); `MetaTags.setTitle` additionally collapses any duplicate titles; re-render upsert semantics pinned (`meta-quality-r140.test.ts:171-206`).

## JSON-LD inventory (no-fabrication audit)

| Block | Emitter (line) | Layer / pages | Truth check | Pinned by |
|---|---|---|---|---|
| Organization | `seo-builders.ts:21-50` | client, home | `addressCountry LY` + `areaServed` Libya (real), logo → real file, `sameAs: []` — **no invented profiles** | jsonld-completeness (pure + behavioral) |
| WebSite + SearchAction | `seo-builders.ts:221-241` | client, home | `inLanguage ar`; SearchAction target = the REAL `/?search=` deep link home.tsx consumes | jsonld-completeness |
| ItemList | `seo-builders.ts:261-279` | client, home + category + flash-sales | slug-canonical URLs; **thin-LD guard** (suppressed when list empty) | jsonld-completeness + seo-money-pages |
| Product + Offer | `seo-builders.ts:98-166` via `product-seo.ts` | client, PDP | price = selected variant/product sale-aware price (the CTA number), `priceCurrency LYD` (never constants — source-scan pin), availability = `is_active`/`is_available` truth table (**44/45 live rows OOS → OutOfStock**), **no AggregateRating/reviewCount/ratingValue anywhere** (order_count is purchases, not reviews), `priceValidUntil` end-of-next-year | seo-builders.test + product-seo-availability + jsonld-completeness |
| BreadcrumbList | `seo-builders.ts:176-190` | client, PDP + category | الرئيسية → الفئة (only KNOWN categories; unknown → home) → المنتج | jsonld-completeness |
| FAQPage | `seo-builders.ts:199-212` | client, PDP (curated, gated) + category (canon) + support (static canon) | visible-parity rule pinned (same Q&A renders on page) | jsonld-completeness + seo-money-pages |
| OG share card | `spa-shell.ts:915-931` | serve-time, unfurlers only | `og:type=product`, `og:url` = product URL, flash-sale-aware grouped price in description, **no availability claim** (live OOS card probed: price-only) | share-card-bot-split (26 tests) |

Valid JSON syntax: all blocks pass through `JSON.stringify` twice (serialize → escape `\u003c` etc. → emit) and every behavioral test `JSON.parse`s the emitted script back out — a syntax break fails the suite. No duplicate blocks: one managed script per block, removed on unmount, no-duplication pinned.

## Sitemap / robots / canonical / og:image files (r140 verification — all still hold, live)

- **robots.txt** (served by `routes/seo.ts`, mounted before the shell at `app.ts:305`): live body matches the frozen wall set exactly — 6 Allow, 17 Disallow (incl. `/notifications`), Crawl-delay, Sitemap pointer. r140-m parity pin re-ran green.
- **sitemap.xml**: live = **56 URLs** (11 statics + 45 active products; archived/inactive excluded, tested). **Honest lastmod holds**: 7 *distinct* per-category `MAX(updated_at)` values (a VPN edit no longer freshens `/category/music`); `/support` + `/terms` omit lastmod; home + `/flash-sales` = global MAX; 45 distinct product timestamps. hreflang `ar` + `x-default` only (no phantom `en` alternate). Route coverage = the SPA's indexable statics + categories.ts SSOT, pinned by the seo.test.ts registry-parity test (retired gaming/productivity and the `/products` alias pinned absent).
- **Canonicals**: per-route, slug-canonical for products (numeric → slug, live-verified), stripped (not redirected) on noindex/unknown/404 families — all live-probed.
- **og:image real files**: `/opengraph.jpg` 1200×630 (`file`-verified, matches every declared dim), product art URLs resolve (lane B verified all 45 webp files; live spotify/cpanel cards carry real art URLs), logo fallback file exists.

## Missing tests (beyond those named in K-1/K-3/K-4)

1. **Variant sale price → Product LD**: both behavioral LD suites use variant-less fixtures; `product-seo.ts:36-40`'s `selectedVariant.sale_price ?? price` threading into `buildProductLd` is untested (the builder's price input is pinned, the variant selection is not).
2. Surrogate-pair boundary in both clamps (both surfaces share the edge; no astral chars in the live catalog — cosmetic, note only).
3. `buildShareDescription` whitespace-collapse vs the client's raw slice (divergent only for whitespace-run descriptions — none live; note only).

## Not findings (checked, adjudicated)

- **J-3 exclusion honored**: the «متوفر…تسليم فوري» fallback class was re-audited *elsewhere* per the charter — the live 45-shell description sweep found **zero** availability/instant-delivery claims in any meta description, and the share card makes no availability claim (price only). The class exists only in the client's last-resort description fallback (lane J owns it).
- **Share-card staleness (catalog cache TTL vs OOS flip)**: 60 s in-process + `s-maxage=300` edge for bot UAs only — documented trade-off; no availability assertion exists on the card, so an OOS flip cannot fabricate. The shell meta carries no availability either; the LD (client) reads the same 60 s-fresh DTO the buy button gates on.
- **UA detection**: 18 real UA strings pinned across the split; the two lists are disjoint and the middleware explicitly excludes indexers (`spa-shell.ts:863`) — belt and suspenders against future list drift. `Google-InspectionTool` falls to the shell (correct outcome).
- **GSC verification**: injected at build (wired in `vite.config.ts:292-918`), live meta present with `content=""` (token unset — documented harmless). B-1 (non-comment-aware primary viewport anchor) is lane B's; today's index.html carries no viewport-shaped decoy (R141 tag-sequence ban) — dormant.
- **`Crawl-delay: 1`** ignored by Google/Bing, honored by Yandex/Baidu — deliberate, documented.
- **Strict unfurler allowlist** omits redditbot/skypeuripreview etc. — by design («nothing gets the card unless it is a known link-preview fetcher»); Libya's dominant channels (WhatsApp/Facebook/Telegram/Twitter/Slack/Discord/LinkedIn/Pinterest) all covered.

## Verdict

The r140 SEO layer holds end-to-end at `a9f5e83` — every no-fabrication, noindex-wall, and lastmod-honesty pin re-ran green and every live probe agreed with the code. The rot is **parity at the edges of the shell rewriter**: the title clamp that doesn't mirror what it claims (K-1, visibly live on two pages), the two missing OG identity arms (K-2, every non-home raw shell), and the one noindex wall nobody pins (K-3). All fixes are single-digit-line changes in `spa-shell.ts` + a handful of tests; none touch the money path.

**Lean:** 0 deletions proposed; K-2 adds ~6 lines, K-1 rewrites 3, K-3 adds 7 test lines, K-5 is comment-only.

**Not checked:** Playwright e2e rendering of post-hydration heads (jsdom-level behavioral coverage stood in); Google Rich-Results live validator (needs GSC auth); the admin-side SEO field editors (lane C/D territory).
