import { describe, expect, it, vi } from "vitest";
import { generateOrderCode, generateReferralCode } from "../crypto";

/**
 * R123 (E1, test battery) — identifier formats on the money path.
 *
 * generateOrderCode (F9, round-94 A4): 48 bits of CSPRNG behind the
 * "SN" prefix — 2^32 (the old 32-bit space) hit ≥1.2% birthday-collision
 * odds at ~10k orders and the first collision surfaced as an
 * unclassified 23505 → raw 500 on the purchase path. Pin the exact
 * shape the orders.order_code UNIQUE column relies on.
 *
 * generateReferralCode: 4 CSPRNG bytes as 8 uppercase hex chars — the
 * users.referral_code UNIQUE surface. 10k draws must be collision-free
 * (the empirical sanity bound for a 32-bit space before the birthday
 * bound gets uncomfortable).
 *
 * R147 (CI run 38643037119 — the flake root-cause): that collision-free
 * leg measured the RNG's birthday luck, not the function — a 16^8 space
 * at 10k draws carries ~1.2% collision odds PER RUN and the CI push run
 * rolled exactly that (seen.size 9,999, one birthday pair). randomBytes
 * is node's responsibility; the FUNCTION's contract is "distinct inputs
 * → valid, distinct, uppercase-hex codes". The counter mock below feeds
 * a deterministic distinct stream through the real function, so both
 * legs keep their full intent (exact format + injectivity of the hex
 * encoding) with zero statistical flake.
 */
let draw = 0;
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    // Distinct 4-byte tail per call — injective for both generator sizes
    // (4-byte referral codes, 6-byte order codes) over the suite's draw
    // counts. Sizes < 4 would write out of bounds; no call site in this
    // file's graph uses one (both generators hardcode 4 and 6).
    randomBytes: (size: number) => {
      const buf = Buffer.alloc(size);
      buf.writeUInt32BE(draw++ >>> 0, Math.max(0, size - 4));
      return buf;
    },
  };
});
describe("generateOrderCode", () => {
  it("matches /^SN[0-9A-F]{12}$/ (48-bit uppercase hex body) over 200 draws, no repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateOrderCode();
      expect(code).toMatch(/^SN[0-9A-F]{12}$/);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });
});

describe("generateReferralCode", () => {
  it("is 8 uppercase hex chars and collision-free over 10k draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[0-9A-F]{8}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(10_000);
  });
});
