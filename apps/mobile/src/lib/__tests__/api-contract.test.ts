import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { API_URL, bootstrapApiClient } from "@/lib/api";
import type { CreateOrderBody } from "@workspace/api-client-native";

/**
 * R192 security-review pins — the two client halves of the native API
 * contract that a backend-only test can never see:
 *
 *   1. installOriginShim: every API-origin fetch carries
 *      `Origin: <API_URL>` (the CSRF gate's non-browser rule — a shim
 *      regression means every native mutation 403s);
 *   2. CreateOrderBody: the checkout request carries EXACTLY the intent
 *      fields — the money invariant "server-side price calculation" in
 *      type form (a price/discount/amount field creeping into the
 *      generated contract fails this typecheck).
 */

const ORIGINAL_FETCH = globalThis.fetch;

// The capturing underlying fetch — installed BEFORE bootstrapApiClient
// wraps it (the shim reads globalThis.fetch at install time).
const capturedCalls: Array<{ target: string; origin: string | null }> = [];
const capturingFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const target =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  capturedCalls.push({
    target,
    origin: new Headers(init?.headers).get("origin"),
  });
  return new Response("{}");
});

beforeEach(() => {
  capturedCalls.length = 0;
});

describe("installOriginShim — the CSRF Origin contract (native mutations)", () => {
  beforeAll(() => {
    globalThis.fetch = capturingFetch as unknown as typeof fetch;
    bootstrapApiClient();
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("an API-origin request carries Origin: <API_URL>", async () => {
    await fetch(`${API_URL}/api/orders`);
    expect(capturedCalls.at(-1)?.origin).toBe(API_URL);
  });

  it("an API-origin request with a path and query carries the Origin too", async () => {
    await fetch(`${API_URL}/api/products?page=2`);
    expect(capturedCalls.at(-1)?.origin).toBe(API_URL);
  });

  it("a FOREIGN-origin request stays untouched (no Origin injected)", async () => {
    await fetch("https://example.com/other");
    expect(capturedCalls.at(-1)?.origin).toBeNull();
  });

  it("an explicitly-set Origin is never overridden", async () => {
    await fetch(`${API_URL}/api/orders`, {
      headers: { origin: "https://explicit.example" },
    });
    expect(capturedCalls.at(-1)?.origin).toBe("https://explicit.example");
  });
});

describe("CreateOrderBody — the server-side pricing invariant (type-level pin)", () => {
  it("carries EXACTLY the intent fields — a price/amount/discount field fails this typecheck", () => {
    // The money rule in type form: the client may express WHAT it wants
    // (product, variant, coupon, attempt group) — never WHAT IT COSTS.
    // The server re-prices every unit in-transaction (backend orders.ts).
    expectTypeOf<CreateOrderBody>().toEqualTypeOf<{
      /** @minimum 1 */
      product_id: number;
      variant_id?: number | null;
      coupon_code?: string | null;
      order_group_id?: string | null;
    }>();
  });

  it("a runtime body built the checkout's way serializes without any price key", () => {
    // The exact construction sequence of checkout/index.tsx's unit loop.
    const body: CreateOrderBody = { product_id: 42 };
    body.order_group_id = "b18ff2a1-9b0d-4c6f-8b1e-2f3a5d7c9e01";
    body.variant_id = 7;
    body.coupon_code = "WELCOME10";
    expect(Object.keys(body).sort()).toEqual([
      "coupon_code",
      "order_group_id",
      "product_id",
      "variant_id",
    ]);
  });
});
