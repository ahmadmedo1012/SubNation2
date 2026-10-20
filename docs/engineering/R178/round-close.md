# R178 — The theme-adaptive transparent art round — 2026-10-21

**Scope:** the owner's directive — «الصور لو كان شعارات بدون خلفية بيضاء ستكون افضل واجمل وارقى بحيث تتغير الخلفية مع تغيير الثيم للفاتح او الابيض هكذا سيكون مشروع مثالي. افحص وابحث وقارن واصلح وحسن» — logos **without the baked white ground**, the background following the theme. The R176 family put every real logo on one of two static grounds (pearl for dark marks, charcoal for white ones); on the dark theme those pearl tiles read as foreign white squares inside the theme-aware `bg-muted/60` wells. R178 deletes the baked ground from the human-facing family entirely: **the well IS the ground now**, and it follows the dark/light theme exactly. The pre-flight audit also caught **three defective R176 tiles live in production** (below), all closed this round.

## The two-family contract

- **`/products/<slug>.webp` — TRANSPARENT (RGBA, 1024²):** every UI surface (the 15 `productArtUrl` render sites) now draws the real logo over its theme-aware well. No pearl, no charcoal, no glow — the brand mark and the theme do the work.
- **`/products-og/<slug>.webp` — OPAQUE (RGB, 1024²):** the bot family. og:image / Product-LD / the WhatsApp share card keep the pearl/charcoal grounds because scrapers composite transparent art on unpredictable backgrounds — a white wordmark on WhatsApp's light preview would vanish. Both families ship the same 45 slugs; the two sides tell the same versioned story (`?v=r178`).
- Frontend: `productArtUrl` unchanged (UI family), **`productOgUrl` added** for MetaTags + seo-builders' Product-LD. Backend: `absolutizeProductArt` rewrites `/products/` → `/products-og/` for the crawler shell + unfurler card. The `/products-og/` directory joins the 30d+SWR cache-header family (one line in spa-shell's static predicate).

## The polarity block (no wordmark drowns)

Transparent art has one law to preserve: legibility on BOTH grounds. Measured per-asset over the final tiles (the pipeline's `polarity.json` — ink **28** / paper **3** / auto **14** = 45):

- **ink** (median content luminance ≤ 0.42): the dark wordmarks (HBO Max, Apple TV+, TIDAL, Disney+, FOX, Netflix-red…) would drown on the dark theme's well → `invert(1) hue-rotate(180deg)` **on the dark theme only** (`:root:not(.light)` + attribute selectors on the unversioned path — immune to `?v=` bumps). The flip is the standard single-file dark-mode technique: luminance inverts, hues survive — Apple TV+'s black wordmark renders its official white dark-variant, no second asset shipped.
- **paper** (lum ≥ 0.72, low saturation — IDAGIO's forced-white, Pandora, Lifetime): the same flip **on the light theme only** (`.light`).
- **auto** (the mid-band: Spotify green, Hulu green, SoundCloud orange, YouTube red…): no filter, reads on both.
- The `filter` chain re-declares the grounding (`drop-shadow(0 4px 4px / 15%)` — the theme's real `--drop-shadow-lg`) because `filter` is atomic: the rules outrank the utility class, so the grounding rides inside the chain instead of dying with it. Computed-style proof captured (below).

## The three R176 defect fixes (the visual audit the round opened with)

A VLM pass over the deployed tiles — the «افحص وابحث وقارن» the directive demanded — caught what the R176 deterministic QA could not:

- **`fox-now` shipped a blank white rectangle** (the fetched source was a white-on-white mask; R176's own fetch spec wanted the Fox wordmark). Re-sourced from the official **Fox Broadcasting Company 2019 logo** (commons `c/c0`, thumb.wikimedia raster — VLM-verified clean wordmark, black → ink polarity).
- **`soundcloud-go-plus` shipped a faint gray circle** (a placeholder-looking source). Re-sourced from the official **SoundCloud logo** (commons `7/78`, VLM-verified orange lockup → auto polarity).
- **`sophia-ai` shipped its black favicon plate as a square** on the pearl ground. The plate is now luminance-keyed (the cyan mark survives, the plate drops).

## Retired: the A1-F4 white-sheen reconciliation layer

ProductCard's `from-white/[0.06]` top-gradient existed to unify the mixed white-plate/transparent asset population (R120-B1: «~7/12 catalog assets are pure-white-background squares»). With the whole catalog transparent there is nothing left to reconcile — the layer died with its reason (test re-pinned with the R178 rationale; the shine-trigger sweep stays on its own merit). Every product-image well across all 15 render sites was audited: **all already ride theme-aware `bg-muted/*`** — zero hard-coded whites to fix in the containers.

## Evidence

- **Computed-style proof (real DOM, built dist, Playwright):** `[dark] netflix → invert(1) hue-rotate(180deg) drop-shadow(0 4px 4px / .15)`; `[dark] spotify/auto → plain shadow`; `[light] pandora+idagio/paper → the flip`; `[light] netflix/ink → plain`. All four quadrants exact. (The QA harness blocks the service worker — Playwright's `page.route` cannot intercept SW-context fetches, the one wrinkle that initially fed the PDP production data through the SW's network path instead of the mocks.)
- **VLM adjudication on the four screenshots** (`docs/engineering/R178/screenshots/`): dark — «logos blend seamlessly, no white square boxes, white/light text, excellent readability»; light — «integrate perfectly with the background»; PDP — «the red Netflix wordmark on the gradient, no white box».
- **Weight:** UI family 869 KB / avg 19.3 KB per tile (alpha roughly doubles the byte cost — acceptable at lazy 4-8 images per view); OG family 433 KB / avg 9.6 KB (R176 parity), bot-only traffic. No adaptive q74 fallbacks needed; no weak-alpha tiles (<10% transparent): none.

## Gates (all green, on the round's tree)

lint 0/0 · typecheck ×3 · **backend 2,689 tests / 289 files** (4 sequential chunks on the 2-CPU box — the exact R177 baseline, tree unchanged this side) · **frontend 2,787 / 300** (full-suite single run + chunk re-verification; baseline 2,775 + 12 new polarity/OG-contract tests) · OpenAPI parity 87 / error-codes 50 / header params 7 (green) · production build green — **eager 149,440 B gz** (+328 B vs R177's 149,112, budget 150 KiB holds: the CSS block's cost) · 9 test-literal re-pins with in-line R178 rationale (backend og:image → products-og ×2, frontend og/LD ×3, boot warmup version ×6 → r178, the A1-F4 retirement).

## Ship record (the sequencing law)

- Commit `b2722f27` pushed to `main`; CI run **39508985112 — conclusion: success on every executed job** (path filter cost gate, gitleaks, lint/typecheck/drift, scripts, frontend, backend, production build; e2e + CVE scan path-filter-skipped for the round's file set — the cost gate's designed behavior, same as R177).
- The `?v=r178` bump rotates every human surface (HTTP 30d + SW CacheFirst are both URL-keyed) on Coolify's push-to-deploy; bot surfaces switch to the `/products-og/` URLs from the shell re-render on the same deploy.

## Standing items (unchanged)

- Embrionic API stays deferred by owner order; the DB's `image_url` paths never changed, so a future real-source refresh rides the same `?v=` bump contract.
- Live (production) verification of the theme flip is browser-side CSS on cached art — the `?v=r178` bump rotates every human surface on deploy; bot surfaces pick up `/products-og/` URLs from the shell re-render on the same deploy.
