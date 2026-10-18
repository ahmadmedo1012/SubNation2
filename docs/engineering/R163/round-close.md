# R163 — The end-to-end SEO & search-visibility completion round

Date: 2026-10-18. Status: gated locally (all gates green), committed,
pushed, CI verified, deployed and behavior-verified. Execution model:
coordinator + three read-only research lanes (parallel subagents) with
all implementation in the coordinator's hands.

**Scope identity (the round-numbering note):** R162's ADR named the
multi-order money lane an "R163 candidate". That lane is **deferred, not
displaced** — this SEO round took the R163 identifier; the money lane
remains scheduled as its own dedicated round (R164 candidate) with its
ADR (`docs/engineering/R162/adr-order-batch.md`) untouched and its full
criteria set unchanged.

## 1. Baseline and final SHAs

- **Starting SHA:** `61b66f7` (= origin/main, the R162 final commit;
  verified live with `git fetch` + clean tree before any work).
- **Final SHA:** `d7c5f77` (3 commits: the R163 feature round `af6a703`,
  the gitleaks fixture fix `62904ac`, the stock-correlation truthfulness
  fix `d745567` + the size-gate condense `d7c5f77`).
- **CI:** `39087001726` (on `62904ac`) **success** — the gitleaks
  rejection on `af6a703` (run `39086850991`) was the one CI failure of
  the round: the first test fixture keys were hex-shaped 32-char
  constants that tripped the `generic-api-key` entropy rule; replaced
  with dash-separated synthetic keys (never real secrets). Final CI
  `39089650055` (on `d7c5f77`) **success** — all jobs green incl. the
  e2e job (93/93 on its tree) and the NEW scripts matrix leg.
- **Deployment:** Coolify push-to-deploy fired on each push; verified by
  behavior probes (below), never assumed from a green CI.

## 2. Exact changes made (code + config)

