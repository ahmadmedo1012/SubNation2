import { describe, expect, it } from "vitest";
import { LIBYAN_PHONE_PREFIXES, normalizeLibyanPhone } from "../crypto";

/**
 * 96-F1 (R96-A4 §3.2) — Libyan phone normalization accepts the
 * international paste forms Libyans actually copy from contacts /
 * WhatsApp profiles. Before the fix, only the bare 9-digit local form
 * and the 09x trunk form validated — pasting +218 91 345 6789 (or the
 * 00218 variant) failed with «رقم الهاتف غير صالح» on the auth path
 * (the frontend digit-strip truncated it to 2189134567).
 */
describe("normalizeLibyanPhone — international prefix forms (96-F1 §3.2)", () => {
  it.each([
    // The canonical local forms (pre-existing behavior — must not regress).
    ["913456789", "913456789"],
    ["0913456789", "913456789"],
    ["92 345 6789", "923456789"],
    ["092-345-6789", "923456789"],
    // 96-F1: the international paste forms.
    ["+218913456789", "913456789"],
    ["+218 91 345 6789", "913456789"],
    ["00218913456789", "913456789"],
    ["00218 91 345 6789", "913456789"],
    ["218913456789", "913456789"],
    ["218 92 345 6789", "923456789"],
    ["218933456789", "933456789"],
    ["218943456789", "943456789"],
    // 00 + 218 + trunk-prefixed local (double-form paste).
    ["002180913456789", "913456789"],
    // B5-6 (R111): Arabic-Indic digits fold to ASCII BEFORE validation
    // (defense-in-depth — the SPA already converts on the client).
    ["٠٩١٣٤٥٦٧٨٩", "913456789"],
    ["٩١٣٤٥٦٧٨٩", "913456789"],
    ["+٢١٨ ٩١ ٣٤٥ ٦٧٨٩", "913456789"],
    ["٠٠٢١٨٩١٣٤٥٦٧٨٩", "913456789"],
    // Mixed ASCII + Arabic-Indic paste (partially converted client).
    ["091٣٤٥٦٧٨٩", "913456789"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeLibyanPhone(raw)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["+218", "country code only"],
    ["218", "bare country code"],
    ["91345678", "8 digits — truncated"],
    ["9134567890", "10 digits starting 9 — truncated international"],
    ["21891345678", "truncated international (11 digits)"],
    ["123456789", "valid length, non-Libyan prefix"],
    ["09334567890", "trunk + 10 digits"],
    // B5-6 (R111): Arabic-Indic digits now FOLD to ASCII — a folded
    // phone must still pass the SAME prefix/length validation (a
    // non-Libyan prefix or wrong length in ٠-٩ stays a rejection).
    ["١٢٣٤٥٦٧٨٩", "Arabic-Indic digits, valid length, non-Libyan prefix"],
    ["٠٩١٣٤٥٦٧٨", "Arabic-Indic digits, truncated (8 digits)"],
  ])("rejects %s (%s)", (raw) => {
    expect(normalizeLibyanPhone(raw)).toBeNull();
  });

  it("LIBYAN_PHONE_PREFIXES stay the 91-94 mobile prefixes", () => {
    expect(LIBYAN_PHONE_PREFIXES).toEqual(["91", "92", "93", "94"]);
  });
});
