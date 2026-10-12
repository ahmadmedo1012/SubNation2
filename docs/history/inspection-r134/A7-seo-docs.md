> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r134/A7-seo-docs.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R134 · A7 — SEO live state + meta rewriter + docs truth (read-only audit)

> Round: R134 · Agent: A7 (SEO + docs truth) · Base SHA: `5d5227c` (R133,
> deployed) · Date: 2026-10-11/12 · Mode: **read-only** (code reads +
> read-only curl GETs to `https://subnation.ly`).
>
> Scope per the R134 brief: (1) live SEO state probes, (2) meta-rewriter
> truth in `backend/src/app.ts`, (3) structured data, (4) docs truth
> (index vs reality, CHANGELOG vs git, `.hermes.md` claims, operations
> currency, `SEO_PRODUCTS.json` staleness), (5) the R120 GSC leftover.
> Exclusions respected: the 4 slug re-keys (operator curation, documented
> in CHANGELOG R132 L4-F1), Cloudflare CDN (operator), TTFB (measured
> R132 L4-F6), inventory loading (operator), A5-F6 `/sw.js.map` soft-200
> (accepted).
>
> CHANGELOG R120–R133 SEO entries were read FIRST; nothing already
> recorded as fixed/known/deferred is re-reported as new.

## Verdict (one line each)

- **SEO surface health: GREEN.** Zero P0/P1/P2 on the live crawl
  surface. Every crawlable surface serves a real per-route
  title/description/canonical (verified live on 9 URLs + 5 edge cases);
  noindex families and unknown paths are correctly stamped and
  canonical-stripped; edge redirects are single-hop 301s with
  path+query preserved; sitemap/robots are coherent and well-formed.
  The remaining SEO gap is **operational, not code**: GSC verification
  was never done (R120 leftover, still tracked as pending).
- **Docs truth: STRONG with 4 stale spots** — the README index http→https
  line, the `SEO_PRODUCTS.json` row status, the `.hermes.md` test-count
  figure, and the missing R132 SEO-curation item on the operator-actions
  surfaces. Census, CHANGELOG-vs-git, and the operations runbooks all
  verified accurate.

---

## 1. Live SEO state (read-only probes, 2026-10-11 ~20:47–20:53 UTC)

All probes: plain `curl` (no UA spoofing unless noted). Head extracted
comment-blind (the production shell carries `<title>`-in-prose comments —
the d22f24e class; naive regexes misread them).

### 1.1 Per-surface meta matrix

| Surface | Status | title | description | canonical | robots | og set |
|---|---|---|---|---|---|---|
| `/` | 200 | «سوق الاشتراكات الرقمية في ليبيا \| SubNation» (SHELL_HOME_META) | keyword-forward ~147c copy | `https://subnation.ly/` | `index,follow` | og:title/desc/type/og:image `opengraph.jpg` 1200×630 ✓ |
| `/category/streaming` | 200 | «البث المباشر في ليبيا — Netflix و Disney+ \| SubNation» | category metaDescription | self | `index,follow` | full og set ✓ |
| `/category/vpn` | 200 | «اشتراكات VPN في ليبيا — ExpressVPN \| SubNation» | category metaDescription | self | `index,follow` | full og set ✓ |
| `/product/lifetime-cloud-storage` | 200 | DB `seo_title` (clamped, see F7) | DB `seo_description` | self | `index,follow` | og:image = **per-product art** `/products/lifetime-cloud-storage.webp`; og:image:width/height stripped ✓ |
| `/flash-sales` | 200 | «عروض فلاش — SubNation» | R124-lengthened 140c copy | self | `index,follow` | full og set ✓ |
| `/support`, `/terms` | 200 | real per-route titles | real copy | self | `index,follow` | full og set ✓ |
| `/login` | 200 | baseline (by design) | baseline | **stripped** (0 canonical tags in body) | `noindex,follow` | baseline |
| `/products` (unknown public path) | 200 | baseline (by design) | baseline | **stripped** | `noindex,follow` | baseline |
| unknown path `/this-page-does-not-exist-a7` | 200 (SPA 404 owns UX) | baseline | baseline | **stripped** | `noindex,follow` | baseline |
| unknown category `/category/not-a-real-category-a7` | 200 | baseline | baseline | **stripped** | `noindex,follow` | baseline |
| dead product slug `/product/netflix-premium-dead-test-a7` | **404** | baseline | baseline | **stripped** | baseline `index,follow` (see F6) | baseline |
| `/product/17` (numeric id) | 200 | product shell for id 17 | — | **`…/product/amazon-prime-video`** (slug canonical ✓) | `index,follow` | — |
| `/product/<slug>/` trailing slash | 200 | — | — | normalized non-slash ✓ | — | — |
| `/index.html` direct | 200 | baseline + canonical `https://subnation.ly/` | — | — | — | — |

