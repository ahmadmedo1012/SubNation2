// ── R174: product-art freshness (bot surfaces) ─────────────────────────────
// /products/*.webp rides max-age=30d + SWR HTTP caching AND the service
// worker's CacheFirst image rule — both keyed by URL. The R174 art
// regeneration replaced every tile under its SAME slug filename (the DB's
// image_url paths never change), so bot surfaces (the crawler shell's
// og:image/Product-LD and the unfurler share card) append this round's ?v=
// exactly like the frontend's productArtUrl does for humans (frontend/src/
// lib/product-art.ts — MUST stay in sync; each side's tests pin its own
// value). Bump ONLY when frontend/public/products/*.webp is replaced again.
// R176: the tiles are the brands' REAL official artwork now (Wikipedia logo
// files + brand CDNs; zero AI generation) — see scripts/r176-real-art/.
export const PRODUCT_ART_VERSION = "r176";

/** The share-surface image contract (A11-F3b/110-F lineage, now versioned):
 *  already-absolute URLs pass through untouched (future CDN hosts),
 *  site-relative /products/<slug>.webp absolutizes AND gains the art
 *  version. Used for og:image AND the Product-LD image — the pair must
 *  tell the same story. */
export function absolutizeProductArt(imageUrl: string, origin: string): string {
  if (imageUrl.startsWith("http")) return imageUrl;
  const absolutized = `${origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
  if (!absolutized.includes("/products/")) return absolutized;
  return `${absolutized}?v=${PRODUCT_ART_VERSION}`;
}
