/**
 * R174 (product-art freshness): the product-art cache-bust contract.
 *
 * /products/*.webp rides `max-age=30d, stale-while-revalidate` HTTP caching
 * (spa-shell.ts A11-F2/R104 AG11-2b) AND the service worker's CacheFirst
 * image rule (30d, vite.config.ts Round-4 P1-4) — both keyed by URL. When
 * the art files are REPLACED under their same slug names (the DB's
 * image_url paths never change), every returning visitor keeps the old
 * bytes for up to a month unless the rendered URL changes. Appending this
 * round's version query on every render (and on the boot image-warming
 * fetch, which must match or the warm becomes a double-download) makes the
 * new art visible to everyone the moment the bundle deploys.
 *
 * Bump this ONLY when frontend/public/products/*.webp is replaced again.
 */
export const PRODUCT_ART_VERSION = "r174";

/**
 * Pure URL versioner — any product-art URL (site-relative /products/… or an
 * absolutized https://…/products/… form) gains ?v=<version>; every other
 * URL (future CDN hosts, data: URIs, absolute URLs) passes through
 * untouched, and empty stays empty. Mirrors the backend's
 * versionProductArtUrl semantics exactly (spa-shell.ts).
 */
export function productArtUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.includes("/products/")) return url;
  return `${url}?v=${PRODUCT_ART_VERSION}`;
}