Headers on every shell: `Cache-Control: no-cache, no-store,
must-revalidate`, `Content-Language: ar`, full security header suite
(CSP/HSTS preload/COOP/CORP/permissions-policy…), `<html lang="ar"
dir="rtl">`. No `hreflang` link tags in HTML — deliberate
(Arabic-only; sitemap carries `hreflang="ar"` + `x-default`
per-entry; `seo.ts:192-198` documents why no fake "en" alternate).
**No leaked noindex on any real crawlable page** — the only
`noindex,follow` emissions are the intended families (probed `/login`,
`/products`, unknown path, unknown category).

Edge/canonicalization (all live-verified):

- `https://www.subnation.ly/?x=1` → **301** → `https://subnation.ly/?x=1`
  (path+query preserved, single hop — `num_redirects: 1`).
- `http://www.subnation.ly/x?y=1` → **301** → `https://subnation.ly/x?y=1`
  (www+http collapsed in one hop).
- `http://subnation.ly/flash-sales` → **301** → https apex.
- Matches `docs/operations/WWW_TO_APEX_301.md` (301-since-R124-redeploy
  note) and runbook §13. The R121-era CHANGELOG "308" digit is
  documented as superseded in the doc itself.

### 1.2 robots.txt + sitemap.xml

- `/robots.txt`: coherent; matches `backend/src/routes/seo.ts:48-94`
  byte-for-byte (Allow `/`, `/product/`, `/category/`, `/support`,
  `/terms`; Disallow auth/cart/checkout/private/admin/status/api;
  `Crawl-delay: 1`; `Sitemap: https://subnation.ly/sitemap.xml`).
  Disallow families == `SHELL_NOINDEX_RES` == SPA `NOINDEX_ROUTES`
  (app.ts:1287-1302). ✓
- `/sitemap.xml`: **56 URLs** (11 static + 45 products), XML
  **well-formed** (minidom parse), **0 duplicate locs**, all apex.
  Every entry carries `hreflang="ar"` + `x-default` alternates.
  R122 lastmod policy live: `/support` + `/terms` correctly **omit**
  lastmod; catalog-driven statics share `MAX(updated_at)`
  (`2026-09-20T20:15:19.151Z`); per-product lastmod = row `updated_at`.
- **Does it list unavailable products? Yes — all 45 active rows**
  (`isActive AND NOT isArchived` only; `seo.ts:214-222` has no stock
  filter). This is the by-design restock strategy: the 44 sold-out PDPs
  remain 200/`index,follow` and assert **OutOfStock honestly** in LD
  (see §3), so the sitemap is not promoting a lie. Inventory state
  itself is the operator's excluded item. Informational, no defect.

### 1.3 Bot-class split + share card (live)

- UA `WhatsApp/2.23.20.0` on the product URL → the **DB-backed OG card**
  (og:type=product, og:title = curated `seo_title`, description with
  «— السعر 980.00 د.ل» suffix, absolute og:image, og:url, twitter set).
  ✓ R128 B8-D1 curated-fields behavior live.
- UA `Googlebot/2.1` on the same URL → the **SPA shell** (`id="root"`
  present, not the 1KB card). ✓ R111 D2-F1 split live.

## 2. Meta rewriter truth (`backend/src/app.ts`)

