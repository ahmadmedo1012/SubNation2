import { describe, expect, it } from "vitest";
import { findTierPriceAnomalies } from "../catalog-quality";

/**
 * R162 (Lane D) — unit coverage for the catalog-quality price-matrix rule.
 *
 * Everything here is a pure function — table-driven and deterministic.
 * The fixtures are VERBATIM from the live catalog (GET
 * https://subnation.ly/api/products/by-slug/<slug>, 2026-10-12) so the
 * suite pins the rule against the real shapes it must classify:
 *   - Ahrefs is the LIVE defect that motivated the rule (Standard-annual
 *     and Advanced-annual both 15,980 LYD while monthly orders them
 *     3,980 < 5,980);
 *   - Sling Orange/Blue and cPanel VPS/Dedicated price their tiers
 *     identically at EVERY duration — vendor-legitimate (Sling Orange
 *     and Blue officially cost the same $45.99/mo) and must NOT be
 *     flagged: the no-false-positive guarantee is part of the contract.
 */

// ── Live fixtures (values verbatim from by-slug/<slug> 2026-10-12) ─────────

const AREFS_LIVE = [
  { plan_label: "لايت", duration_label: "شهري", price: 1980 },
  { plan_label: "قياسي", duration_label: "شهري", price: 3980 },
  { plan_label: "متقدم", duration_label: "شهري", price: 5980 },
  { plan_label: "لايت", duration_label: "سنوي", price: 11980 },
  { plan_label: "قياسي", duration_label: "سنوي", price: 15980 },
  { plan_label: "متقدم", duration_label: "سنوي", price: 15980 },
] as const;

const SLING_LIVE = [
  { plan_label: "أورانج", duration_label: "شهر واحد", price: 399.8 },
  { plan_label: "بلو", duration_label: "شهر واحد", price: 399.8 },
  { plan_label: "بلو + أورانج", duration_label: "شهر واحد", price: 499.8 },
  { plan_label: "أورانج", duration_label: "3 أشهر", price: 699.8 },
  { plan_label: "بلو", duration_label: "3 أشهر", price: 699.8 },
  { plan_label: "أورانج", duration_label: "6 أشهر", price: 1199.8 },
  { plan_label: "بلو", duration_label: "6 أشهر", price: 1199.8 },
  { plan_label: "بلو + أورانج", duration_label: "3 أشهر", price: 1399.8 },
  { plan_label: "أورانج", duration_label: "سنة كاملة", price: 1999.8 },
  { plan_label: "بلو", duration_label: "سنة كاملة", price: 1999.8 },
  { plan_label: "بلو + أورانج", duration_label: "6 أشهر", price: 2580 },
  { plan_label: "بلو + أورانج", duration_label: "سنة كاملة", price: 4980 },
] as const;

const CPANEL_LIVE = [
  { plan_label: "VPS", duration_label: "شهر واحد", price: 99.8 },
  { plan_label: "خادم مخصص", duration_label: "شهر واحد", price: 99.8 },
  { plan_label: "VPS", duration_label: "سنة كاملة", price: 980 },
  { plan_label: "خادم مخصص", duration_label: "سنة كاملة", price: 980 },
  { plan_label: "VPS", duration_label: "مدى الحياة", price: 5980 },
  { plan_label: "خادم مخصص", duration_label: "مدى الحياة", price: 5980 },
] as const;

const DISNEY_LIVE = [
  { plan_label: "أساسي", duration_label: "شهر واحد", price: 79.8 },
  { plan_label: "بريميوم", duration_label: "شهر واحد", price: 119.8 },
  { plan_label: "أساسي", duration_label: "3 أشهر", price: 199.8 },
  { plan_label: "بريميوم", duration_label: "3 أشهر", price: 299.8 },
  { plan_label: "أساسي", duration_label: "6 أشهر", price: 339.8 },
  { plan_label: "بريميوم", duration_label: "6 أشهر", price: 539.8 },
  { plan_label: "أساسي", duration_label: "سنة كاملة", price: 599.8 },
  { plan_label: "بريميوم", duration_label: "سنة كاملة", price: 999.8 },
] as const;

const NETFLIX_LIVE = [
  { plan_label: null, duration_label: "شهر واحد", price: 79.8 },
  { plan_label: null, duration_label: "3 أشهر", price: 199.8 },
  { plan_label: null, duration_label: "6 أشهر", price: 339.8 },
  { plan_label: null, duration_label: "سنة كاملة", price: 599.8 },
] as const;

const STORAGE_LIVE = [
  { plan_label: "500 جيجابايت", duration_label: null, price: 980 },
  { plan_label: "1 تيرابايت", duration_label: null, price: 1980 },
  { plan_label: "غير محدود", duration_label: null, price: 2980 },
] as const;

describe("findTierPriceAnomalies (R162 Lane D)", () => {
  it("flags the live Ahrefs defect: Standard-annual == Advanced-annual while monthly orders them apart", () => {
    expect(findTierPriceAnomalies(AREFS_LIVE)).toEqual([
      {
        kind: "equalized",
        planA: "قياسي",
        planB: "متقدم",
        duration: "سنوي",
        price: 15980,
      },
    ]);
  });

  it("does NOT flag Sling Orange/Blue — equal at every duration is the vendor-official pattern", () => {
    expect(findTierPriceAnomalies(SLING_LIVE)).toEqual([]);
  });

  it("does NOT flag cPanel VPS/Dedicated — equal at every duration is internally consistent", () => {
    expect(findTierPriceAnomalies(CPANEL_LIVE)).toEqual([]);
  });

  it("does not flag strictly-ordered tiers (Disney+ Standard < Premium at all durations)", () => {
    expect(findTierPriceAnomalies(DISNEY_LIVE)).toEqual([]);
  });

  it("returns [] for tierless duration-only products (Netflix live shape)", () => {
    expect(findTierPriceAnomalies(NETFLIX_LIVE)).toEqual([]);
  });

  it("returns [] for plan-axis products without durations (single shared slot — documented limit)", () => {
    expect(findTierPriceAnomalies(STORAGE_LIVE)).toEqual([]);
  });

  it("flags a direction flip (inverted) across durations", () => {
    const inverted = [
      { plan_label: "A", duration_label: "1 شهر", price: 100 },
      { plan_label: "B", duration_label: "1 شهر", price: 200 },
      { plan_label: "A", duration_label: "سنة", price: 900 },
      { plan_label: "B", duration_label: "سنة", price: 800 },
    ];
    expect(findTierPriceAnomalies(inverted)).toEqual([
      {
        kind: "inverted",
        planA: "A",
        planB: "B",
        duration: "سنة",
        priceA: 900,
        priceB: 800,
      },
    ]);
  });

  it("equalizes on the ANCHOR duration only when another duration orders the pair (equalized is about the contradicting slot)", () => {
    // Anchor at 3 أشهر (100 < 200); the equal slot at سنة is the defect.
    const equalized = [
      { plan_label: "A", duration_label: "3 أشهر", price: 100 },
      { plan_label: "B", duration_label: "3 أشهر", price: 200 },
      { plan_label: "A", duration_label: "سنة", price: 500 },
      { plan_label: "B", duration_label: "سنة", price: 500 },
    ];
    expect(findTierPriceAnomalies(equalized)).toEqual([
      { kind: "equalized", planA: "A", planB: "B", duration: "سنة", price: 500 },
    ]);
  });
});
