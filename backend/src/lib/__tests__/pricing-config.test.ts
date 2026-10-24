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
//    R186-3: `transaction` buffers upserts in a pending map and commits
//    them only when the callback resolves (rejection = rollback), so the
//    I-F5 atomicity pin exercises real commit/rollback semantics; the
//    `rejectNextSelect` / `failUpsertOnKey` hooks force the I-F4 / I-F5
//    failure shapes per-test.
// 3. ../logger: hoisted warn spy (the origins-boot-warn.test.ts idiom) —
//    pins the I-F4 "logs and falls back" contract.
const settingsRows = new Map<string, string>();
let rejectNextSelect = false;
let failUpsertOnKey: string | null = null;
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

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
            if (rejectNextSelect) {
              rejectNextSelect = false; // one-shot: exactly the next read fails
              throw new Error("forced settings read failure");
            }
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
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending = new Map<string, string>();
      const tx = {
        insert: () => ({
          values: (row: { key: string; value: string }) => ({
            onConflictDoUpdate: () => ({
              then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
                if (failUpsertOnKey === row.key) {
                  reject(new Error("forced upsert failure"));
                  return;
                }
                pending.set(row.key, row.value);
                resolve(undefined);
              },
            }),
          }),
        }),
      };
      // Rejection propagates and `pending` is discarded — rollback.
      const out = await fn(tx);
      for (const [k, v] of pending) settingsRows.set(k, v);
      return out;
    },
  },
}));

import {
  DEFAULT_MARKUP_PERCENT,
  DEFAULT_MAX_TOTAL_DISCOUNT_PCT,
  DEFAULT_USD_TO_LYD,
  __resetPricingConfigCache,
  computeRetailLYD,
  getPricingConfig,
  round2,
  savePricingConfig,
} from "../pricing-config";

beforeEach(() => {
  settingsRows.clear();
  rejectNextSelect = false;
  failUpsertOnKey = null;
  warn.mockClear();
  __resetPricingConfigCache();
});

afterEach(() => {
  __resetPricingConfigCache();
});

const DEFAULTS = {
  usdToLyd: DEFAULT_USD_TO_LYD,
  markupPercent: DEFAULT_MARKUP_PERCENT,
  maxTotalDiscountPct: DEFAULT_MAX_TOTAL_DISCOUNT_PCT,
};

// ── The official rule (operator directive) ──────────────────────────────────

describe("computeRetailLYD — cost × 2 × 10", () => {
  it("maps the operator's canonical examples exactly", () => {
    expect(computeRetailLYD(1, DEFAULTS)).toBe(20); // $1 → 20 LYD
    expect(computeRetailLYD(5, DEFAULTS)).toBe(100); // $5 → 100 LYD
    expect(computeRetailLYD(10, DEFAULTS)).toBe(200); // $10 → 200 LYD
    expect(computeRetailLYD(20, DEFAULTS)).toBe(400); // $20 → 400 LYD
  });

  it("applies the exact directive example: $7.50 → $15 → 150 LYD", () => {
    // I-F9 (R186-3): computeRetailUSD is deleted (zero production
    // callers); the $7.50 → $15 USD half stays pinned through the LYD
    // twin — 150 LYD at the default rate IS the $15 selling price.
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
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 0, maxTotalDiscountPct: 50 })).toBe(
      50,
    ); // 0% markup
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 50, maxTotalDiscountPct: 50 })).toBe(
      75,
    ); // 50% markup
    expect(computeRetailLYD(5, { usdToLyd: 10, markupPercent: 300, maxTotalDiscountPct: 50 })).toBe(
      200,
    ); // 4× cost
  });

  it("honors a non-default exchange rate", () => {
    expect(computeRetailLYD(5, { usdToLyd: 5, markupPercent: 100, maxTotalDiscountPct: 50 })).toBe(
      50,
    );
    expect(
      computeRetailLYD(5, { usdToLyd: 4.8, markupPercent: 100, maxTotalDiscountPct: 50 }),
    ).toBe(48);
  });

  it("rounds to cents (half-up Math.round idiom)", () => {
    // 3.335 × 20 = 66.7 exactly at the boundary — 2dp rounding is stable
    expect(computeRetailLYD(3.335, DEFAULTS)).toBe(round2(66.7));
    // floating dust: 0.1 + 0.2 style inputs must not leak into prices
    expect(computeRetailLYD(0.315, DEFAULTS)).toBe(6.3);
  });
});