Read the full rewriter chain (lines 944–1760). Structure confirmed:

1. `app.use(seoRouter)` at :947 — robots/sitemap mount BEFORE static.
2. Two `express.static` mounts (:1540-1612) both with `index:false` +
   `redirect:false` — the R127-B12-F1 home-shell fix and the R126
   A11-F2 `/products` + R128 B2-F2 `/assets` directory-redirect fixes
   are all in place; the SPA fallback (:1718-1760) owns ALL html route
   serving.
3. `SPA_SHELL_HTML` boot guard (:1010-1033) — comment-balance check
   (`shellCommentsBalance`, :1042) refuses to rewrite an imbalanced
   shell (d22f24e class), serving baseline instead.
4. `resolveSpaShellMeta` (:1427-1538) — the route→meta resolver:
   - `/` → SHELL_HOME_META (R127-L9 keyword copy; parity-pinned).
   - `/category/:slug` known → static category map (parity-pinned);
     unknown → `noindex,follow` + canonical stripped (R122 A7-P1-2).
   - `/product/:slug|id` → cached DB lookup
     (`lookupProductForShareSurfaces`, :1135-1180, catalog-cache 60s,
     dead-slug misses cached, 160-char slug guard); inactive/archived/
     unknown → **404** (A7-F7); found → DB `seoTitle`/`seoDescription`
     preferred (R122 A7-P1-1) with `clampSeoTitleForShell` 60-char
     parity, slug canonical, per-product og:image + dim-tag strip
     (R126 A11-F3b).
   - statics `/flash-sales` `/support` `/terms` → fixed meta + self
     canonical.
   - `SHELL_NOINDEX_RES` (14 families) → `noindex,follow`, canonical
     stripped.
   - unknown → `noindex,follow`, canonical stripped (200 so the SPA's
     404 UI owns the UX).
5. `applySpaShellMeta` (:1389-1421) — every surgery runs inside
   `rewriteOutsideComments` (:1376-1383, comment-blind split); ONLY
   existing tags are rewritten, never inserted.

**Answer to "any surface still serving the generic shell title?"** —
**No crawlable surface.** Home/category/product/statics all get real
per-route titles (products from DB; categories/home/statics from
parity-pinned constants — the documented design, since categories have
no DB meta rows). The generic baseline title appears only where it is
by-design: noindex families, unknown paths (SPA 404 UX), the dead-slug
**404** shell (F6 below), and the known-accepted `/index.html` direct
hit (A11-F6, documented at app.ts:1569-1570).

DB-truth of the live product surface confirmed end-to-end: the one
available product's `seo_title`/`seo_description` (measured R132 as
DB-newer than `SEO_PRODUCTS.json`) are exactly what the live raw shell
serves — the R122 DB-preferred path is working on production.

## 3. Structured data

