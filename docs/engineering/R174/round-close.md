# R174 — Round close: the product-art excellence round (45 regenerated tiles + the freshness contract)

**Date:** 2026-10-20 · **Head before:** `cd1831e3` (R173 close) · **Class:** asset excellence + render-contract round
**Scope:** the owner directive «اكمل ماتبقى وبخصوص المنتجات … تحسين صور المنتجات لتكون أعلى دقة وأحدث وأنظف وأسرع في الظهور وايضا بدون كتابة السعر على الصورة لأن هذا غير منطقي. استبدل الصور الحالية للمنتجات بصور لكل منتج بشكل منظم ومثالي واستمر في التحسين والتطوير» — finish what remains, then the product-image excellence lane: every tile higher-resolution, newer, cleaner, faster to appear, with NO price text baked into the art (illogical — the price already renders as live HTML beside it), replaced per-product in an organized, consistent family.

## 1. The diagnosis (why the art had to be regenerated)

The live catalog's 45 `/products/*.webp` tiles were **scraped third-party reseller art**, not a designed set. VLM inspection of the four heaviest offenders (the round's opening probe):

| Tile | What was actually on it |
|---|---|
| `cpanel.webp` | «$4.99/MO» price text + «Also Available 1YEAR / 2YEAR / LIFETIME» promo copy + «VERIFIED & LICENSED BY AccountBot.net» third-party watermark |
| `chatgpt-plus.webp` | «www.Accountbot.net» watermark — a competitor reseller's branding on our store's art |
| `netflix.webp` | official logo but 450×450, letterboxed RGBA, on whatever backdrop the source happened to ship |
| `disney-plus.webp` | official logo on a plain white tile — visually orphaned inside the dark-themed card well |

Every tile was 450×450 (the R132 L4-F9 census), mixed RGB/RGBA, mixed backgrounds, mixed provenance — a scraped collage. The price-on-image problem the owner flagged was real and structural: the art was never authored for this store.

## 2. The regeneration (45 tiles, one designed family)

**Design family (consistency contract):** deep charcoal-black studio backdrop + a soft radial glow in each brand's signature color; one centered glossy 3D emblem; generous margins; strictly no prices, no currency, no promo text, no watermarks, no URLs. Text appears ONLY where the brand's own short wordmark IS the mark (NETFLIX, hulu, SHOWTIME, cPanel…); every other tile is pure emblem.

**Pipeline** (`scripts/r174-product-art/`, kept as the recoverable artifacts):
1. `manifest.mjs` — the 45 live slugs (asserted == the live file set == the live catalog's `image_url` values, verified against `https://subnation.ly/api/products?limit=100`) each with a brand-specific prompt built from one template.
2. `generate.mjs` — resumable generation (staged PNGs, per-slug retry, time-budgeted batches), 1024×1024.
3. `validate.mjs` — **VLM QA on every tile**: no banned text (price/currency/promo/watermark/URL), wordmark spelled exactly, brand identifiable, composition clean. Failures regenerated with hardened prompts.
4. `encode.py` — WebP q80 method 6 → `frontend/public/products/*.webp`, with a full backup of the previous art (`backup-r173-art/`).

**The QA loop, honestly:** first pass 30/45 strict; second pass 43/45; final 45/45 where **42 are strict VLM passes** and three are documented acceptances: `tidal` + `chatgpt-plus` (abstract brand marks the describe-pass confirmed — Tidal's diamond cluster, the OpenAI knot — the brand-name gate cannot name abstract geometry on its own) and `skillshare` (a stacked two-line wordmark, correctly spelled, after 3 one-line attempts). One content-filter refusal (`expressvpn` brand name) reworded and passed. Two prompt iterations killed stray text the model wanted to add («AI», «Hallmark MOVIES NOW», «Pandora Premium», a misspelled «SuundCloud Go+»).

**The result, measured:** all 45 files 1024×1024 WEBP; total art weight 541,496 B → 1,252,176 B (avg **27.8 KB/tile**, max 65 KB) — 2.27× the linear resolution at ~2.3× the weight, still far under any image-budget concern for flat premium art.

## 3. The freshness contract (the real engineering of this round)

**The trap:** `/products/*.webp` is served with `Cache-Control: max-age=2592000, stale-while-revalidate=86400` (spa-shell A11-F2/R104 AG11-2b) AND runtime-cached by the service worker's **CacheFirst image rule (30 days)** — both keyed by URL. Replacing the files under the same slug names (the DB's `image_url` never changes) means every returning visitor keeps the OLD art for up to a month. The owner would look at the deployed site and see nothing changed.

**The fix — a versioned art URL at every surface:**
- `frontend/src/lib/product-art.ts` (NEW): `PRODUCT_ART_VERSION = "r174"` + `productArtUrl()` — appends `?v=r174` to any `/products/` URL (site-relative or absolutized), passes everything else through.
- **13 frontend call sites** wired: ProductCard, ProductMediaSection (PDP), cart, flash-sales, order-detail, ShelfRail, RecentOrdersStrip, OrderRow, CartSummaryAside, RecommendationsSection, admin ProductCard + ProductEditorCard preview, admin GlobalSearch + StockoutRiskPanel thumbs — and critically **`bootCardImageWarmUrls`** (the R127-L10 LCP warming: an unversioned warm would fetch a cache entry the rendered `<img>` never reads — a double download).
- **`components/seo/MetaTags.tsx` + `lib/seo-builders.ts`**: the hydrated page's og:image and Product-LD image now carry the same `?v=`.
- **backend `lib/product-art-version.ts`** (NEW, the R163 size-gate carve): `absolutizeProductArt()` — the crawler shell's og:image/Product-LD and the unfurler share card append the same version. `spa-shell.ts` actually SHRANK (1,039 → 1,035 — the two ogImage constructions collapsed to one-liners).
- **Intrinsic dims made honest:** every `width/height={450}` → `{1024}` (the R132 L4-F9 honest-intrinsic rule, re-censed; the R-140-a no-srcset decision re-verified — still exactly one rendition per asset).
- **Test pins updated with the round's rationale:** image-discipline-r140 (the census), orders-decomposition-r167, boot-card-image-warmup (now pins the versioned warm set), jsonld-completeness-r140, meta-quality-r140, backend spa-shell-rewrite (og:image + LD `?v=r174`), and a NEW `product-art.test.ts` (4 tests — the versioner's contract, per the ponytail one-small-test rule).

