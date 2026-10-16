/**
 * R154 — installment transfer plans.
 *
 * The Libyana/Madar USSD generators previously returned ONE code for
 * any amount; the networks cap a single transfer (Libyana 50 LYD,
 * Madar 20 LYD) and Libyana's USSD parameter is in MILLIMES (×1000).
 * The plan contract pinned here: every installment within the limit,
 * the installments sum EXACTLY to the total (no rounding up — the
 * customer never transfers more than requested), and the exact
 * acceptance examples from the R154 brief.
 */

import { describe, expect, it } from "vitest";
import {
  RECEIVER_PHONE,
  TRANSFER_LIMITS,
  splitInstallments,
  transferCodeTelHref,
  transferPlan,
} from "@/lib/transfer-code";

describe("splitInstallments — limit-aware splitting with exact conservation", () => {
  it("below the limit: one installment of the whole amount", () => {
    expect(splitInstallments(1, 50)).toEqual([1]);
    expect(splitInstallments(19, 20)).toEqual([19]);
    expect(splitInstallments(49, 50)).toEqual([49]);
  });

  it("exactly at the limit: a single maximum installment", () => {
    expect(splitInstallments(50, 50)).toEqual([50]);
    expect(splitInstallments(20, 20)).toEqual([20]);
  });

  it("above the limit: max installments + exact positive remainder", () => {
    expect(splitInstallments(75, 50)).toEqual([50, 25]);
    expect(splitInstallments(100, 50)).toEqual([50, 50]);
    expect(splitInstallments(40, 20)).toEqual([20, 20]);
    expect(splitInstallments(50, 20)).toEqual([20, 20, 10]);
    expect(splitInstallments(100, 20)).toEqual([20, 20, 20, 20, 20]);
  });

  it("every split conserves the total exactly (property, 1..300)", () => {
    for (const limit of [20, 50]) {
      for (let total = 1; total <= 300; total += 1) {
        const parts = splitInstallments(total, limit);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        for (const p of parts) expect(p).toBeGreaterThan(0);
        expect(Math.max(...parts)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("rejects non-positive / non-integer totals with []", () => {
    expect(splitInstallments(0, 50)).toEqual([]);
    expect(splitInstallments(-5, 50)).toEqual([]);
    expect(splitInstallments(10.5, 50)).toEqual([]);
  });
});

describe("transferPlan — Libyana (millimes ×1000, ≤50 per transfer)", () => {
  it("R154 acceptance table — exact codes", () => {
    // 1 LYD → 1000
    expect(transferPlan("libyana", 1)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*1000*1#",
    ]);
    // 10 LYD → 10000 (the preset-10 acceptance line)
    expect(transferPlan("libyana", 10)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*10000*1#",
    ]);
    // 20 LYD → 20000
    expect(transferPlan("libyana", 20)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*20000*1#",
    ]);
    // 50 LYD → 50000 (the single-transfer limit itself)
    expect(transferPlan("libyana", 50)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*50000*1#",
    ]);
    // 75 LYD → 50 + 25 → 50000, 25000
    expect(transferPlan("libyana", 75)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*50000*1#",
      "*122*218913456789*25000*1#",
    ]);
    // 100 LYD → NEVER one 100-dinar transfer: two 50s, the SAME code twice
    expect(transferPlan("libyana", 100)?.installments.map((i) => i.code)).toEqual([
      "*122*218913456789*50000*1#",
      "*122*218913456789*50000*1#",
    ]);
  });

  it("boundary values around the 50 limit", () => {
    expect(transferPlan("libyana", 51)?.installments).toHaveLength(2);
    expect(transferPlan("libyana", 51)?.installments.map((i) => i.amount)).toEqual([50, 1]);
    expect(transferPlan("libyana", 49)?.installments).toHaveLength(1);
    expect(transferPlan("libyana", 49)?.installments[0]?.amount).toBe(49);
    // 99 → 50 + 49; 101 → 50 + 50 + 1
    expect(transferPlan("libyana", 99)?.installments.map((i) => i.amount)).toEqual([50, 49]);
    expect(transferPlan("libyana", 101)?.installments.map((i) => i.amount)).toEqual([50, 50, 1]);
  });

  it("carries the total + the whole-LYD amounts alongside the codes", () => {
    const plan = transferPlan("libyana", "75");
    expect(plan?.total).toBe(75);
    expect(plan?.installments.map((i) => i.amount)).toEqual([50, 25]);
  });
});

describe("transferPlan — Madar (LYD unscaled, ≤20 per transfer)", () => {
  it("R154 acceptance table — exact codes, never scaled", () => {
    // The preset 10 must generate the unscaled 10, not a ×1000 value.
    expect(transferPlan("madar", 10)?.installments.map((i) => i.code)).toEqual([
      `*140*4*1*10*${RECEIVER_PHONE}#`,
    ]);
    expect(transferPlan("madar", 20)?.installments.map((i) => i.code)).toEqual([
      `*140*4*1*20*${RECEIVER_PHONE}#`,
    ]);
    // 40 → 20 + 20
    expect(transferPlan("madar", 40)?.installments.map((i) => i.code)).toEqual([
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
    ]);
    // 50 → 20 + 20 + 10
    expect(transferPlan("madar", 50)?.installments.map((i) => i.code)).toEqual([
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*10*${RECEIVER_PHONE}#`,
    ]);
    // 100 → five transfers of 20
    expect(transferPlan("madar", 100)?.installments.map((i) => i.code)).toEqual([
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
      `*140*4*1*20*${RECEIVER_PHONE}#`,
    ]);
  });

  it("boundary values around the 20 limit", () => {
    expect(transferPlan("madar", 21)?.installments.map((i) => i.amount)).toEqual([20, 1]);
    expect(transferPlan("madar", 19)?.installments).toHaveLength(1);
    expect(transferPlan("madar", 41)?.installments.map((i) => i.amount)).toEqual([20, 20, 1]);
  });
});

describe("transferPlan — invalid input never yields a fictitious code", () => {
  it("rejects non-positive / invalid / fractional-rounding inputs with null", () => {
    expect(transferPlan("libyana", 0)).toBeNull();
    expect(transferPlan("madar", 0)).toBeNull();
    expect(transferPlan("libyana", -5)).toBeNull();
    expect(transferPlan("libyana", "abc")).toBeNull();
    expect(transferPlan("madar", "")).toBeNull();
  });

  it("ROUNDS fractional amounts to the nearest whole dinar (was floor)", () => {
    // 24.9 must plan 25 — flooring back to 24 would recreate the
    // code-vs-submitted mismatch the form-level snap closes.
    expect(transferPlan("libyana", "24.9")?.installments[0]?.amount).toBe(25);
    expect(transferPlan("madar", "0.6")?.installments[0]?.amount).toBe(1);
  });
});

describe("module vocabulary", () => {
  it("exposes the per-transfer limits the UI and tests key off", () => {
    expect(TRANSFER_LIMITS).toEqual({ libyana: 50, madar: 20 });
  });

  it("encodes the USSD hash for tel: URLs", () => {
    expect(transferCodeTelHref("*122*218913456789*25000*1#")).toBe(
      "tel:*122*218913456789*25000*1%23",
    );
  });
});
