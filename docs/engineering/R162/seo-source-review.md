# R162-B — SEO source integrity & truthful structured data

Date: 2026-10-17 (live probes 20:30–20:48 UTC). Lane B of R162.
Owner: this report. Evidence cache: `/tmp/r162-b-evidence/` (45
`by-slug-*.json` API responses, 5 crawler shells, 5 rendered-LD
captures, the replication scripts).

## Scope & method

The real importer (`scripts/src/import-seo.ts`) needs `DATABASE_URL`
(never available locally) and production DB writes are not authorized —
so this lane REPLICATED the importer's join + keep/write logic against
the **live catalog via the public API** (GET-only):

1. `GET https://subnation.ly/api/products` → all 45 live products
   (id, slug, name, category, is_active, price, is_available…).
2. `GET https://subnation.ly/api/products/by-slug/<slug>` × 45 →
   `seo_title`, `seo_description`, `description_long`, `faq`
   (the exact fields the importer's keep/write logic checks).
3. `scripts/src/import-seo.ts` read in full; the join semantics
   (slug normalized `trim().toLowerCase()`; exact `product_name` `eq`;
   `or(...).limit(1)` with **no** ordering) replicated per entry.

**Replication limits (honesty):** the public API does not expose
`is_archived` and (presumably) hides archived rows — 45 JSON entries
resolve against 45 publicly-visible active rows, so the
"missing vs archived" split for *hidden* rows cannot be certified from
outside. The 11 id gaps in the live listing (5–9, 11–16, 18–23) suggest
archived/deleted rows exist; if any hidden row duplicated a JSON
`product_name`, the OLD `or()` join could nondeterministically target it
and classify the entry "archived" (skip). The R162-B fix (below) makes
that resolution deterministic (lowest id among exact-name matches), but
"lowest id is the intended product" remains an assumption only the DB
can verify — flagged for the operator, not assumed.

## Dry-run replication (all 45 entries, 2026-10-17)

Counts: **45 matched / 0 missing / 0 archived-or-inactive**. Resolution:
**41 by slug, 4 by exact-name fallback**. Field keep/write: **all 45
rows keep all four fields** (`description_long`, `faq`, `seo_title`,
`seo_description` are all non-empty live) → a plain `--apply` today
would write **nothing** ("✅ Nothing to write.") — the
keep-unless-force rule fully protects the operator's R132 curation.

| # | JSON slug | JSON product_name | resolution | live row (id · slug · name) | class | kept/written (desc·faq·title·meta) | `--force` would change |
|---|-----------|-------------------|------------|------------------------------|-------|-----------------------------------|---------------------|
| 0 | `netflix` ⚠️ | Netflix | name-fallback | 1 · `netflix-premium` · "Netflix" | update | all four kept | 4/4 fields |
| 1 | `spotify-premium` | Spotify | slug | 2 · `spotify-premium` · "Spotify Premium" | update | all four kept | 4/4 fields |
| 2 | `disney-plus` ⚠️ | Disney+ | name-fallback | 3 · `disney-standard` · "Disney+" | update | all four kept | 4/4 fields |
| 3 | `prime-video` ⚠️ | Prime Video | name-fallback | 17 · `amazon-prime-video` · "Prime Video" | update | all four kept | 4/4 fields |
| 4 | `youtube-premium` | YouTube Premium | slug | 4 · `youtube-premium` · "YouTube Premium" | update | all four kept | 4/4 fields |
| 5 | `apple-tv-plus` ⚠️ | Apple TV+ | name-fallback | 10 · `apple-tv` · "Apple TV+" | update | all four kept | 4/4 fields |
| 6 | `hbo-max` | HBO Max | slug | 25 · `hbo-max` · "HBO Max" | update | all four kept | 4/4 fields |
| 7 | `hulu` | Hulu | slug | 26 · `hulu` · "Hulu" | update | all four kept | 4/4 fields |
| 8 | `osn-plus` | OSN+ | slug | 24 · `osn-plus` · "OSN+" | update | all four kept | 4/4 fields |
| 9 | `paramount-plus` | Paramount+ | slug | 27 · `paramount-plus` · "Paramount+" | update | all four kept | 4/4 fields |
| 10 | `showtime` | Showtime | slug | 28 · `showtime` · "Showtime" | update | all four kept | 4/4 fields |
| 11 | `amc-plus` | AMC+ | slug | 29 · `amc-plus` · "AMC+" | update | all four kept | 4/4 fields |
| 12 | `sling-tv` | Sling TV | slug | 30 · `sling-tv` · "Sling TV" | update | all four kept | 4/4 fields |
| 13 | `directv-stream` | DirecTV Stream | slug | 31 · `directv-stream` · "DirecTV Stream" | update | all four kept | 4/4 fields |
| 14 | `fox-now` | Fox Now | slug | 32 · `fox-now` · "Fox Now" | update | all four kept | 4/4 fields |
| 15 | `funimation` | Funimation | slug | 33 · `funimation` · "Funimation" | update | all four kept | 4/4 fields |
| 16 | `hallmark-movies-now` | Hallmark Movies Now | slug | 34 · `hallmark-movies-now` · "Hallmark Movies Now" | update | all four kept | 4/4 fields |
| 17 | `shudder` | Shudder | slug | 35 · `shudder` · "Shudder" | update | all four kept | 4/4 fields |
| 18 | `tidal` | Tidal | slug | 36 · `tidal` · "Tidal" | update | all four kept | 4/4 fields |
| 19 | `soundcloud-go-plus` | SoundCloud Go+ | slug | 37 · `soundcloud-go-plus` · "SoundCloud Go+" | update | all four kept | 4/4 fields |
| 20 | `pandora-premium` | Pandora Premium | slug | 38 · `pandora-premium` · "Pandora Premium" | update | all four kept | 4/4 fields |
| 21 | `napster` | Napster | slug | 39 · `napster` · "Napster" | update | all four kept | 4/4 fields |
| 22 | `qobuz` | Qobuz | slug | 40 · `qobuz` · "Qobuz" | update | all four kept | 4/4 fields |
| 23 | `idagio` | IDAGIO | slug | 41 · `idagio` · "IDAGIO" | update | all four kept | 4/4 fields |
| 24 | `tunein-premium` | TuneIn Premium | slug | 42 · `tunein-premium` · "TuneIn Premium" | update | all four kept | 4/4 fields |
| 25 | `headspace` | Headspace | slug | 43 · `headspace` · "Headspace" | update | all four kept | 4/4 fields |
| 26 | `brain-fm-pro` | Brain.fm Pro | slug | 44 · `brain-fm-pro` · "Brain.fm Pro" | update | all four kept | 4/4 fields |
| 27 | `ultimate-guitar-pro` | UltimateGuitar Pro | slug | 45 · `ultimate-guitar-pro` · "UltimateGuitar Pro" | update | all four kept | 4/4 fields |
| 28 | `expressvpn` | ExpressVPN | slug | 46 · `expressvpn` · "ExpressVPN" | update | all four kept | 4/4 fields |
| 29 | `cyberghost-vpn` | CyberGhost VPN | slug | 47 · `cyberghost-vpn` · "CyberGhost VPN" | update | all four kept | 4/4 fields |
| 30 | `ipvanish` | IPVanish VPN | slug | 48 · `ipvanish` · "IPVanish VPN" | update | all four kept | 4/4 fields |
| 31 | `hma-vpn-pro` | HMA VPN Pro | slug | 49 · `hma-vpn-pro` · "HMA VPN Pro" | update | all four kept | 4/4 fields |
| 32 | `chatgpt-plus` | ChatGPT Plus | slug | 50 · `chatgpt-plus` · "ChatGPT Plus" | update | all four kept | 4/4 fields |
| 33 | `sophia-ai` | Shopia AI | slug | 51 · `sophia-ai` · "Shopia AI" | update | all four kept | 4/4 fields |
| 34 | `ahrefs` | Ahrefs | slug | 52 · `ahrefs` · "Ahrefs" | update | all four kept | 4/4 fields |
| 35 | `semrush-classic` | Semrush Classic | slug | 53 · `semrush-classic` · "Semrush Classic" | update | all four kept | 4/4 fields |
| 36 | `skillshare` | Skillshare | slug | 54 · `skillshare` · "Skillshare" | update | all four kept | 4/4 fields |
| 37 | `scribd` | Scribd | slug | 55 · `scribd` · "Scribd" | update | all four kept | 4/4 fields |
| 38 | `windows-10-pro` | Windows 10 Pro | slug | 56 · `windows-10-pro` · "Windows 10 Pro" | update | all four kept | 4/4 fields |
| 39 | `windows-10-home` | Windows 10 Home | slug | 57 · `windows-10-home` · "Windows 10 Home" | update | all four kept | 4/4 fields |
| 40 | `windows-8` | Windows 8 | slug | 58 · `windows-8` · "Windows 8" | update | all four kept | 4/4 fields |
| 41 | `winrar-lifetime` | WinRAR Lifetime | slug | 59 · `winrar-lifetime` · "WinRAR Lifetime" | update | all four kept | 4/4 fields |
| 42 | `grammarly-pro` | Grammarly Pro | slug | 60 · `grammarly-pro` · "Grammarly Pro" | update | all four kept | 4/4 fields |
| 43 | `cpanel` | cPanel | slug | 61 · `cpanel` · "cPanel" | update | all four kept | 4/4 fields |
| 44 | `lifetime-cloud-storage` | Lifetime Cloud Storage | slug | 62 · `lifetime-cloud-storage` · "Lifetime Cloud Storage" | update | all four kept | 4/4 fields |

Secondary census (whole file, whole catalog):

- **Category drift: 0** — every JSON `category` equals the live row's
  category (the R161-C taxonomy rename is already reflected in the
  rendering layer, not the DB `category` slugs, so no drift was
  expected and none was found).
- **Duplicate JSON `product_name`: 0. Duplicate JSON `slug`: 0.** The
  45 entries map 1:1 onto the 45 live rows — **no last-write-wins
  collision exists** inside the single transaction.
- **Duplicate live slugs: 0** (enforced by `idx_products_slug_unique`)
  **· duplicate live names: 0** (no unique constraint, but the current
  catalog has none).

## The 5 known drifts → resolution verdicts

All five resolve to the **intended** product today:

1. **`netflix` → live id 1 `netflix-premium`** (via exact-name fallback
   "Netflix" — no live row has slug `netflix`). Intended-target
   evidence: JSON primary keyword «اشتراك نتفلكس بريميوم» + «نتفلكس 4K»
   semantics vs the live row's name "Netflix", category `streaming`, and
   live content «…بجودة 4K — باقات من شهر إلى سنة».
2. **`disney-plus` → live id 3 `disney-standard`** (name fallback
   "Disney+"). Intended: JSON keywords اشتراك ديزني بلس / ماربل / ستار
   وورز vs live «عالم ديزني ومارفل وستار وورز…».
3. **`prime-video` → live id 17 `amazon-prime-video`** (name fallback
   "Prime Video"). Intended: JSON «اشتراك أمازون برايم فيديو…» vs live
   «Amazon Prime Video بآلاف الأفلام…».
4. **`apple-tv-plus` → live id 10 `apple-tv`** (name fallback
   "Apple TV+"). Intended: JSON «مسلسلات Apple Originals… Ted Lasso
   وSeverance» vs live «Apple TV+ بإنتاجات أصلية حائزة على جوائز…4K HDR».
5. **`spotify-premium` → live id 2 `spotify-premium`** (slug match —
   the slug is identical despite the R132 re-keys; the *name* drift
   "Spotify" vs live "Spotify Premium" is inert for the join: no live
   row is named "Spotify", so neither the old `or()` nor the fixed
   join can mis-resolve it).

**Drift risk class:** all four slug drifts resolve via a fragile
mechanism — the exact-name fallback only works because the live rows
kept their marketing names through the R132 slug re-keys. Any future
name curation (e.g., renaming "Netflix" → "Netflix Premium" to match its
slug) would push those 4 entries from "update" to "missing" (SKIP, with
the 110-F warning) — the importer degrades safely and loudly, never
writes to the wrong product, but the file drifts further out of sync.

## or() ambiguity analysis + the deterministic fix

The old join was a single query:

```ts
.where(or(slug ? eq(productsTable.slug, slug) : undefined,
          eq(productsTable.name, entry.product_name)))
.limit(1)   // ← no ORDER BY
```

- **Live-data instances today: 0.** For every one of the 45 entries the
  `or()` predicate matches exactly one row (slug unique; no duplicate
  live names; no entry's slug-row ≠ name-row). The census found no
  slug-vs-name cross-collision and no same-name pair.
- **The defect is real and dormant, not hypothetical:** the header
  documented "Matches each entry by `slug` first … falling back to an
  exact `product_name` match", but `or(...).limit(1)` without ordering
  implements NO priority — Postgres returns an arbitrary row whenever
  both arms match different rows (`name` has no unique constraint, so
  the name arm alone can also multi-match). 4 of 45 entries (8.9%)
  already ride the name arm today; one catalog edit away from a
  collision (e.g., re-adding a row with slug `netflix`, or a duplicate
  name after a marketing rename), which product an entry updates — or
  whether it's skipped as "archived" — becomes scan-order-dependent.
  This is exactly the class the importer's own safety notes rely on
  being deterministic.

**Fix landed (repo-owned, no behavior change on today's data):**
`scripts/src/import-seo.ts` now resolves each entry through
`scripts/src/seo-join.ts` (`resolveSeoTarget`):

1. slug lookup first (`products.slug` is unique — at most one row);
2. exact-`product_name` lookup **only when the slug matched nothing**,
   ordered by `id` so duplicate names resolve deterministically
   (lowest id wins).

Documented behavior preserved (slug-first + exact-name fallback +
skip-when-neither), ambiguity removed, no importer execution needed for
the change itself. Pinned by **6 tests** in
`scripts/src/__tests__/seo-join.test.ts` (new vitest harness for the
scripts workspace: `scripts/vitest.config.ts` + `vitest` devDependency
linked from the existing store — see worklog). Run:
`pnpm --filter @workspace/scripts run test` → 6/6 green.
Note for the coordinator: CI's test jobs currently run only the
backend + frontend suites; wiring `@workspace/scripts` into the CI test
job is a `ci.yml` change (Lane C's file, coordinator's call).

## Future force-overwrite risk (the `--apply --force` census)

- **All 45 entries differ from the live rows on all four fields**
  (desc/faq/title/meta × 45 = 180 values). A hypothetical
  `--apply --force` would regress every one of them to the older JSON
  research copy.
- The live values are the NEWER operator truth (R132): **45/45 live
  `seo_title`s follow the «{Name} — اشتراك أصلي بالدينار الليبي |
  SubNation» pattern** (≤ 64 chars, well under the 200 column cap); live
  `seo_description`s ≤ 86 chars (cap 320). The JSON holds the older
  pre-R132 copy (keyword-stuffed titles like «اشتراك نتفلكس بريميوم 4K
  — تسليم فوري في ليبيا | SubNation», descriptions up to 131 chars,
  `description_long` 1,619–1,803 chars vs live 253–391).
- Both sides fit the admin zod caps (200/320), so a force run would not
  fail validation — it would simply overwrite curated copy with stale
  copy. The importer's R132 header note ("Refresh the JSON against the
  live catalog … before any --force run") remains the governing rule.

## JSON-LD truthfulness spot-check (5 live PDPs)

Method: `GET /api/products/by-slug/<slug>` (the same DTO the page
hydrates from) vs (a) the crawler shell (`curl -A Googlebot
/product/<slug>`), (b) the unfurler OG card (`curl -A WhatsApp`), and
(c) the **rendered** `application/ld+json` blocks extracted from the
live SPA in a real browser (agent-browser session r162b).

Products: `netflix-premium`, `disney-standard`, `spotify-premium`,
`expressvpn`, `chatgpt-plus` (4 drifted/re-keyed flagships + 1 clean
slug-match; live state during the probe: all 45 products
`is_available=false`, price 79.8 except chatgpt-plus 99.8).

**Crawler shell (8 fields × 5 products = 40/40 PASS):** `<title>` ==
live `seo_title` byte-exact (all ≤ 60 chars so the clamp is identity),
`meta description` == `seo_description.slice(0,160)`, canonical ==
`https://subnation.ly/product/<live-slug>`, `og:url` == canonical,
`og:type` == `product`, `og:title`/`og:description` == title/desc,
`robots` == `index,follow`. (Bonus probe: all four drifted JSON slugs
404 as live URLs — `/product/netflix`, `/product/disney-plus`,
`/product/prime-video`, `/product/apple-tv-plus` each returned HTTP 404
to a Googlebot UA — the JSON's `slug` fields are stale URL identities;
only the `product_name`s keep the importer targeting the right rows.)

**Unfurler OG card (netflix-premium, bonus):** title == live
`seo_title`; description == `seo_description` + «— السعر 79.80 د.ل»
(matches `buildShareDescription` with the live display price);
`og:url` == canonical.

**Rendered JSON-LD (15 checks × 5 products = 75/75 PASS):** each PDP
emits exactly 3 blocks — `Product` + `BreadcrumbList` + `FAQPage`:
- `@id`/`url` == `https://subnation.ly/product/<live-slug>` (slug-based,
  matches the shell canonical — no split identity signal);
- `name` == live name; `description` == live `description_long`
  (sliced 5000); `sku` == `subnation-<slug>`; `brand` == SubNation
  (the seller — the honest A7-F11 decision);
- `category` == `utils.categoryLabel` (streaming → «منصات المشاهدة»,
  music → «موسيقى وصوتيات», vpn → «شبكات VPN», ai-tools → «أدوات ذكاء
  اصطناعي» — the R161-C taxonomy live in structured data);
- `offers.price` == live price rendered 2-dp ("79.80" / "99.80"),
  `priceCurrency` == "LYD", `priceValidUntil` == `<next-year>-12-31`,
  `itemCondition` == NewCondition;
- **`offers.availability` == `https://schema.org/OutOfStock` on all 5**
  — the whole live catalog currently has zero deliverable stock and the
  structured data says so truthfully (the D2-F2 honesty contract holds
  in production); no page asserted InStock against a «نفد المخزون» UI;
- BreadcrumbList's last crumb == this product at its slug URL;
  FAQPage's `mainEntity` count == the live `faq` array length;
- **no `aggregateRating`/`reviewCount` anywhere** (the no-fabricated-
  social-proof pin holds in the wild).

No capability was fabricated: every claim above is backed by a cached
probe artifact in `/tmp/r162-b-evidence/`.

## OWNER DECISION (operator calls — this lane did NOT touch
`docs/SEO_PRODUCTS.json`)

`docs/SEO_PRODUCTS.json` is an operator-import **snapshot**, and the
live DB is the newer truth (R132 L4-F1). Nothing in this round changed
its content; the only code change is the deterministic join. Decisions
on the table:

1. **Re-key the 4 drifted slugs** (`netflix`→`netflix-premium`,
   `disney-plus`→`disney-standard`, `prime-video`→`amazon-prime-video`,
   `apple-tv-plus`→`apple-tv`) so the file joins by slug again and
   stops depending on the exact-name fallback. Cost: none functionally
   (the fallback covers it); benefit: the file stops being fragile
   against the next name curation. **Recommended, cosmetic-only.**
2. **Fix the Spotify name drift** (`product_name` "Spotify" →
   "Spotify Premium") so the name-fallback would still resolve if the
   slug ever drifted. Cosmetic-only (slug match is direct today).
3. **Re-export the live rows into the JSON before ANY `--force` run**
   (the importer header's standing rule). A force run today would
   regress all 180 field values (4 × 45) from the curated R132 copy to
   the older research copy — see the force census above.
4. **Optional verification (DB read):** confirm no hidden archived row
   shares an exact name with a JSON entry (the one thing the public API
   cannot show). Expected outcome: none — the R132 curation re-keyed the
   four flagships in place (ids 1/3/10/17 hold the drifted slugs'
   products today).
5. **CI wiring decision (coordinator):** whether
   `pnpm --filter @workspace/scripts run test` joins the CI test job —
   it is a new 6-test suite in a workspace that had no test harness.

## Files changed by this lane

- `scripts/src/import-seo.ts` — deterministic slug-first join (two
  sequential queries via the new helper), docblock updated; keep/write,
  validation, transaction, CLI semantics untouched.
- `scripts/src/seo-join.ts` (NEW) — `resolveSeoTarget`, the pure
  join-sequencing helper + rationale.
- `scripts/src/__tests__/seo-join.test.ts` (NEW, 6 tests) — pins the
  priority/fallback/normalization/missing semantics.
- `scripts/vitest.config.ts` (NEW) — minimal node-env vitest harness for
  the scripts workspace (backend style).
- `scripts/package.json` — `vitest` devDependency (^4.1.11, same version
  as backend/frontend, linked from the existing store) + `test` script.
- `pnpm-lock.yaml` — the vitest importer entry for scripts (one new
  devDep link; no new packages, no version changes).
- `docs/engineering/R162/seo-source-review.md` (this file).

Verification: `pnpm --filter @workspace/scripts run test` → 6/6 green ·
`pnpm typecheck` (repo-wide incl. scripts) clean · `pnpm lint` 0 errors /
15 warnings (the documented baseline) · backend + frontend spot suites
re-run green after the lockfile re-resolution. **No importer execution,
no DB access, no production writes, GET-only probes.**
