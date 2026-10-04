/**
 * R116-S2 (P2) — whole-dinar USSD transfer codes.
 *
 * The Libyana/Madar USSD formats can only carry WHOLE dinars — the
 * networks floor (and the wallet form previously allowed 0.5-steps), so
 * a "25.5" topup dialed `*122*…*25*1#` while the request submitted 25.5:
 * a guaranteed transfer-code ↔ submitted-amount mismatch on every
 * fractional topup. The generator now ROUNDS the amount to the nearest
 * whole dinar (mirroring the form's blur/submit Math.round snap) so the
 * dialed code and the submitted amount can never disagree.
 */

import { describe, expect, it } from "vitest";
import { RECEIVER_PHONE, transferCode, transferCodeTelHref } from "@/lib/transfer-code";

describe("transferCode — whole-dinar normalization (R116-S2)", () => {
  it("renders the Libyana code with the international receiver + whole amount", () => {
    expect(transferCode("libyana", 25, "0913456789")).toBe("*122*218913456789*25*1#");
  });

  it("renders the Madar code with the local receiver + whole amount", () => {
    expect(transferCode("madar", "30", "0913456789")).toBe("*140*4*1*30*0913456789#");
  });

  it("ROUNDS fractional amounts to the nearest whole dinar (was floor)", () => {
    // 24.9 must dial 25 — flooring it back to 24 would recreate the
    // code-vs-submitted mismatch the form-level snap just closed.
    expect(transferCode("libyana", "24.9")).toBe("*122*218913456789*25*1#");
    expect(transferCode("libyana", "0.6")).toBe("*122*218913456789*1*1#");
  });

  it("rejects non-positive / invalid amounts with null", () => {
    expect(transferCode("libyana", 0)).toBeNull();
    expect(transferCode("libyana", "-5")).toBeNull();
    expect(transferCode("libyana", "abc")).toBeNull();
    expect(transferCode("libyana", "")).toBeNull();
  });

  it("falls back to the registered receiver constant", () => {
    expect(transferCode("madar", 5)).toBe(`*140*4*1*5*${RECEIVER_PHONE}#`);
  });

  it("encodes the USSD hash for tel: URLs", () => {
    expect(transferCodeTelHref("*122*218913456789*25*1#")).toBe(
      "tel:*122*218913456789*25*1%23",
    );
  });
});
