# R176 — The real-source art round — 2026-10-20

**Scope:** the owner's clarifying directive — «انا كان هدفي صور من المصدر حقيقية مش صور تم انشاءها ب ai» — the goal was never AI-rendered scenes; it was the brands' **real artwork from the source**. R174/R175 replaced scraped-reseller art with AI-generated families; R176 replaces the AI families with the **official logos themselves**, presented in one designed, professional, elegant tile system. Zero AI generation. Full pipeline: `scripts/r176-real-art/`.

## What shipped

All 45 `/products/*.webp` tiles are now **the real official artwork of each brand**, composited onto one of two neutral grounds:

| Ground | For | Count |
|---|---|---|
| **Pearl** (white → #F4F5F8 vertical gradient, whisper of top-light glow) | dark/colored marks — Netflix red, Spotify green, Disney+ black, the Windows pane, WinRAR red… | 40 |
| **Charcoal** (#23242D → #17181F vertical gradient) | white/light marks — FOX white, Pandora white, SoundCloud white cloud, IDAGIO white, the cloud glyph | 5 |

Identical geometry everywhere: logo trimmed to its ink bounding box, centered, sized by aspect class (wide wordmarks ≤72% width, standard lockups ≤62% box, compact marks ≤46% box), generous margins ≥144px, LANCZOS resampling with a gentle unsharp pass for small sources. The two grounds carry the same geometry, margins and lighting so the grid reads as one family — the same mixed-neutral convention Apple's App Store uses for mixed light/dark app icons.

## The sources (the whole point)

- **43 of 45 from Wikipedia's logo files** — the human-curated official artwork (free files mirrored from Wikimedia Commons, non-free ones hosted locally as fair use), rendered from SVG masters at 1280px or standard-size PNG thumbs. Each pick is recorded in `scripts/r176-real-art/picks.json` with its exact file title — e.g. `Netflix 2015 logo.svg`, `Disney+ logo.svg`, `Windows 10 Logo.svg`, `AMC+ logo.png`, `Showtime.svg`, `Hallmark logo.svg`.
- **brain.fm from its own CDN** — `cdn.brain.fm/images/bfm-og-image.png` (the brand's own og:image; the site's favicon/og assets were parsed live).
- **HMA from its own CDN** — `static2.hidemyass.com/.../hma-vpn-logo.png` (400×400, white-plate keyed to transparency at composite time).
- **CyberGhost's official 192px app mark** from `assets.cyberghostvpn.com` (their ghost icon; the Wikipedia 120px wordmark was the fallback it replaced).
- **Shopia AI from Google's favicon cache** — shopia.io is parked (dead domain, JS redirect to `/lander`; Wayback unreachable from this network). `t3.gstatic.com/faviconV2` still serves the site's real captured favicon (180px) — the last living copy of the real mark, boxed down to 360px to keep the upscale graceful.

Special handling: IDAGIO's source is a white-on-black JPEG (no alpha) — luminance keyed to alpha, content forced white, composited on the charcoal ground. HMA's source is a dark-on-white plate — whiteness keyed to alpha the same way.

## The weight table (the fastest catalog yet)

The owner asked for «أسرع في الظهور» back in R174; real flat-art logos compress dramatically better than AI-rendered scenes:

| Round | Family | Total | Avg/tile | Max tile |
|---|---|---|---|---|
| R174 | AI: emblem on gradient, 1024² | ~1.25 MB | 27.8 KB | 65 KB |
| R175 | AI: cinematic showcase, 1024² | 2.40 MB | 53.3 KB | 95 KB |
| **R176** | **real logos, pearl/charcoal, 1024²** | **426 KB** | **9.5 KB** | **18 KB** |

5.6× lighter than R175 at the same resolution and the same 30d-cached/lazy-loaded delivery — every tile now arrives in a single small burst.

## The pipeline (committed, resumable)

`scripts/r176-real-art/` — six stages, all idempotent:

1. `fetch.mjs` — Wikipedia file-namespace search per brand with curated `want`/`avoid` term lists and a scoring picker (SVG bonus, resolution bonus, variant penalty); candidates cached per slug. **Engineering note:** Node's undici (HTTP/1.1) gets edge-throttled by Wikipedia while curl (HTTP/2) sails through — verified 5/5 200s vs 429/403s — so the fetcher shells out to curl.
2. `picks.json` — the human-curated final map (45 entries: source + exact file title).
3. `download.mjs` — one batched imageinfo query for all Wikipedia titles, then paced downloads. **Engineering note:** `thumb.wikimedia.org` only serves the standard widths (20/40/60/120/250/330/500/960/1280/1920/3840 — see mediawiki.org "Common thumbnail sizes"); small PNG originals ride the 500px/250px/120px thumbs. The 8 Wikipedia PNGs that only existed as originals on the rate-blocked `upload.wikimedia.org` were fetched via forced standard-size thumbs; 2 brands were additionally upgraded to their own CDNs (HMA, CyberGhost).
4. `analyze.py` — per-logo forensics (bbox, aspect, median luminance/saturation, dark/light fractions) → variant + box decisions (`decisions.json`), with documented manual overrides.
5. `tiles.py` — the compositor: gradients, glow, alpha-keying for dark-plate JPEGs and white-plate PNGs, LANCZOS + unsharp for small sources.
6. `encode.py` — WebP q82 (no tile needed the adaptive q74 downshift) + decode verification, deployed to `frontend/public/products/` with the r175 set backed up at `scripts/r175-product-art/backup-r175/`.
7. `qa.py` — offline geometric QA: 1024² asserted, ink coverage ≥0.5% of the central area, ink-vs-ground contrast ≥0.25, ink margins ≥92px scanned across the whole tile. **45/45 ALL CLEAR.**

## The freshness contract, re-run

`PRODUCT_ART_VERSION` r175 → r176 on both sides (`frontend/src/lib/product-art.ts`, `backend/src/lib/product-art-version.ts`) + the 11 test literals re-pinned across the four pinning suites (product-art, boot-card-image-warmup, meta-quality-r140, jsonld-completeness-r140 + backend spa-shell-rewrite). Boot image-warming, og:image, Product-LD, crawler shell and unfurler inherit automatically.

## Honest verification ledger

- The z-ai VLM window stayed hard-429 for the entire round (image-search, vision — both throttled; multiple spaced retries). **Visual VLM adjudication is deferred** — same standing pattern as R175's close (12 deferred verdicts there). What holds the line instead: (a) every source file is a *deterministic official artifact* — a Wikipedia file titled «Netflix 2015 logo.svg» renders the Netflix wordmark by construction, a categorically lower-risk verification problem than judging AI renders; (b) color forensics per logo (the dominant-color census confirms Hulu green #51ce98, ChatGPT petrol #74aa9c, HBO Max black, Scribd near-black…); (c) the geometric QA suite above; (d) 45/45 WebP decode-verified at 1024².
- `upload.wikimedia.org` originals for 6 small Wikipedia PNGs (amc-plus 887px, pandora 1097px, tunein 1280px, ipvanish 350px, cyberghost — superseded by the official CDN icon, winrar 500px) stayed 429-blocked at round close; the deployed tiles ride their standard-size thumbs with capped boxes + sharpening. Re-fetching the originals when the block clears is the one standing polish item (quality delta: mostly ≤1.25× sharper sources).
- `sophia-ai` (Shopia) is the one brand whose every official surface is dead (parked domain, no Wikipedia file, Wayback unreachable from this network). Google's favicon cache holds its real captured mark at 180px — used at a 360px box (2× upscale, favicon-class art holds well). If a better surface appears (brand relaunch, archive access), swap the `sophia-ai` entry in `picks.json` and re-run stages 3–6.

## Gates (every one at the exact R175 baseline)

lint 0/0 (the round's own .mjs pipeline included) · typecheck ×3 (backend, frontend, scripts) · backend **2,677 tests / 288 files** (exact baseline; run in 5 chunks on the 2-CPU box) · frontend **2,766 / 298** (exact; 3 chunks) · scripts 6/59 (exact) · build green, **eager 149,050 B gz** (−7 B vs R175, budget 150 KiB holds) · OpenAPI parity 87 implemented / 50 error codes / 7 header params / 7 escape-hatch (all green) · dist 45×1024² WebP PIL-verified · full r175 backup retained.

## The R176→ standing items

1. VLM adjudication when the z-ai quota window reopens (contact sheet at `scripts/r176-contact-sheet-final.png`; per-tile files under `frontend/public/products/`).
2. upload.wikimedia.org original re-fetch for the 6 small-source tiles when its 429 block clears.
3. Embronic remains deferred by owner order (untouched this round, as ordered).
