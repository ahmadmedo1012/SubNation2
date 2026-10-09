import { describe, expect, it } from "vitest";
import { routeWarmupFamilyForPath } from "@/App";

/**
 * A2 F4 (R124): pointer/focus route-chunk warm-up — regression tests for
 * the routeWarmupFamilyForPath predicate exported from App.tsx (the same
 * export-for-test pattern as isHomeBootPath / head-start-gating.test.ts).
 *
 * Delegated document listeners (pointerenter capture + focusin) fire the
 * matching lazy route's dynamic import when a pointer enters / focus
 * lands on an in-app <a href> — moving the chunk fetch one
 * interaction-RTT ahead of the tap on the no-CDN single-VPS origin.
 *
 * These tests pin the pathname truth table so the warmed set can neither
 * silently widen (hover-eagering new chunks — bytes for every visitor)
 * nor silently narrow (silently losing the measured navigation-latency
 * win). The listener wiring itself (saveData opt-out, admin skip,
 * absolute-URL skip) is module-scope code gated off under MODE === "test",
 * same as the boot head-start.
 */

describe("A2 F4 (R124): route-chunk warm-up family predicate", () => {
  it("warms exactly the storefront's most-traveled link families", () => {
    expect(routeWarmupFamilyForPath("/product/netflix-1m")).toBe("product");
    expect(routeWarmupFamilyForPath("/category/streaming")).toBe("category");
    expect(routeWarmupFamilyForPath("/cart")).toBe("cart");
    expect(routeWarmupFamilyForPath("/checkout")).toBe("checkout");
    expect(routeWarmupFamilyForPath("/wallet")).toBe("wallet");
  });

  it("sub-paths of a family map to the same warmed chunk", () => {
    expect(routeWarmupFamilyForPath("/product/123")).toBe("product");
    expect(routeWarmupFamilyForPath("/category/vpn")).toBe("category");
    // Checkout flow sub-routes (e.g. a post-payment success view) ride
    // the same page chunk.
    expect(routeWarmupFamilyForPath("/checkout/success")).toBe("checkout");
  });

  it("unrelated storefront paths warm nothing", () => {
    expect(routeWarmupFamilyForPath("/")).toBeNull();
    expect(routeWarmupFamilyForPath("/flash-sales")).toBeNull();
    expect(routeWarmupFamilyForPath("/login")).toBeNull();
    expect(routeWarmupFamilyForPath("/orders")).toBeNull();
    expect(routeWarmupFamilyForPath("/support")).toBeNull();
  });

  it("near-miss prefixes are not warmable routes", () => {
    // "/products" (plural) and "/product" (no slug) are not the product
    // route — the pattern must keep requiring the family's real shape.
    expect(routeWarmupFamilyForPath("/products")).toBeNull();
    expect(routeWarmupFamilyForPath("/product")).toBeNull();
    expect(routeWarmupFamilyForPath("/category")).toBeNull();
  });

  it("admin surfaces are never warmed from storefront hover", () => {
    // Admin routes pull 40-56 chunks per page behind a session guard —
    // warming them from storefront chrome would be waste, not speed.
    expect(routeWarmupFamilyForPath("/admin")).toBeNull();
    expect(routeWarmupFamilyForPath("/admin/products")).toBeNull();
    expect(routeWarmupFamilyForPath("/admin/orders/123")).toBeNull();
  });
});