**Version-sync rule:** the frontend constant and the backend constant MUST move together (each side's tests pin its own `r174`); drift degrades to mismatched query strings, never breakage — but bump both or neither.

## 4. What was left standing from R173 (the honest record)

- The four age-gated dependency candidates (motion 14.4.0, react-query 5.104.5, typescript-eslint 8.72.0, impeccable 4.7.0) re-checked at round time: **still inside the 24h `minimumReleaseAge 1440` window** (7.3–14.6h old at 2026-10-20 ~00:00 UTC) — the policy holds, they age in tomorrow. No dep files touched this round.
- The Embronic integration: the owner confirmed «سنقوم بربط embronic api» — the prepared boundary (`docs/pending/embronic-adapter-design.md`) stands ready; it remains blocked on the official API documentation + credentials (owner-side), per the no-invention rule. Nothing fabricated.

## 5. Gates on the round's tree (all from scratch)

| Gate | Result |
|---|---|
| typecheck | clean ×4 (libs build, backend, frontend, scripts) |
| lint | 0 errors / 0 warnings |
| backend suite | **2,677 green** (4 chunks: 950 + 747 + 369 + 611 — exact R173 baseline) |
| frontend suite | **2,766 green** (2,762 baseline + 4 new product-art tests) |
| scripts suite | 59 green |
| build | green — eager **149,049 B gz** (budget 150 KiB warn; +65 B vs R173's 148,984 — the helper, no budget regression) |
| parity gates | openapi **87 ops** / error-codes **50** / header-params **7/7** |
| drift gates | drizzle: zero diff · orval: zero diff |
| size gate | spa-shell.ts 1,035 ≤ 1,039 (the growth-banned pin — the carve kept it under) |
| dist verification | `dist/public/products/` = 45 files, all 1024×1024 WEBP (PIL-verified) |

## 6. Ship record

(filled at close: push → CI → docker dispatch → production verification, per the R171 sequencing law)

## 7. Standing for the next round

- The aged-in candidates (motion 14.4.0, react-query 5.104.5, typescript-eslint 8.72.0, impeccable 4.7.0) will be > 24h old — take them with the R172/R173 verification discipline.
- If the art is ever regenerated again: replace the files, bump BOTH `PRODUCT_ART_VERSION` constants (frontend `lib/product-art.ts` + backend `lib/product-art-version.ts`), update the pinning tests (`?v=` literals), and re-run this round's QA pipeline (the `scripts/r174-product-art/` set is the reusable artifact).
- The owner-side catalog/business actions (the R168 24+12 lists) remain owner-gated.
- Embronic: awaiting official docs + credentials; the adapter design + contract-test plan are pre-written.
