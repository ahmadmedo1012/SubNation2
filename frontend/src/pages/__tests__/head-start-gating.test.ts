/**
 * R111-F4-F3 (P3): head-start catalog prefetch gating — regression
 * tests for the isHomeBootPath predicate exported from App.tsx (same
 * export-for-test pattern as shapeForRoute).
 *
 * The 96-F3 boot head-start fires at module-eval time on EVERY
 * non-admin boot and prefetched the FULL catalog (~4.7KB gz + ~53KB
 * JSON.parse on the main thread) under the {}-params key — but only
 * the HOME route consumes that key. Dominant entry paths (WhatsApp
 * product deep-links) paid the fetch + parse for a cache entry they
 * never read, competing with the actually-needed route chunk + data.
 *
 * The gate: leg (b) of the head-start now runs only when the initial
 * pathname IS the home route. These tests pin the truth table so the
 * gate can never silently widen back to every boot (or narrow past
 * "/" itself).
 *
 * NOTE: leg (a) (the tiny home-chunk warm-up) is deliberately NOT
 * gated — deep-linked visitors tapping the logo still get the warm
 * chunk; only the catalog fetch is home-scoped.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isHomeBootPath } from "@/App";

describe("R111-F4-F3: head-start home-route gate (isHomeBootPath)", () => {
  // The production deployment shape: BASE_URL = "/" → routerBase = "".
  describe('default deployment (routerBase = "")', () => {
    it("the home route passes the gate", () => {
      expect(isHomeBootPath("/", "")).toBe(true);
    });

    it("WhatsApp product deep-links (the dominant traffic) are gated out", () => {
      expect(isHomeBootPath("/product/netflix-1m", "")).toBe(false);
      expect(isHomeBootPath("/product/123", "")).toBe(false);
    });

    it("every other storefront entry path is gated out", () => {
      expect(isHomeBootPath("/cart", "")).toBe(false);
      expect(isHomeBootPath("/checkout", "")).toBe(false);
      expect(isHomeBootPath("/wallet", "")).toBe(false);
      expect(isHomeBootPath("/login", "")).toBe(false);
      expect(isHomeBootPath("/category/streaming", "")).toBe(false);
      expect(isHomeBootPath("/flash-sales", "")).toBe(false);
      // Admin boots return even earlier (the pre-existing admin gate),
      // but the predicate itself must never admit them either.
      expect(isHomeBootPath("/admin", "")).toBe(false);
      expect(isHomeBootPath("/admin/orders", "")).toBe(false);
    });

    it("a near-miss path is not home", () => {
      // Prefix-sharing paths must not leak through an eventual
      // startsWith-style regression.
      expect(isHomeBootPath("//", "")).toBe(false);
      expect(isHomeBootPath("/home", "")).toBe(false);
    });
  });

  // A split deployment under a base path: BASE_URL = "/sub/" →
  // routerBase = "/sub". The home route is "/sub/".
  describe('based deployment (routerBase = "/sub")', () => {
    it("the based home route passes the gate", () => {
      expect(isHomeBootPath("/sub/", "/sub")).toBe(true);
    });

    it("based deep links are gated out", () => {
      expect(isHomeBootPath("/sub/product/netflix-1m", "/sub")).toBe(false);
      expect(isHomeBootPath("/sub/cart", "/sub")).toBe(false);
    });
  });
});

// ── R186 (H-F3): docblock key-shape truth ────────────────────────────────────

describe("R186 (H-F3): boot-head-start's docblock names the REAL seeded key", () => {
  it("contains no bare {}-params claim (the pre-A2-F3 key shape the code no longer seeds)", () => {
    // The seeded key is getListProductsQueryKey({ fields: "list" }) —
    // a `{}` key would hash to a DIFFERENT key and seed nothing (the
    // comment at the prefetch site documents this). The stale {}-params
    // phrase described the pre-A2-F3 key shape and invited a future
    // "correction" toward it, silently breaking the head-start↔home
    // cache dedupe. Source-scan (the category-parity idiom): raw source,
    // comments included — the claim is docblock prose.
    const src = readFileSync(resolve(process.cwd(), "src/app/boot-head-start.ts"), "utf8");
    expect(src).not.toContain("{}-params");
    expect(src).toContain('getListProductsQueryKey({ fields: "list" })');
  });
});
