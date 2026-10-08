import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("API contracts — request-context smoke (public GETs only)", () => {
  test("GET /api/healthz → 200 {status: ok}", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /api/products → 200 JSON array", async ({ request }) => {
    const res = await request.get("/api/products");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /api/catalog/stats → 200 object with the documented keys", async ({ request }) => {
    const res = await request.get("/api/catalog/stats");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.total_products).toBe("number");
    expect(typeof body.active_products).toBe("number");
  });

  test("GET /api/auth/providers → 200 array of enabled providers", async ({ request }) => {
    const res = await request.get("/api/auth/providers");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