Raw-HTML JSON-LD: **absent on every surface** — all JSON-LD is
client-rendered by the SPA (`frontend/src/components/seo/JsonLd.tsx`;
builders in `frontend/src/lib/seo-builders.ts`). This is the documented
architecture (R111 D2-F1: indexers get the SPA shell; Google WRS
renders JS; the insert-nothing rewriter can't add LD). Non-rendering
engines see title/description/canonical/og only. Known trade-off, not
re-reported as a defect.

Rendered-surface builders (code-verified + test-pinned; JS rendering
not probe-able via curl):

- **Product** (`seo-builders.ts:81-149`): name, image (absolutized),
  sku (slug-based), brand=SubNation (seller, not category), category,
  top-level `url` (R123-E4b), Offer{price, LYD, priceValidUntil, url,
  availability, NewCondition}.
  **Availability honesty: YES** — `is_active===false ||
  is_available===false → OutOfStock` (:142-145); the PDP threads the
  REAL `is_available` (product.tsx ~:792, "the same signal the buy
  button gates on"). With 44/45 unavailable, rendered PDPs assert
  OutOfStock while the UI says «نفد المخزون» — pinned by
  `product-seo-availability.test.ts` (zero-stock → OutOfStock) and
  `seo-builders.test.ts` (the 45/45 live shape case).
- **BreadcrumbList** (:159-173): home → category → product, on PDPs
  (+ category pages per `seo-money-pages-r120.test.tsx`).
- **Organization** (:21-50): LY address + areaServed Libya + honest
  catalog description (R120-B3 A7-F5).
- **WebSite + SearchAction** (:204-224): homepage; target `/?search={
  term}` — live-verified the target resolves 200.
- **FAQPage** on PDP/category (when FAQs exist) + **ItemList** catalog
  refs — pinned by `seo-money-pages-r120.test.tsx:145`.
- Minor: `priceValidUntil` is computed per render from the current
  year (:98-99) — fine.

## 4. Docs truth

### 4.1 Index census — `docs/README.md` vs `docs/` reality

The "CURRENT — 50 files in place" claim is **exact**: 36 md (incl. the
index) + 13 mmd + 1 json — counted: docs root 9 md + SEO_PRODUCTS.json,
operations 8, architecture 2, deployment 10, loyalty 2, pricing 1, ux
1, project-plan 1, project-state 2, project-graph 13 mmd. **No
orphaned doc, no missing doc.** `docs/inspection-r124…r130` exist;
r131's absence matches the R132 record (R131 never pushed). specs/
rows match. Bucket counts (HISTORY 74 / DEPRECATED 16 / PENDING 1)
not re-counted (unchanged lanes since R122).

### 4.2 CHANGELOG R132/R133 vs git log — ACCURATE

- R133 entry: "local main = `6a77590` (the five R132 commits)…
  `56b8bf9..6a77590`" — git log shows exactly 5 commits in that range
  (`694f7af`, `e46caf5`, `bebc427`, `0b869a7`, `6a77590`) ✓; R133's
  own four commits (`d083996`, `cf94a76`, `26279f6`, `5d5227c`) exist
  and match the entry's finding IDs (A3-F2/F4/F5, A4-F6/F7/F8, A7-F2)
  ✓. Gate figures (backend 2,305 / frontend 1,270) consistent between
  CHANGELOG and the README R133 block.
- The R132 L4-F1 SEO record (41/41 drift, keep-unless-force, 4 re-key
  candidates) is present and matches `scripts/src/import-seo.ts`
  coverage claims (spot-checked `seoTitle`/`seoDescription` channels in
  admin + importer).

### 4.3 `.hermes.md` claims vs reality

- **develop-branch filter note** (:16-19): ACCURATE —
  `.github/workflows/ci.yml:5,7` still carry `develop` in the branch
  filters; the note honestly calls it inert + queued. The queue is now
  ~15 rounds old (R119→R133) — F9.
- **vercel/render retirement** (:29): ACCURATE — no `render.yaml` /
  `vercel.json` / `deploy.yml` in the tree ✓.
- **test-count note** (:42-43, "~2300 tests is a healthy total"):
  **STALE** — F4. R133 reality: backend 2,305 + frontend 1,270 ≈ 3,575
  combined; "~2300" now describes the backend suite alone, so a
  combined run showing ~2,300 would actually mean the FRONTEND suite
  silently did not run — the note's failure mode is inverted.
- Last touched `0d8980d` (R126) — the file predates R127–R133 growth.

### 4.4 Operations currency

- **`FINAL_INVENTORY_LOADING.md`**: substantively CURRENT — the
  mechanism section matches HEAD (spot-verified
  `deliverableUnitCondition` products.ts:~86-91, manual.provider claim
  order :50-79 + R93-DATA gate :97-110, inventory.ts:33-39 scoped-pool
  contract comment). Line cites drifted ±5 lines only. Status header
  ("stock items 2/3 still open") consistent with the operator-actions
  list.
- **`WHATSAPP_OPERATIONS.md`**: CURRENT — the R117 Coolify rewrite is
  accurate (openwa internal container `http://openwa:2785`, Docker-
  network-only, Render gateway retired/suspended, Coolify-panel ops).
  Consistent with `docs/deployment/COOLIFY_FINAL_SETUP.md` refs.
- **`WWW_TO_APEX_301.md`**: accurate + live-verified today (301,
  single hop, query preserved).
- **`OPERATIONS_RUNBOOK.md` §14**: carries GSC + Sentry de-scoping +
  stock/TOTP + R123/R124/R130 entries; header parenthetical "(R122
  status; R123/R124 additions below)" is stale now that R130 entries
  live there too (F12, cosmetic).

### 4.5 `docs/SEO_PRODUCTS.json` staleness note

**The note does NOT exist where it matters.** The R132 round-record
block in `docs/README.md:62` says "L4-F1 (DB is the NEWER truth —
importer extended, keep-unless-force load-bearing)" — but the file's
own index row (`docs/README.md:263`) still stamps it
"**CURRENT** — the 45 curated Arabic product entries" with no
staleness qualifier, and the JSON itself carries no header note. An
operator reading the row (not the round history) has no signal that
the live DB carries newer operator-curated overrides and that a plain
import is only safe because of keep-unless-force. — F3.

