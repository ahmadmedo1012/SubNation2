import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaTags } from "@/components/seo/MetaTags";
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
    // R166 (F2): the seller object joined the Offer, so the flat-string
    // cast became a Record<string, unknown>.
    const offers = ld.offers as Record<string, unknown>;
    expect(offers.price).toBe("49.00");
    expect(offers.priceCurrency).toBe("LYD");
    expect(offers.url).toBe("https://subnation.ly/product/netflix-1m");
    expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(offers.priceValidUntil).toMatch(/^\d{4}-12-31$/);
  });

  it("carries Offer.seller = the SubNation Organization (R166 F2, mirrored with the backend shell builder)", () => {
    const offers = buildProductLd(BASE).offers as Record<string, unknown>;
    // Google's Product docs list seller among the recommended Offer
    // fields; SubNation IS the seller — an honest identity claim, the
    // same class as the Brand field (never a fabricated one like
    // aggregateRating).
    expect(offers.seller).toEqual({ "@type": "Organization", name: "SubNation" });
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

// ── R186 (H-F2): the single origin resolver ──────────────────────────────────

describe("getAppOrigin — ONE resolver for the runtime tags AND the JSON-LD (R186 H-F2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with VITE_APP_ORIGIN unset, MetaTags' canonical/og:url and buildProductLd share ONE origin", () => {
    // H-F2: MetaTags used to keep a private getAppOrigin with a
    // window.location.origin middle step, so on any non-apex host with
    // the env unset (preview deploys, prod-mode local builds) the
    // runtime canonical/og:url emitted the CURRENT host while the
    // JSON-LD @id/url/image stayed https://subnation.ly — a
    // split-domain consolidation signal on one page. MetaTags now
    // imports the shared getAppOrigin (env → apex default), so both
    // surfaces agree by construction. jsdom's http://localhost:3000
    // plays the non-apex host: the old ladder would emit it here and
    // fail this pin.
    vi.stubEnv("VITE_APP_ORIGIN", "");
    render(
      createElement(MetaTags, {
        title: "Netflix شهر",
        description: "اشتراك شهري",
        path: "/product/netflix-1m",
        type: "product",
      }),
    );
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
    const ldUrl = buildProductLd(BASE).url;
    expect(canonical).toBe(ldUrl);
    expect(ogUrl).toBe(ldUrl);
    expect(ldUrl).toBe("https://subnation.ly/product/netflix-1m");
  });

  it("MetaTags.tsx carries no window.location-origin ladder (source-scan — the category-parity idiom)", () => {
    // Byte-level twin of the behavioral pin above: immune to whatever
    // origin the test jsdom happens to carry. Comments are stripped
    // first (the route-skeleton-card suite idiom) so rationale prose
    // may NAME the retired window.location ladder without tripping the
    // ban — only CODE using it fails.
    const src = readFileSync(resolve(process.cwd(), "src/components/seo/MetaTags.tsx"), "utf8");
    const strip = (s: string): string =>
      s
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\*.*$/gm, "");
    expect(strip(src)).not.toContain("window.location");
    // seo-builders keeps exactly one resolver, exported for both sides.
    const builders = readFileSync(resolve(process.cwd(), "src/lib/seo-builders.ts"), "utf8");
    expect(strip(builders)).not.toContain("window.location");
    expect(builders).toContain("export function getAppOrigin");
  });
});
