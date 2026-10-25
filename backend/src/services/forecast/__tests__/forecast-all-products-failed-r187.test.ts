import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R187 (G-F4) — an all-products-failed forecast run is a FAILURE, not a
 * hollow success.
 *
 * The verified defect (the enrichment twin's R186 F-F2 class): per-product
 * failures were counted into skipped.error but markSuccess ran
 * unconditionally — a run where EVERY product leg failed persisted
 * outcome=success with a null failure_reason while the admin status
 * surface said "healthy" about a run that delivered nothing.
 *
 * Fix under test: after the product loop, when
 * `products.length > 0 && predicted === 0 && skipped.error ===
 * products.length`, the orchestrator calls markFailure("all N product
 * forecasts failed") and returns outcome "failure" (mirroring the outer
 * catch's shape).
 *
 * Harness: collaborators mocked at the module boundary (the
 * enrichment-all-calls-failed-r186 idiom — the unit under test is the
 * orchestrator's outcome classification, not the store SQL or the math).
 */

const { products } = vi.hoisted(() => ({
  /** The aggregate's return — two products by default. */
  products: [] as Array<Record<string, unknown>>,
}));

vi.mock("../aggregate", () => ({
  loadOrderHistoryForActiveProducts: vi.fn(async () => products.map((p) => ({ ...p }))),
}));

vi.mock("../forecast-store", () => ({
  upsertForecast: vi.fn(async (input: { productId: number }) => {
    throw new Error(`forecast store down for product ${input.productId} (r187 pin)`);
  }),
}));

vi.mock("../run-store", () => ({
  createInFlightRun: vi.fn(async () => ({ id: 88 })),
  markSuccess: vi.fn(async () => undefined),
  markFailure: vi.fn(async () => undefined),
}));

vi.mock("../alerts", () => ({
  dispatchForecastAlerts: vi.fn(async () => ({
    alertsEmitted: 0,
    alertsCapped: false,
    paused: false,
  })),
}));

vi.mock("@workspace/db", () => ({
  auditLogsTable: {},
  db: { insert: () => ({ values: () => Promise.resolve() }) },
}));

import { runForecast } from "../forecast.service";
import { upsertForecast } from "../forecast-store";
import { markFailure, markSuccess } from "../run-store";

const markFailureMock = vi.mocked(markFailure);
const markSuccessMock = vi.mocked(markSuccess);
const upsertForecastMock = vi.mocked(upsertForecast);

function fakeProduct(productId: number, firstOrderDaysAgo: number | null) {
  return {
    productId,
    history: [] as Array<{ date: string; count: number }>,
    currentStockOnHand: 5,
    firstOrderAt:
      firstOrderDaysAgo === null ? null : new Date(Date.now() - firstOrderDaysAgo * 86_400_000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  products.length = 0;
  // Default: every upsert rejects (the forecast-store module mock above);
  // the partial-success case overrides per productId below.
  upsertForecastMock.mockImplementation(async (input: { productId: number }) => {
    throw new Error(`forecast store down for product ${input.productId} (r187 pin)`);
  });
});

describe("R187 (G-F4) — all product forecasts failed → the run is marked failure", () => {
  it("every product's upsert rejects → markFailure with the truthful reason, NO markSuccess, outcome failure", async () => {
    // firstOrderAt 20 days old → confidence "low" (the full prediction
    // path), so the ONLY skip reason is the upsert error itself.
    products.push(fakeProduct(1, 20), fakeProduct(2, 20));

    const result = await runForecast();

    expect(result.outcome).toBe("failure");
    expect(result.runId).toBe(88);
    expect(result.productsPredicted).toBe(0);
    expect(result.productsSkipped).toEqual({ error: 2 });

    // The existing failure-path shape, mirrored: reason + partial counts.
    expect(markFailureMock).toHaveBeenCalledTimes(1);
    expect(markFailureMock.mock.calls[0]).toEqual([88, "all 2 product forecasts failed"]);

    // The hollow success is gone.
    expect(markSuccessMock).not.toHaveBeenCalled();
  });

  it("boundary guard: one failing + one SUCCEEDING product still succeeds — the branch fires only on all-failed", async () => {
    products.push(fakeProduct(1, 20), fakeProduct(2, 20));
    upsertForecastMock.mockImplementation(async (input: { productId: number }) => {
      if (input.productId === 2) {
        throw new Error("forecast store down for product 2 (r187 pin)");
      }
      return undefined;
    });

    const result = await runForecast();

    expect(result.outcome).toBe("success");
    expect(result.productsPredicted).toBe(1);
    expect(result.productsSkipped).toEqual({ error: 1 });
    expect(markSuccessMock).toHaveBeenCalledTimes(1);
    expect(markFailureMock).not.toHaveBeenCalled();
  });
});
