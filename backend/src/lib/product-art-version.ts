// ── R174: product-art freshness (bot surfaces) ─────────────────────────────
// /products/*.webp rides max-age=30d + SWR HTTP caching AND the service
// worker's CacheFirst image rule — both keyed by URL. Art regeneration
// replaces every tile under its SAME slug filename (the DB's image_url
// paths never change), so bot surfaces (the crawler shell's og:image/
// Product-LD and the unfurler share card) append this round's ?v= exactly
// like the frontend's productArtUrl does for humans (frontend/src/lib/
// product-art.ts — MUST stay in sync; each side's tests pin its own value).
//
// R176: the tiles are the brands' REAL official artwork (Wikipedia logo
// files + brand CDNs; zero AI generation) — see scripts/r176-real-art/.
//
// R178: humans get TRANSPARENT art (theme-adaptive — the well is the
// ground), but bots keep OPAQUE tiles: this absolutizer now rewrites
// /products/<slug>.webp → /products-og/<slug>.webp (the pearl/charcoal
// family) because scrapers and unfurlers composite transparent images on
// unpredictable grounds — the share surface keeps its own. Bump the
// version ONLY when frontend/public/products{,-og}/ is replaced again.
export const PRODUCT_ART_VERSION = "r178";

/** The share-surface image contract (A11-F3b/110-F lineage, now versioned
 *  + family-mapped): already-absolute URLs pass through untouched (future
 *  CDN hosts), site-relative /products/<slug>.webp absolutizes AND moves
 *  to the opaque /products-og/ family with the art version. Used for
 *  og:image AND the Product-LD image — the pair must tell the same story
 *  (and match the hydrated MetaTags/seo-builders' productOgUrl). */
export function absolutizeProductArt(imageUrl: string, origin: string): string {
  if (imageUrl.startsWith("http")) return imageUrl;
  const absolutized = `${origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
  if (!absolutized.includes("/products/")) return absolutized;
  return `${absolutized.replace("/products/", "/products-og/")}?v=${PRODUCT_ART_VERSION}`;
}