## 5. GSC verification (R120 leftover) — NEVER DONE

- Live evidence: `<meta name="google-site-verification" content="" />`
  ships on **every** page (all 14 probes) — the build-time
  `seoHeadInject` plugin (vite.config.ts:292-298) emits an EMPTY tag
  when `VITE_GSC_VERIFICATION` is unset (documented harmless in
  `frontend/index.html:19-23`).
- Records: `OPERATIONS_RUNBOOK.md` §14 line 711 tracks it as pending
  ("still unset… paste-and-go: operator pastes the Google Search
  Console HTML-tag token into the Coolify build args → redeploy");
  R120 "Known deferred" listed it; `docs/deployment/FINAL_OPERATOR_INPUTS.md`
  is the operator-boundary doc. No verification record exists anywhere
  (searched deployment/ + operations/) — **it was never executed**.
- Consequence: no Search Console telemetry, no manual sitemap
  submission, no coverage/rich-result visibility for the whole R120+ 
  SEO program. Operator paste-and-go; nothing code-side is broken. — F1.
- Related doc drift: `FINAL_PRODUCTION_ENV.md`'s row for
  `VITE_GSC_VERIFICATION` says "unset = no tag" — the plugin actually
  emits an EMPTY tag (live + index.html comment). — F10.

---

## Findings (ranked)

- **F1 · P3** — GSC verification never executed (R120 leftover, still
  open). Evidence: empty `google-site-verification` meta on every live
  page; `OPERATIONS_RUNBOOK.md:711-714`; no verification record in
  docs/deployment or docs/operations. Operator action (paste token →
  Coolify build arg → redeploy); code side complete.
- **F2 · P3** — `docs/README.md:24-25` stale http→https claim: "the
  apex's own http→https hop is a temporary redirect, the one remaining
  edge polish item" — LIVE is **301** (probed http apex + http www),
  runbook §14 says "✅ RESOLVED R130", and the R130 round record in the
  SAME file says 301. Internal contradiction in the docs front door.
- **F3 · P3** — `SEO_PRODUCTS.json` staleness note missing at the row
  level: `docs/README.md:263` still stamps the file CURRENT although
  R132 L4-F1 measured the live DB newer (41/41 differ); no banner note
  inside the JSON either. Round record (README:62) is the only carrier.
- **F4 · P3** — `.hermes.md:42-43` "~2300 tests is a healthy total" is
  stale/misleading: R133 combined = backend 2,305 + frontend 1,270
  ≈ 3,575; the note's own "smaller number means a suite did not run"
  heuristic now misfires at the ~2300 figure (backend alone).
- **F5 · P3** — the R132 operator SEO-curation pass (4 slug re-keys +
  DB-newer-than-JSON direction) is documented ONLY in the CHANGELOG
  round record — absent from `OPERATOR_ACTIONS_R118.md` (rg
  "R132|re-key|slug" → 0 hits) and runbook §14's pending list, i.e.
  the surfaces operators actually read for "what's next".
- **F6 · P4** — dead-slug 404 shell inconsistency: the raw 404 keeps
  baseline `robots=index,follow` + generic title
  (`app.ts:1476` returns `{status:404, canonical:null}` — no robots/
  title rewrite), unlike unknown-path/unknown-category which stamp
  `noindex,follow`. Harmless (HTTP 404 governs deindexing; the SPA
  renders its own noindex,follow 404 UI client-side — product.tsx 404
  branch), but the raw/SPA pair is inconsistent for the one family.
- **F7 · P4** — the one available product's operator `seo_title`
  exceeds the 60-char display budget, so ALL surfaces (raw shell, og:
  title, share card) show the clamp truncation mid-brand:
  «Lifetime Cloud Storage — اشتراك أصلي بالدينار الليبي \| **SubN…**».
  Clamp parity is by-design (R122 A7-P2-5); root cause is operator
  content length; the admin SEO form gives no length warning.
  Content-level fix: shorten the title (or add a live counter —
  optional polish).
- **F8 · P4** — raw shell carries no `og:url`/`og:locale` (baseline
  `frontend/index.html` never had them; the rewriter is
  insert-nothing by design — app.ts:997). Runtime MetaTags adds both
  post-hydration (MetaTags.tsx:199) and the unfurler card carries
  og:url; canonical covers consolidation for non-rendering engines.
- **F9 · P4** — `.hermes.md` develop-filter removal "queued for a
  config-touching round" since R119, still queued at R134
  (ci.yml:5,7). Claim itself accurate; the queue never executed.
- **F10 · P4** — `docs/deployment/FINAL_PRODUCTION_ENV.md`
  `VITE_GSC_VERIFICATION` row says "unset = no tag"; the plugin emits
  an EMPTY tag when unset (live + index.html:19-23 comment).
- **F11 · INFO** — sitemap lists all 45 active products including the
  44 unavailable (no stock filter, seo.ts:214-222). By design; PDPs
  assert OutOfStock honestly (LD pinned by tests); pages stay
  indexable for restock. Not a defect; recorded because the brief
  asked.
- **F12 · P4** — runbook §14 header parenthetical "(R122 status;
  R123/R124 additions below)" stale — the section now also carries
  R130 entries.
