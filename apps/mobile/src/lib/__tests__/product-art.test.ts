import { describe, expect, it } from "vitest";

import { productArtUrl, PRODUCT_ART_VERSION } from "@/lib/product-art";

/** The product-art cache-bust twin of the web's productArtUrl (R174/R178). */
describe("productArtUrl", () => {
  const BASE = "https://subnation.ly";

  it("absolutizes site-relative /products/ URLs and adds the version", () => {
    expect(productArtUrl("/products/netflix.webp", BASE)).toBe(
      `https://subnation.ly/products/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("re-versions already-absolute same-origin /products/ URLs", () => {
    expect(productArtUrl(`${BASE}/products/spotify.webp`, BASE)).toBe(
      `https://subnation.ly/products/spotify.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("passes non-product URLs through untouched (no version, no absolutize of foreign hosts)", () => {
    expect(productArtUrl("https://cdn.example.com/x.png", BASE)).toBe(
      "https://cdn.example.com/x.png",
    );
    expect(productArtUrl("/icon-192.png", BASE)).toBe(`${BASE}/icon-192.png`);
  });

  it("empty stays empty", () => {
    expect(productArtUrl(null, BASE)).toBeUndefined();
    expect(productArtUrl(undefined, BASE)).toBeUndefined();
    expect(productArtUrl("", BASE)).toBeUndefined();
  });
});