| # | Change | Files |
| --- | --- | --- |
| 1 | **robots.txt noindex/Disallow conflict resolved** — the 13 de-indexed customer families (login, register, forgot-password, onboarding, auth/, cart, checkout, wallet, orders, loyalty, referrals, profile, notifications) are now deliberately CRAWLABLE so crawlers can read the `noindex,follow` these pages serve in the raw shell AND at runtime; only `/api/`, `/admin`, `/status` stay Disallowed by documented requirements | `backend/src/routes/seo.ts` + `seo.test.ts` re-pins (incl. the inverted parity test) |
| 2 | **Sitemap hreflang removal** — the redundant `hreflang="ar"` + `x-default` alternates (both → the SAME URL on a single-language site) removed with the `xmlns:xhtml` namespace; absence pinned | `backend/src/routes/seo.ts` + tests |
| 3 | **Unknown/retired categories → real 404** (was 200+noindex — the soft-404 class Google had already indexed via `/category/gaming`); the SPA still boots from the shell | `backend/src/lib/spa-shell.ts` + tests |
| 4 | **PDP crawler-shell Product JSON-LD in the initial HTML** — mirrors the frontend `buildProductLd` field-for-field (`@id` = the node the hydrated page re-emits → merged), flash-aware price, deliverable-stock-availability; 5 new tests | `spa-shell.ts`, `lib/shell-product-ld.ts` (carve) |
| 5 | **The stock-correlation truthfulness bug found & fixed** (post-deploy verification caught it): drizzle renders interpolated columns in raw `sql\`\`` templates BARE, so the subquery's correlation rendered `inventory.product_id = inventory.id` — the only in-stock product asserted OutOfStock; tests had passed coincidentally (fresh DBs give both tables id=1). Hand-qualified SQL + a hardened id-divergent test | `spa-shell.ts` (commit `d745567` — the full story is in that diff) |
| 6 | **Bing IndexNow, env-gated** — key file route `GET /<key>.txt` (INDEXNOW_KEY, 8–128 chars `[A-Za-z0-9-]`, never committed) + single-URL GET submissions with a ≥5-min per-URL debounce, wired to product create/update/archive, variant CRUD, inventory upload/trim, flash-sale + pricing-config changes; 13 lib tests + 3 route tests; fully inert when unconfigured | `backend/src/lib/indexnow.ts` (new), wiring in `admin/products.ts`, `admin/product-variants.ts`, `admin/flash-sales.ts`, `admin/pricing-config.ts`, `admin/products-inventory.ts`, mount in `spa-shell.ts` |
| 7 | **features[] admin write surface** (the census gap): PATCH accepts `features` (≤32 items, 1–500 chars each; trimmed; whitespace-only dropped; `[]` clears; omitted = untouched), list projection round-trips it, admin editor gained the المزايا textarea (dirty-aware submit); 8 route tests | `openapi.yaml` + regenerated clients, `admin/products.ts`, `ProductEditorCard.tsx`, `admin/products.tsx`, `products-meta.ts` |
| 8 | **SEO_PRODUCTS.json re-keyed** — the 4 stale slugs + the Spotify name drift, after a verified dry run (below) | `docs/SEO_PRODUCTS.json` |
| 9 | **Home meta description** tightened to the query-aligned lead + the REAL payment rails («الدفع عبر ليبيانا ومدار وLyPay») + ChatGPT in the brand list; **TrustFooter** step 2 gains LyPay | `home.tsx`, `spa-shell.ts` mirror + parity pins, `TrustFooter.tsx` |
| 10 | **CI**: the scripts test suite joins the unit-test matrix (R162's pending decision #5) | `.github/workflows/ci.yml` |
| 11 | **Size-gate carves** — `lib/shell-meta.ts` + `lib/shell-product-ld.ts` out of spa-shell.ts (1039/1039 by the gate's count); the inventory set-count route → `routes/admin/products-inventory.ts` (products.ts at 859 lines — its R158 growth-ban tripwire retired per the register-honesty rule) | + the register edit in `backend-size-gate-r143.test.ts` |
| 12 | **e2e SEO spec** enriched 3→6 tests, deploy-race-safe (feature-detect + loud skip): hreflang absence, category 404, crawlable noindex families, the PDP shell LD vs the API's own offer | `frontend/e2e/seo.spec.ts` |
| 13 | `INDEXNOW_KEY` documented in `config/env.example` (with the generation command + the restart requirement) | `config/env.example` |

## 3. Production technical-SEO state (probed, all GET-only)

- **Origins:** `https://subnation.ly/` 200; `http://` → 301 → https;
  `www.` → 301 → apex; valid certificates; no redirect loops.
- **Canonicalization:** trailing-slash, query-param, mixed-case and
  numeric-id variants all canonicalize to the clean apex URL (verified
  on `/category/streaming/`, `/product/netflix-premium/`,
  `/?utm_source=…`, `/category/streaming?page=2`, `/SUPPORT`,
  `/support/`, `/product/10` → canonical `/product/apple-tv`). APP_URL,
  the shell rewriter, OG urls and the sitemap all agree on
  `https://subnation.ly`.
- **robots.txt (live, post-deploy):** the new design serves — public
  Allow list intact; the 13 de-indexed families CRAWLABLE (each serves
  `noindex,follow` in raw HTML — verified live on /login, /cart,
  /wallet); only `/api/`, `/admin`, `/admin/`, `/status` Disallowed;
  `Sitemap: https://subnation.ly/sitemap.xml` + `Crawl-delay: 1`.
- **sitemap.xml (live, post-deploy):** 56 URLs (11 static + 45
  products), 0 duplicates, absolute URLs only, lastmod on 54
  (support/terms honestly omit), hreflang GONE (verified).
- **Full sitemap crawl (pre-change, 56/56):** every URL 200,
  self-canonical, `index,follow`, non-empty unique titles (21–60 chars)
  and descriptions (34–147 chars) — zero problems. Post-deploy the same
  set re-verified via the e2e suite.
- **Soft-404s:** unknown products already 404 (the indexed `/product/8`
  error page is a historical artifact — it 404s now and will drop from
  the index on recrawl; GSC URL removal is an owner option);
  **unknown/retired categories now 404 too** (`/category/gaming` and
  `/category/<anything>` → 404 + noindex + bootable shell).
- **Client-404 UX preserved:** unknown generic paths still serve the
  200 shell + client 404 UI (e2e-pinned).

## 4. Google Search Console — access status and public evidence

**Access status: NOT AVAILABLE from this environment.** No
authenticated GSC session, connector, or API access exists here (the
environment holds only the GitHub PAT); the property was verified by
the owner (method unknown from here — the HTML-tag meta infrastructure
exists and ships `content=""` because `VITE_GSC_VERIFICATION` is unset
at build time, which is harmless and documented). No GSC operations
were performed and NONE are claimed.

**Public supplementary evidence (the honest part):** the SERP research
lane observed subnation.ly at **position 3 for «اشتراكات رقمية في
ليبيا»** and 6 URLs via `site:` — the site IS partially indexed,
including two error-page URLs (`/category/gaming`, `/product/8`) now
fixed at the HTTP level, and `/product/10` (whose live title/canonical
verified correct — the listing snippet was stale cache). Absence from
other query results in the search tool does NOT prove non-indexation.

**Exact owner action (the smallest one):** open Search Console → the
verified property → (a) submit `https://subnation.ly/sitemap.xml` if
not already read (Settings → Sitemaps); (b) URL-inspect the homepage +
the 7 category URLs and request indexing for the handful of priority
pages; (c) optionally request removal of the two historical error-page
URLs; (d) review Page indexing → "Indexed, though blocked by
robots.txt" — the R163 robots change eliminates future entries of that
class. CWV field data (Section 8) lives there too.

## 5. Bing Webmaster Tools & IndexNow

- **BWT registration: unknown from here; no credentials exist in this
  environment** (no BWT actions performed or claimed). Bing honors the
  `Sitemap:` robots.txt line regardless. **Owner action:** register
  subnation.ly in BWT (meta-tag method needs a one-line shell addition
  if chosen — ask and it ships) to gain the reporting tab.
- **IndexNow: fully implemented, ready to activate.** No BWT
  registration is required (the key file is the only verification —
  verified against the live API contract by the research lane). The
  code is deployed and INERT until the operator sets `INDEXNOW_KEY`
  (32-char hex via `openssl rand -hex 16`) in the Coolify env table and
  restarts. Submissions then fire automatically on the documented
  catalog-change triggers. **No key file exists on production yet** (no
  `.txt` probe succeeds — verified); no submission has been made, and
  none is claimed.

## 6. Search landscape research (evidence-based)

Full reports: `/home/z/my-project/tool-results/r163-r2-serp-research.md`
(+ r1 Google guidance, r3 Bing/IndexNow; worklog R163-R1/R2/R3).

- **Competitor archetypes observed:** (1) true Libyan subscription
  stores (awfar.ly, mdcard.ly, subworld.ly, spinor.ly, wal-store.com,
  onetvstore.com) winning on duration+guarantee+WhatsApp snippets and
  visible LYD prices; (2) telco/bank-adjacent card platforms
  (libyana.ly, libyaplay.com, atib.ly, libyacards.com) owning the
  «متجر/شراء اشتراكات» head terms with payment-trust messaging; (3)
  pan-Arab gray-market stores + social commerce (Facebook groups/
  OpenSooq/TikTok absorbing Libyan demand at 45–80 LYD Netflix etc.).
- **What winners' snippets do:** duration + quality + price in one
  sentence; the «مضمون 100% + تفعيل فوري + واتساب» trust stack; LYD
  price inside the meta description; dual-script brand naming.
- **SubNation's counter-moves shipped this round:** the home description
  now leads with «متجر اشتراكات رقمية في ليبيا» (the head query), names
  the real payment rails, and includes ChatGPT (the growing intent
  cluster where Facebook sellers answer price questions today). The
  category metas were verified already strong (7/7 carry LYD + locale +
  brands, parity-pinned).
- **Keyword-to-page map (current, honest):** home → «اشتراكات رقمية في
  ليبيا» (already 3rd) + the store-intent head; the 7 category landings
  → their family queries (streaming/«منصات المشاهدة»، موسيقى، VPN،
  AI-tools/«اشتراك ChatGPT Plus ليبيا»، SEO tools، التعليم);
  product pages → brand+ليبيا long-tails. No new landing pages were
  created (no doorway/thin pages; the existing surface covers the
  mapped intents).
- **Not observed (honestly):** search volumes, difficulty scores,
  traffic estimates — no such data was available; nothing is invented.

## 7. Catalog content (the R162 census follow-through)

- **Availability snapshot (re-queried this round):** 45 active products,
  **44 sold out, 1 in stock** (Lifetime Cloud Storage) — unchanged from
  R162. No stock was touched. Policy held: sold-out products keep their
  pages, sitemap membership and honest OutOfStock structured data
  (Google's guidance: keep markup on unavailable products; no doc
  supports dropping temporarily-unavailable URLs from sitemaps).
- **The 24 authorized mechanical fixes: live facts re-verified 24/24**
  (each finding's current text confirmed still verbatim-present against
  the live by-slug API — `scripts/r163-livefact-verify.py`). The
  owner's authorization condition is therefore certified.
- **Application BLOCKED, precisely:** this environment has NO
  production admin credentials (only the GitHub PAT exists here;
  logging in or creating an admin account would circumvent
  authorization). **The exact owner action:** apply the fixes via the
  admin panel following `docs/engineering/R162/catalog-content-review.md`
  §"Application path" per finding (the three surfaces: product form /
  الباقات variants dialog / enrichment panel) — or provide an
  authorized admin session and the next round applies them.
- **The features[] blocker is CLOSED at the code level:** the PATCH
  API + admin editor now support editing the checklist (this round,
  8 tests) — the 4 census findings touching features (F9, F12, F18,
  F36) have a supported write path on production as of this deploy.
- **The 12 business decisions remain owner decisions** (Netflix tier
  binding, Windows 8 EOL, Ahrefs pricing, Headspace taxonomy,
  Funimation dead-service, cPanel licensing, SoundCloud framing,
  Hallmark+ rebrand, Fox Now sourcing, Pandora dialect, Ahrefs FAQ
  specs, plus the R162-D commercial-truth verdicts) — none were
  guessed; none were applied.

## 8. SEO snapshot reconciliation (docs/SEO_PRODUCTS.json)

- **Method:** the importer's join (slug-first, exact-name fallback,
  name-branch id-ordered — the R162-B deterministic semantics)
  replicated against the live catalog via the public API
  (`scripts/r163-seo-reconciliation.py`).
- **Before:** 45/45 matched — 41 by slug, 4 by the name fallback
  (netflix, disney-plus, prime-video, apple-tv-plus → the intended ids
  1/3/17/10), 0 missing, 0 archived, 0 duplicate names/slugs.
- **After re-key (dry-run):** all 45 mappings preserved; the 4 re-keyed
  entries resolve BY SLUG to the same ids; every target slug is a live
  catalog slug. The Spotify name drift ("Spotify" → "Spotify Premium")
  also corrected (cosmetic — the slug always matched).
- **Applied:** the 5 identifier corrections committed. **No import was
  executed against any database; no `--force` was used anywhere; no
  `--apply` was run** (a plain apply would write nothing anyway — every
  live field is non-empty, the R132 curation protected). The
  `internal_link_suggestions` editorial notes still reference the four
  old slugs as URLs — left as frozen research copy (the importer
  ignores them); noting them here so nobody mistakes them for live
  links.

## 9. Structured data, performance, crawlability

- **Structured data:** rendered-side JSON-LD verified 40/40 (R162-B)
  and still ships (client Product + Breadcrumb + FAQ per PDP). NEW:
  the crawler shell now carries Product/Offer in the **initial HTML**
  (Google's recommendation) — spot-verified live on 6 PDPs post-deploy
  with per-product prices correct (79.80 / 99.80 / 980.00 LYD) and
  availability honest (InStock for the one in-stock product,
  OutOfStock for the rest — after the correlation fix `d745567`).
  The e2e test pins LD-vs-API agreement. No aggregateRating/review
  fabrication anywhere (pinned at both surfaces).
- **Performance (lab, from this environment's vantage):** homepage
  TTFB 0.60s / total 0.78s; PDP TTFB 0.82s post-LD-injection (the
  shell rewrite is memoized; the LD adds ~1.3KB HTML); transfers:
  HTML 19.7KB→7.7KB gz, main JS 121.5KB→34.7KB, CSS 258KB→28.5KB;
  assets immutable 1-year, shell no-store. Eager bundle **146,798 B
  gz (budget 150 KiB)** — the enforced budget held (+3 B vs R162).
  **CWV FIELD DATA: not available from here** (GSC-gated; the owner
  should read the Core Web Vitals report — the lab numbers suggest
  LCP is comfortable from this vantage, but field data from Libyan
  users is the truth that matters).
- **Internal links/crawlability:** homepage → category rail → product
  cards are real crawlable `<a href>` links (e2e-verified navigation);
  breadcrumbs render on PDPs (BreadcrumbList LD); every product is
  reachable without the search box (the sitemap crawl verified all 45
  resolve 200 with content). The `/products` alias stays noindex
  (client redirect; no duplicate-content surface).

## 10. Gates, counts, security, deployment

- **Backend:** 2,675 tests green in 3 chunks (lib+services 1,214;
  routes 913; rest 548) — +29 vs R162 (IndexNow 13+3, features 8, LD
  5). **Frontend:** 283 files / 2,643 (baseline held). **Scripts:** 6.
- **lint** 0 errors / 15 baseline warnings · **typecheck** clean ·
  **parity 86 ops** · **error-codes 55** · **headers 7/7** ·
  **drizzle no drift** · **codegen idempotent** · **build green**
  (eager 146,798 B gz).
- **Secrets:** the one CI gitleaks finding (test-fixture entropy) fixed
  same-round; no real secret ever existed in the diff. INDEXNOW_KEY is
  env-only by design.
- **e2e against production:** pre-deploy 123 passed + 12 deploy-race
  skips; **post-deploy 135/135 passed (9.4m)** — the 4 new SEO tests
  now actively verify. Plus the final targeted re-run after the
  correlation fix (8/8).
- **Deployment verified by behavior:** new robots.txt live; hreflang
  gone; /category/gaming 404; PDP shell LD live with correct prices
  and availability; healthz ok; the hydrated SPA unaffected (135 e2e).
- **Remaining risks:** (a) the 44 sold-out products limit conversion
  until restock (not an SEO defect); (b) Google's re-crawl of the
  changed robots/noindex/404 surfaces takes days-to-weeks — GSC
  monitoring is the owner's window; (c) IndexNow stays dormant until
  the env key is set; (d) the shell's LD is a SECOND block beside the
  client-rendered one — same @id, merged by design, monitored by the
  e2e parity test.

## 11. Genuinely unavoidable owner actions (complete list)

1. **GSC (minutes):** verify sitemap status, request indexing for the
   homepage + 7 categories (+ any priority PDPs), optionally remove
   the two historical error-page URLs, review Page indexing over the
   next 2–4 weeks.
2. **IndexNow activation (minutes):** `openssl rand -hex 16` → set
   `INDEXNOW_KEY` in Coolify env → restart. (Optional but recommended;
   the feature is fully tested and inert until then.)
3. **The 24 mechanical catalog fixes (one sitting):** apply via the
   admin panel per the census document's application paths (live facts
   verified 24/24 this round) — or supply an authorized admin session
   for the next round to apply them.
4. **The 12 business decisions** (unchanged from R162; the census
   table's one-line answers needed before/with any restock).
5. **BWT registration (optional):** for Bing-side reporting; not
   required for IndexNow to work.
6. **CWV field data:** read the GSC Core Web Vitals report (the only
   real-user source; lab numbers are in §9).

## Files changed this round

Backend: `routes/seo.ts`, `lib/spa-shell.ts`, `lib/shell-meta.ts` (new),
`lib/shell-product-ld.ts` (new), `lib/indexnow.ts` (new),
`routes/admin/products.ts`, `routes/admin/products-inventory.ts` (new),
`routes/admin/product-variants.ts`, `routes/admin/flash-sales.ts`,
`routes/admin/pricing-config.ts` + 7 test files (2 new). Frontend:
`e2e/seo.spec.ts`, `pages/home.tsx`, `pages/admin/products.tsx`,
`components/home/TrustFooter.tsx`, `components/admin/products/
ProductEditorCard.tsx`, `components/admin/products/products-meta.ts` +
2 test files re-pinned. Shared: `api-spec/openapi.yaml` +
regenerated `api-zod`/`api-client-react`. Config/docs:
`.github/workflows/ci.yml`, `config/env.example`,
`docs/SEO_PRODUCTS.json`, this report.