- **F13 · P4** — `OPERATOR_ACTIONS_R118.md` status header says
  "4–7, 9–10 still open" while the docs/README row for the same file
  says "4–12 open" — two adjacent docs disagree on the open-set
  notation (the table itself adds #11–12, so the header is the stale
  side).

**No P0, no P1, no P2.** (P0 = crawlable surface serving
wrong-indexable content/noindex catastrophe; P1 = broken meta on a
money surface; P2 = honesty/truth defect — none found: every money
surface's meta is real and DB/code-truthful, availability LD is
honest, canonicals all self/apex.)

## Verified-good register (no action)

Home/category/product/flash-sales/support/terms shells all correct
live · numeric-id → slug canonical · trailing-slash normalization ·
noindex families + canonical strip · dead-slug real 404 · robots.txt
coherent + sitemap pointer · sitemap 56 URLs well-formed, no dupes,
lastmod policy live, hreflang ar + x-default · www→apex 301 single
hop query-preserved · http→https 301 both hosts · share card DB-backed
for unfurlers, SPA for indexers (bot split live) · rewriter boot
guard + comment-blind surgery + parity pins (category/home/route
tests present in tree) · JSON-LD builders honest (availability,
seller-brand, sku, absolute images) · docs census 50/50 · CHANGELOG
R132/R133 = git log · vercel/render retirement claim true · inventory
+ whatsapp ops docs current · WWW_TO_APEX_301.md matches live.

Known-accepted (documented elsewhere, not re-reported): `/index.html`
direct hit serves unrewritten baseline (A11-F6, app.ts:1569-1570);
`/sw.js.map` soft-200 (A5-F6); Cloudflare DNS-only (operator O1);
TTFB tail = network RTT (R132 L4-F6); inventory loading (operator);
the 4 slug re-keys (operator curation, CHANGELOG R132 L4-F1).
