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
 * R176 (real-source art): the 45 tiles are the brands' REAL official
 * artwork (Wikipedia logo files + the brands' own CDNs — brain.fm, HMA,
 * CyberGhost; Google's favicon cache for the parked shopia.io), zero AI
 * generation.
 *
 * R178 (theme-adaptive transparent art): the /products/ family dropped its
 * baked pearl/charcoal grounds — the assets are transparent now and every
 * theme-aware image well (bg-muted/*) IS the ground, with the index.css
 * polarity block flipping ink/paper wordmarks on the theme where they'd
 * drown. Bump this ONLY when frontend/public/products/*.webp (and its
 * /products-og/ twin) is replaced again.
 */
export const PRODUCT_ART_VERSION = "r178";

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

/**
 * R178: the BOT-facing art family. og:image / Product-LD / share cards must
 * point at the OPAQUE /products-og/ tiles (pearl/charcoal grounds): scrapers
 * and unfurlers (WhatsApp — the shop's #1 share channel) composite
 * transparent art on unpredictable grounds, so the share surface keeps its
 * own. Rewrites site-relative AND absolutized /products/<slug>.webp forms
 * (the ?v= cache-buster rides along, same contract as productArtUrl);
 * everything else passes through untouched. MUST stay story-consistent with
 * the backend's absolutizeProductArt (spa-shell.ts reads the same family).
 */
export function productOgUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.includes("/products/")) return url;
  return `${url.replace("/products/", "/products-og/")}?v=${PRODUCT_ART_VERSION}`;
}
