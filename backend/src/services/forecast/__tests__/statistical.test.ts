import { describe, expect, it } from "vitest";
import {
  computeAvgDailySales,
  computeDowBlend7d,
  computeDowMultiplier,
  densifyHistory,
  deriveConfidence,
  predictDemand7d,
  predictDemand30d,
} from "../statistical";

/**
 * Pure-function tests for the v1 forecasting math
 * (011-inventory-demand-forecast, T019).
 *
 * Deterministic fixtures — no Date.now(), no DB. The forecast date is
 * pinned to a Tuesday (2026-06-02 is a Tuesday in the UTC calendar)
 * so the day-of-week assertions are stable across CI shards.
 */

const TUESDAY = "2026-06-02";

function uniformHistory(perDay: number, days: number, end: string) {
  const out: Array<{ date: string; count: number }> = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push({ date: `${yyyy}-${mm}-${dd}`, count: perDay });
  }
  return out;
}

describe("computeAvgDailySales", () => {
  it("returns 0 for an empty history", () => {
    expect(computeAvgDailySales([])).toBe(0);
  });

  it("returns the trailing-14-day mean", () => {
    const hist = uniformHistory(2, 14, TUESDAY);
    expect(computeAvgDailySales(hist)).toBe(2);
  });

  it("treats missing days correctly when called on a sparse list", () => {
    // 10 orders across 14 days = 10/14 ≈ 0.714. Any caller that wants
    // zeros backfilled must densify first; this function divides by the
    // 14-day window, not the row count.
    const hist = uniformHistory(1, 10, TUESDAY);
    expect(computeAvgDailySales(hist)).toBeCloseTo(10 / 14, 5);
  });
});

describe("computeDowMultiplier", () => {
  it("returns 1.0 when the history is empty", () => {
    expect(computeDowMultiplier([], 2)).toBe(1);
  });

  it("returns 1.0 on perfectly uniform history", () => {
    const hist = uniformHistory(5, 28, TUESDAY);
    // every weekday has identical count → ratio = 1.
    for (let dow = 0; dow < 7; dow++) {
      expect(computeDowMultiplier(hist, dow)).toBe(1);
    }
  });

  it("flags a 2× weekday spike", () => {
    // Pin a clear Tuesday spike: 10 on Tuesdays, 1 on every other day,
    // across 28 calendar days. avg = (10*4 + 1*24)/28 ≈ 2.286,
    // tuesday-avg = 10, ratio = 10 / 2.286 ≈ 4.375 → clamped to 5.
    const hist: Array<{ date: string; count: number }> = [];
    for (let i = 28; i >= 1; i--) {
      const d = new Date(`${TUESDAY}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      hist.push({
        date: `${yyyy}-${mm}-${dd}`,
        count: d.getUTCDay() === 2 ? 10 : 1,
      });
    }
    const m = computeDowMultiplier(hist, 2 /* Tuesday */);
    expect(m).toBeGreaterThan(2);
    // Capped at 5 (research §R-1: keep one-off spikes from blowing up).
    expect(m).toBeLessThanOrEqual(5);
  });
});

describe("computeDowBlend7d", () => {
  it("blends to ~1.0 on uniform history", () => {
    const hist = uniformHistory(3, 28, TUESDAY);
    const blend = computeDowBlend7d(hist, TUESDAY);
    expect(blend).toBeCloseTo(1, 5);
  });
});

describe("predictDemand7d / predictDemand30d", () => {
  it("predicts demand = avg × dow_blend × horizon, rounded", () => {
    expect(predictDemand7d(2, 1)).toBe(14);
    expect(predictDemand7d(2.5, 1)).toBe(18); // 17.5 → 18
  });

  it("30-day prediction uses the 30-day blend internally", () => {
    const hist = uniformHistory(3, 28, TUESDAY);
    const d30 = predictDemand30d(hist, TUESDAY, 3);
    // uniform history → blend = 1.0 → 3*1*30 = 90
    expect(d30).toBe(90);
  });
});

describe("deriveConfidence", () => {
  it("returns insufficient_data when < 14 days", () => {
    expect(deriveConfidence(uniformHistory(1, 13, TUESDAY))).toBe("insufficient_data");
    expect(deriveConfidence([])).toBe("insufficient_data");
  });

  it("returns low when 7+ zero-sales days", () => {
    const hist = uniformHistory(0, 14, TUESDAY).map((d, i) => ({
      ...d,
      count: i < 7 ? 5 : 0,
    }));
    expect(deriveConfidence(hist)).toBe("low");
  });

  it("returns high on tight steady demand", () => {
    expect(deriveConfidence(uniformHistory(10, 14, TUESDAY))).toBe("high");
  });

  it("returns medium when CV is high", () => {
    // 14 days with one massive spike → CV >> 0.5
    const hist = uniformHistory(2, 14, TUESDAY);
    hist[0]!.count = 100;
    expect(deriveConfidence(hist)).toBe("medium");
  });
});

describe("densifyHistory", () => {
  it("backfills zero-sales days", () => {
    const sparse = [{ date: "2026-05-30", count: 3 }];
    const dense = densifyHistory(sparse, TUESDAY, 14);
    expect(dense.length).toBe(14);
    const found = dense.find((d) => d.date === "2026-05-30");
    expect(found?.count).toBe(3);
    const zeros = dense.filter((d) => d.count === 0).length;
    expect(zeros).toBe(13);
  });
});
