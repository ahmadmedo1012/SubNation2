import { describe, expect, it } from "vitest";
import { PRODUCT_ART_VERSION, productArtUrl } from "../product-art";

// R174: the product-art cache-bust contract — /products/ art is served with
// max-age=30d HTTP + SW CacheFirst (both URL-keyed), so replaced art files
// MUST change the rendered URL. This is the one module that owns the rule.
describe("productArtUrl (R174 art freshness)", () => {
  it("versions site-relative product art", () => {
    expect(productArtUrl("/products/netflix.webp")).toBe(
      `/products/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("versions ABSOLUTIZED product art (the og:image/JSON-LD form)", () => {
    expect(productArtUrl("https://subnation.ly/products/netflix.webp")).toBe(
      `https://subnation.ly/products/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("passes non-art URLs through untouched (future CDN hosts, data: URIs)", () => {
    expect(productArtUrl("https://cdn.example.com/logo.webp")).toBe(
      "https://cdn.example.com/logo.webp",
    );
    expect(productArtUrl("/opengraph.jpg")).toBe("/opengraph.jpg");
  });

  it("keeps empty empty (no image → no src)", () => {
    expect(productArtUrl(null)).toBeUndefined();
    expect(productArtUrl(undefined)).toBeUndefined();
    expect(productArtUrl("")).toBeUndefined();
  });
});
