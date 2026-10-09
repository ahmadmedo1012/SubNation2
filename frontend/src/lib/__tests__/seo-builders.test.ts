import { describe, expect, it } from "vitest";
import { buildProductLd } from "../seo-builders";

/**
 * R111 (D2-F2) — buildProductLd offers.availability must follow the REAL
 * stock signal.
 *
 * The builder used to key availability off `isActive` ONLY, so every active
 * product with zero deliverable stock asserted
 * `https://schema.org/InStock` while the product page UI said «نفد
 * المخزون» — on the live catalog that was 45/45 Product LDs lying to
 * Google (a structured-data honesty violation that suppresses rich
 * results). The page now threads the same `is_available` the buy button
 * gates on (product.tsx), and this suite pins the truth table:
 *
 *   is_active=true,  is_available=true  → InStock
 *   is_active=true,  is_available=false → OutOfStock  (the fix)
 *   is_active=false, is_available=true  → OutOfStock  (kept)
 *   is_active=false, is_available=false → OutOfStock  (kept)
 *   neither provided (legacy callers)   → InStock     (unchanged default)
 */

const BASE = {
  id: 5,
  slug: "netflix-1m",
  name: "Netflix شهر",
  description: "اشتراك شهري",
  imageUrl: "/products/netflix-1m.webp",
  price: 49,
  category: "streaming",
} as const;

function availabilityOf(overrides: Partial<Parameters<typeof buildProductLd>[0]>): string {
  const ld = buildProductLd({ ...BASE, ...overrides });
  return (ld.offers as { availability: string }).availability;
}

describe("buildProductLd — offers.availability follows real stock (D2-F2)", () => {
  it("InStock when the product is active AND deliverable stock exists", () => {
    expect(availabilityOf({ isActive: true, isAvailable: true })).toBe(
      "https://schema.org/InStock",
    );
  });

  it("OutOfStock when is_available is false even though is_active is true (the 45/45 live shape)", () => {
    expect(availabilityOf({ isActive: true, isAvailable: false })).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("OutOfStock when is_active is false (existing behavior kept)", () => {
    expect(availabilityOf({ isActive: false, isAvailable: true })).toBe(
      "https://schema.org/OutOfStock",
    );
    expect(availabilityOf({ isActive: false, isAvailable: false })).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("defaults to InStock when neither signal is provided (legacy callers unchanged)", () => {
    expect(availabilityOf({})).toBe("https://schema.org/InStock");
  });

  it("the rest of the Offer shape is untouched by the availability change", () => {
    const ld = buildProductLd({ ...BASE, isActive: true, isAvailable: false });
    const offers = ld.offers as Record<string, string>;
    expect(offers.price).toBe("49.00");
    expect(offers.priceCurrency).toBe("LYD");
    expect(offers.url).toBe("https://subnation.ly/product/netflix-1m");
    expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(offers.priceValidUntil).toMatch(/^\d{4}-12-31$/);
  });

  it("carries the canonical product URL at the top level (R123-E4b P3-n)", () => {
    const ld = buildProductLd({ ...BASE });
    // schema.org/Product.url — pairs with the runtime og:url/og:type=
    // product the product page's MetaTags emit, so the LD node and the
    // OG card agree on the canonical URL.
    expect((ld as Record<string, unknown>).url).toBe("https://subnation.ly/product/netflix-1m");
    // Legacy slug-less rows keep the numeric-id canonical form.
    const legacy = buildProductLd({ ...BASE, slug: null });
    expect((legacy as Record<string, unknown>).url).toBe("https://subnation.ly/product/5");
  });
});
