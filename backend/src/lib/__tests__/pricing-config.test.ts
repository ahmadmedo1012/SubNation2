import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Catalog pricing engine tests (catalog reconstruction 2026-09-20).
 *
 * Pins the operator's official rule — 1 USD = 10 LYD, 100% markup —
 * through the SINGLE source of truth (lib/pricing-config.computeRetailLYD):
 *
 *   cost × (1 + markup/100) × rate = cost × 2 × 10 = cost × 20
 *
 * The DB-backed config (getPricingConfig / savePricingConfig) is tested
 * against a mocked @workspace/db — the pure math and the settings
 * fallback/override/cache logic are covered without a live database.
 */

// ── Mocks (hoisted) ────────────────────────────────────────────────────────
// 1. drizzle-orm: pricing-config uses the real `eq` to build WHERE clauses;
//    the marker shape lets the db mock resolve the awaited chain by key.
// 2. @workspace/db: the aliased pglite harness is replaced by an in-memory
//    system_settings Map — no database needed for config math tests.
const settingsRows = new Map<string, string>();
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ __eqVal: String(val) }),
}));
vi.mock("@workspace/db", () => ({
  systemSettingsTable: { key: "key", value: "value", updatedAt: "updated_at" },
  db: {
    select: () => ({
      from: () => ({
        where: (clause: { __eqVal?: string }) => ({
          limit: async () => {
            const key = clause?.__eqVal;
            const out: { value: string }[] = [];
            if (key != null && settingsRows.has(key)) {
              const stored = settingsRows.get(key);
              if (stored !== undefined) out.push({ value: stored });
            }
            return out;
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }),
      }),
    }),
  },
}));

import {
  DEFAULT_MARKUP_PERCENT,
  DEFAULT_USD_TO_LYD,
  __resetPricingConfigCache,
  computeRetailLYD,
  computeRetailUSD,
  getPricingConfig,
  round2,
  savePricingConfig,
} from "../pricing-config";

beforeEach(() => {
  settingsRows.clear();
  __resetPricingConfigCache();
});

afterEach(() => {
  __resetPricingConfigCache();
});

const DEFAULTS = { usdToLyd: DEFAULT_USD_TO_LYD, markupPercent: DEFAULT_MARKUP_PERCENT };

// ── The official rule (operator directive) ──────────────────────────────────

describe("computeRetailLYD — cost × 2 × 10", () => {
  it("maps the operator's canonical examples exactly", () => {
    expect(computeRetailLYD(1, DEFAULTS)).toBe(20); // $1 → 20 LYD
    expect(computeRetailLYD(5, DEFAULTS)).toBe(100); // $5 → 100 LYD
    expect(computeRetailLYD(10, DEFAULTS)).toBe(200); // $10 → 200 LYD
    expect(computeRetailLYD(20, DEFAULTS)).toBe(400); // $20 → 400 LYD
  });

  it("applies the exact directive example: $7.50 → $15 → 150 LYD", () => {
    expect(computeRetailUSD(7.5, DEFAULTS)).toBe(15);
    expect(computeRetailLYD(7.5, DEFAULTS)).toBe(150);
  });

  it("prices real imported variants correctly", () => {
    // Netflix 1 Month: $3.99 → 79.80 LYD
    expect(computeRetailLYD(3.99, DEFAULTS)).toBe(79.8);
    // Netflix 1 Year: $29.99 → 599.80 LYD
    expect(computeRetailLYD(29.99, DEFAULTS)).toBe(599.8);
    // ChatGPT Plus 1 Month: $4.99 → 99.80 LYD
    expect(computeRetailLYD(4.99, DEFAULTS)).toBe(99.8);
    // Ahrefs Lite Monthly: $99 → 1,980 LYD
    expect(computeRetailLYD(99, DEFAULTS)).toBe(1980);
  });

  it("honors a non-default markup", () => {
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 0 })).toBe(50); // 0% markup
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 50 })).toBe(75); // 50% markup
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 300 })).toBe(200); // 4× cost
  });

  it("honors a non-default exchange rate", () => {
    expect(computeRetailLYD(5, { usdToLyd: 5, markupPercent: 100 })).toBe(50);
    expect(computeRetailLYD(5, { usdToLyd: 4.8, markupPercent: 100 })).toBe(48);
  });

  it("rounds to cents (banker-safe idiom)", () => {
    // 3.335 × 20 = 66.7 exactly at the boundary — 2dp rounding is stable
    expect(computeRetailLYD(3.335, DEFAULTS)).toBe(round2(66.7));
    // floating dust: 0.1 + 0.2 style inputs must not leak into prices
    expect(computeRetailLYD(0.315, DEFAULTS)).toBe(6.3);
  });
});

describe("computeRetailUSD — the pre-conversion selling price", () => {
  it("doubles the cost at the default markup", () => {
    expect(computeRetailUSD(5, DEFAULTS)).toBe(10);
    expect(computeRetailUSD(3.99, DEFAULTS)).toBe(7.98);
  });
});

// ── Settings-backed config (fallback + override + cache) ───────────────────

describe("getPricingConfig", () => {
  it("falls back to the compiled defaults when settings are absent", async () => {
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 10, markupPercent: 100 });
  });

  it("reads overrides from system_settings", async () => {
    settingsRows.set("pricing.usd_to_lyd", "4.85");
    settingsRows.set("pricing.markup_percent", "80");
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 4.85, markupPercent: 80 });
  });

  it("ignores invalid stored values (non-numeric / non-positive)", async () => {
    settingsRows.set("pricing.usd_to_lyd", "not-a-number");
    settingsRows.set("pricing.markup_percent", "-5");
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 10, markupPercent: 100 });
  });

  it("serves the in-process cache within its TTL (one settings read per window)", async () => {
    await getPricingConfig();
    // Mutating the backing store inside the TTL must NOT be observed…
    settingsRows.set("pricing.usd_to_lyd", "99");
    expect((await getPricingConfig()).usdToLyd).toBe(10);
    // …until the cache is dropped (test hook / process restart).
    __resetPricingConfigCache();
    expect((await getPricingConfig()).usdToLyd).toBe(99);
  });
});

describe("savePricingConfig", () => {
  it("persists a partial patch on top of the current config", async () => {
    const next = await savePricingConfig({ usdToLyd: 4.9 });
    expect(next).toEqual({ usdToLyd: 4.9, markupPercent: 100 });
    // and the cache is warmed — reads see it immediately
    expect((await getPricingConfig()).usdToLyd).toBe(4.9);
  });

  it("rejects an out-of-bounds exchange rate", async () => {
    await expect(savePricingConfig({ usdToLyd: 0.01 })).rejects.toThrow("INVALID_USD_TO_LYD");
    await expect(savePricingConfig({ usdToLyd: 2000 })).rejects.toThrow("INVALID_USD_TO_LYD");
  });

  it("rejects an out-of-bounds markup", async () => {
    await expect(savePricingConfig({ markupPercent: -1 })).rejects.toThrow(
      "INVALID_MARKUP_PERCENT",
    );
    await expect(savePricingConfig({ markupPercent: 20_001 })).rejects.toThrow(
      "INVALID_MARKUP_PERCENT",
    );
  });
});