// ── Settings-backed config (fallback + override + cache) ───────────────────

describe("getPricingConfig", () => {
  it("falls back to the compiled defaults when settings are absent", async () => {
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 10, markupPercent: 100, maxTotalDiscountPct: 50 });
  });

  it("reads overrides from system_settings", async () => {
    settingsRows.set("pricing.usd_to_lyd", "4.85");
    settingsRows.set("pricing.markup_percent", "80");
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 4.85, markupPercent: 80, maxTotalDiscountPct: 50 });
  });

  it("ignores invalid stored values (non-numeric / non-positive)", async () => {
    settingsRows.set("pricing.usd_to_lyd", "not-a-number");
    settingsRows.set("pricing.markup_percent", "-5");
    const config = await getPricingConfig();
    expect(config).toEqual({ usdToLyd: 10, markupPercent: 100, maxTotalDiscountPct: 50 });
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

  it("warns and serves compiled defaults when the settings read fails (I-F4)", async () => {
    rejectNextSelect = true;

    const config = await getPricingConfig();

    expect(config).toEqual({ usdToLyd: 10, markupPercent: 100, maxTotalDiscountPct: 50 });
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0]! as [{ err: Error; category: string }, string];
    expect(message).toBe("[pricing-config] settings read failed — serving compiled defaults");
    expect(fields.category).toBe("pricing");
    expect(fields.err).toBeInstanceOf(Error);

    // One-shot failure: once the cache window is dropped, a healthy read
    // picks overrides up again — the warn was degradation, not poisoning.
    __resetPricingConfigCache();
    settingsRows.set("pricing.usd_to_lyd", "4.85");
    warn.mockClear();
    expect((await getPricingConfig()).usdToLyd).toBe(4.85);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("savePricingConfig", () => {
  it("persists the settings triple through one transaction (rows land + cache warms)", async () => {
    const next = await savePricingConfig({ usdToLyd: 4.9 });
    expect(next).toEqual({ usdToLyd: 4.9, markupPercent: 100, maxTotalDiscountPct: 50 });
    // and the cache is warmed — reads see it immediately
    expect((await getPricingConfig()).usdToLyd).toBe(4.9);
    // …and the transaction committed every row of the coherent triple
    expect(settingsRows.get("pricing.usd_to_lyd")).toBe("4.9");
    expect(settingsRows.get("pricing.markup_percent")).toBe("100");
    expect(settingsRows.get("pricing.max_total_discount_pct")).toBe("50");
  });

  it("rolls back ALL three upserts when a mid-transaction write fails (I-F5 atomicity)", async () => {
    failUpsertOnKey = "pricing.markup_percent"; // the SECOND upsert

    await expect(savePricingConfig({ usdToLyd: 4.9 })).rejects.toThrow("forced upsert failure");

    // No hybrid config: the FIRST key's row must not survive the failed
    // transaction (the old three-autocommit shape persisted it).
    expect(settingsRows.has("pricing.usd_to_lyd")).toBe(false);
    expect(settingsRows.has("pricing.markup_percent")).toBe(false);
    expect(settingsRows.has("pricing.max_total_discount_pct")).toBe(false);
    // …and a fresh read still serves the untouched prior config.
    __resetPricingConfigCache();
    expect((await getPricingConfig()).usdToLyd).toBe(10);
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
