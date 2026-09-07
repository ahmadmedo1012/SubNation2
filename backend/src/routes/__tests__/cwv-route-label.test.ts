import { describe, expect, it } from "vitest";
import express from "express";
import { cwvSamplesTotal } from "../../lib/metrics";
import cwvRouter, { normalizeCwvRouteLabel } from "../cwv";

/**
 * SEC-92-05 (round-92 B1 security audit) — CWV beacon route-label
 * cardinality.
 *
 * `route` is a fully client-controlled string feeding a prom-client
 * counter AND a 19-bucket histogram. An anonymous attacker POSTing
 * beacons with route:"/x"+i minted unbounded label sets — registry
 * memory growth / metrics-response bloat (cardinality DoS).
 *
 * normalizeCwvRouteLabel now maps the raw route onto a bounded SPA route
 * table (exact statics + dynamic-segment patterns) and buckets everything
 * else to "other". The raw string still reaches only the structured log.
 */

function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", cwvRouter);
  return app;
}

async function postBeacon(route: string): Promise<number> {
  const app = buildApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const sample = {
          name: "LCP",
          value: 1234,
          route,
          viewportClass: "mobile",
          sessionId: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/cwv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sample),
        });
        await res.text();
        resolve(res.status);
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe("normalizeCwvRouteLabel — bounded table mapping", () => {
  it("known static routes map to themselves", () => {
    expect(normalizeCwvRouteLabel("/")).toBe("/");
    expect(normalizeCwvRouteLabel("/checkout")).toBe("/checkout");
    expect(normalizeCwvRouteLabel("/admin/topups")).toBe("/admin/topups");
    expect(normalizeCwvRouteLabel("/admin/products/enrichment")).toBe("/admin/products/enrichment");
  });

  it("dynamic routes collapse to their pattern (slug length cannot inflate cardinality)", () => {
    expect(normalizeCwvRouteLabel("/product/netflix-premium")).toBe("/product/:slug");
    expect(normalizeCwvRouteLabel("/category/streaming")).toBe("/category/:slug");
    expect(normalizeCwvRouteLabel("/orders/SN-2026-000123")).toBe("/orders/:orderCode");
    expect(normalizeCwvRouteLabel("/admin/risk/events/991")).toBe("/admin/risk/events/:id");
  });

  it("unknown routes bucket to 'other'", () => {
    expect(normalizeCwvRouteLabel("/totally-unknown-page")).toBe("other");
    expect(normalizeCwvRouteLabel("/admin/brand-new-page")).toBe("other");
    expect(normalizeCwvRouteLabel("/api/cwv")).toBe("other");
  });

  it("routes longer than 64 chars never produce a label longer than 64 chars", () => {
    const longSlug = `/product/${"x".repeat(300)}`;
    const label = normalizeCwvRouteLabel(longSlug);
    expect(label).toBe("/product/:slug");
    expect(label.length).toBeLessThanOrEqual(64);

    const longUnknown = `/${"y".repeat(300)}`;
    const other = normalizeCwvRouteLabel(longUnknown);
    expect(other).toBe("other");
    expect(other.length).toBeLessThanOrEqual(64);
  });

  it("query strings and trailing slashes are normalized before matching", () => {
    expect(normalizeCwvRouteLabel("/wallet?tab=topups")).toBe("/wallet");
    expect(normalizeCwvRouteLabel("/wallet/")).toBe("/wallet");
    expect(normalizeCwvRouteLabel("/checkout#section")).toBe("/checkout");
  });
});

describe("POST /api/cwv — label reaching the registry (integration)", () => {
  it("an unknown route is ingested as the 'other' bucket, not as its raw value", async () => {
    const status = await postBeacon("/cardinality-attack-route-xyz");
    expect(status).toBe(204);

    const values = (
      (await cwvSamplesTotal.get()).values as Array<{
        labels: { name: string; route: string; viewport: string };
        value: number;
      }>
    ).filter((v) => v.labels.viewport === "mobile");
    const other = values.find((v) => v.labels.name === "LCP" && v.labels.route === "other");
    expect(other).toBeDefined();
    expect(other?.value ?? 0).toBeGreaterThan(0);

    // The raw attacker string must NOT exist as a label.
    const raw = values.find((v) => v.labels.route === "/cardinality-attack-route-xyz");
    expect(raw).toBeUndefined();
  });

  it("a long dynamic route lands on its pattern label", async () => {
    const status = await postBeacon(`/product/${"z".repeat(120)}`);
    expect(status).toBe(204);

    const values = (
      (await cwvSamplesTotal.get()).values as Array<{
        labels: { name: string; route: string; viewport: string };
        value: number;
      }>
    ).filter((v) => v.labels.viewport === "mobile");
    const pattern = values.find(
      (v) => v.labels.name === "LCP" && v.labels.route === "/product/:slug",
    );
    expect(pattern).toBeDefined();
    expect(pattern?.value ?? 0).toBeGreaterThan(0);
  });
});
