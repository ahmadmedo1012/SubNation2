/**
 * R127-L10 (B4 D5) — boot card-image warming.
 *
 * Live (B4 §B, home-mobile observed trace): the LCP card image request
 * only STARTED at 2,214 ms — catalog JSON landed at 2,062 ms and a
 * React render hop sat between the two; resourceLoadDelay (1,537–3,739
 * ms) dominated EVERY image-LCP run. The fix warms the first-4 card
 * images AT PREFETCH RESOLVE (startBootHeadStart's .then), so the
 * bytes flow into the HTTP cache while React is still mounting.
 *
 * These tests pin the warmed-set selection (bootCardImageWarmUrls —
 * the export-for-test pattern, same as isHomeBootPath / shapeForRoute)
 * so it can neither silently widen (warming the whole catalog — byte
 * cost on every home boot) nor narrow (losing the LCP cards).
 *
 * The prefetch-resolve WIRING itself is module-eval code gated off in
 * tests (MODE === "test"), same limitation as the isHomeBootPath suite
 * — the 3-line .then is reviewed by eye and the selection semantics
 * are what can regress silently.
 */

import { describe, expect, it } from "vitest";
import { bootCardImageWarmUrls } from "@/App";
import type { ProductListItem } from "@workspace/api-client-react";

/** Minimal valid ProductListItem rows (only image_url matters to the warmer). */
function row(id: number, image_url: string | null | undefined): ProductListItem {
  return {
    id,
    name: `product-${id}`,
    image_url,
    price: 10,
    price_from: false,
    is_active: true,
    stock_count: 5,
    is_available: true,
    order_count: 1,
    variant_count: 0,
  };
}

describe("R127-L10 (B4 D5): bootCardImageWarmUrls — warmed-set selection", () => {
  it("warms EXACTLY the first 4 rows' images, in render order (never the 5th)", () => {
    const list = [1, 2, 3, 4, 5, 6].map((id) => row(id, `/products/p${id}.webp`));

    expect(bootCardImageWarmUrls(list)).toEqual([
      "/products/p1.webp",
      "/products/p2.webp",
      "/products/p3.webp",
      "/products/p4.webp",
    ]);
  });

  it("a catalog shorter than 4 warms every row (no padding, no error)", () => {
    const list = [row(1, "/products/only.webp")];

    expect(bootCardImageWarmUrls(list)).toEqual(["/products/only.webp"]);
    expect(bootCardImageWarmUrls([])).toEqual([]);
  });

  it("rows without a usable image_url are skipped WITHOUT pulling later rows forward", () => {
    // The report's literal directive is list.slice(0,4) — an image-less
    // row inside the window warms nothing; row 5 is NOT pulled in.
    const list = [
      row(1, "/products/p1.webp"),
      row(2, null),
      row(3, undefined),
      row(4, ""),
      row(5, "/products/p5.webp"),
    ];

    expect(bootCardImageWarmUrls(list)).toEqual(["/products/p1.webp"]);
  });

  it("null/undefined lists warm nothing (a failed/absent prefetch is inert)", () => {
    expect(bootCardImageWarmUrls(undefined)).toEqual([]);
    expect(bootCardImageWarmUrls(null)).toEqual([]);
  });

  it("does not mutate or reorder the input list", () => {
    const list = [row(1, "/products/p1.webp"), row(2, "/products/p2.webp")];
    const snapshot = JSON.stringify(list);

    bootCardImageWarmUrls(list);

    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
