/**
 * Product-art URL twin — the native port of the web's
 * frontend/src/lib/product-art.ts (R174/R178 cache-bust contract).
 *
 * The catalog's image_url values are site-relative (`/products/<slug>.webp`)
 * and ride `max-age=30d` HTTP caching keyed by URL; when the art files are
 * replaced under their same names, every URL must change or returning
 * visitors keep the old bytes for up to a month. The version query makes
 * new art visible the moment the bundle deploys.
 *
 * Differences from the web twin are exactly the transport facts: relative
 * paths must be absolutized against the API origin (the web's browser
 * resolves them against its own host), and the version rides only the
 * /products/ family (mirroring the web's semantics).
 */

import { API_URL } from "@/lib/api";

/** Bump ONLY when the /products/*.webp family is replaced again (web parity). */
export const PRODUCT_ART_VERSION = "r178";

/**
 * Absolutize + version a product-art URL:
 *   - empty/null → undefined (caller renders the themed fallback)
 *   - site-relative paths → absolutized with `apiBaseUrl`
 *   - URLs containing `/products/` → `?v=PRODUCT_ART_VERSION` appended
 *   - every other URL (CDN hosts, data: URIs, absolute) → untouched
 */
export function productArtUrl(
  url: string | null | undefined,
  apiBaseUrl: string = API_URL,
): string | undefined {
  if (!url) return undefined;
  const absolute = url.startsWith("/") ? `${apiBaseUrl}${url}` : url;
  if (!absolute.includes("/products/")) return absolute;
  return `${absolute}?v=${PRODUCT_ART_VERSION}`;
}
