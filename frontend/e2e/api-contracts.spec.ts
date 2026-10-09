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
    // R125: the key is `available_products` (products.ts:558 — the
    // sellable-count invariant), NOT `active_products`. The spec drifted
    // from the shipped contract; caught by R125's live guest-suite run
    // (the e2e job is workflow_dispatch-only, so it hadn't run in rounds).
    expect(typeof body.available_products).toBe("number");
  });

  test("GET /api/auth/providers → 200 {providers: [...]} of enabled identities", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/providers");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { providers?: unknown[] };
    // R125: auth.ts:211 wraps the array — `{ providers: identities }`.
    // The old bare-array expectation predated the wrapper; caught by
    // R125's live guest-suite run (the e2e job is workflow_dispatch-only).
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers!.length).toBeGreaterThan(0);
  });
});
