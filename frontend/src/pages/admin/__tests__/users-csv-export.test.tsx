/**
 * R126-L3 (A2-3) — the users CSV export's cell quoting.
 *
 * `exportUsersCSV` embeds grouped currency strings (formatCurrency →
 * "1,234.50 د.ل") into a comma-joined CSV. Until this round the join
 * was BARE — `r.join(",")` with no quoting — so any wallet balance or
 * lifetime spend ≥ 1,000 LYD split its cell in two and shifted every
 * field after it for that row: a mid-table column shift that silently
 * mis-attributes money in the offline export.
 *
 * Every cell now rides `csvCell` (RFC-4180): wrapped in double quotes,
 * embedded quotes doubled. These unit tests pin:
 *
 *   1. The exact regression shape — formatCurrency's grouped output
 *      for a ≥1,000 balance stays ONE quoted cell, never a bare
 *      comma-joined fragment.
 *   2. Plain cells (phone, counts) are quoted harmlessly.
 *   3. Embedded double quotes are escaped by doubling (RFC-4180 §2.7).
 *   4. A full assembled row keeps its 7-column shape — the header
 *      count and the row's quoted-cell count agree.
 */

import { describe, expect, it } from "vitest";
// R128 (B3-F2): csvCell moved to lib/csv.ts (the security exports rode a
// quote-only twin) and gained the formula-injection guard — pinned in
// lib/__tests__/csv.test.ts; this file keeps the users-export quoting
// regressions.
import { csvCell } from "@/lib/csv";
import { formatCurrency } from "@/lib/utils";

describe("csvCell — RFC-4180 quoting for the users export (A2-3)", () => {
  it("keeps a grouped currency string (≥1,000 LYD) as ONE cell — the A2-3 regression shape", () => {
    // The exact string the old bare join split across two columns.
    const grouped = formatCurrency(1234.5);
    expect(grouped).toContain(","); // the embedded ASCII comma is real
    const cell = csvCell(grouped);
    // Wrapped + the comma survives INSIDE the quotes — a CSV reader
    // parses it back as a single field.
    expect(cell).toBe(`"${grouped}"`);
    expect(cell.split('","').length).toBe(1);
  });

  it("quotes plain cells (phones, counts, Arabic headers) harmlessly", () => {
    expect(csvCell("0913456789")).toBe('"0913456789"');
    expect(csvCell(150)).toBe('"150"');
    expect(csvCell("الرصيد")).toBe('"الرصيد"');
    expect(csvCell("")).toBe('""');
  });

  it("doubles embedded double quotes (RFC-4180 §2.7)", () => {
    expect(csvCell('قال "تسوية" هنا')).toBe('"قال ""تسوية"" هنا"');
  });

  it("an assembled row keeps its 7-column shape — header and row agree", () => {
    const headers = [
      "رقم الهاتف",
      "الرصيد",
      "المستوى",
      "النقاط",
      "الإجمالي المنفق",
      "الطلبات",
      "تاريخ التسجيل",
    ];
    // The A2-3 money case: BOTH currency columns cross the 1,000-LYD
    // grouping threshold that used to shift the row.
    const row = [
      "0913456789",
      formatCurrency(1234.5),
      "برونزي",
      150,
      formatCurrency(2345.75),
      2,
      "2026-08-01",
    ];
    // The page's assembly: every cell quoted, joined by one comma.
    const headerLine = headers.map(csvCell).join(",");
    const rowLine = row.map(csvCell).join(",");
    // A minimal RFC-4180 reader: quoted fields, doubled quotes —
    // the line must parse back to exactly the 7 fields that went in.
    const parseLine = (line: string) => {
      const fields: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        }
      }
      fields.push(current);
      return fields;
    };
    expect(parseLine(headerLine)).toEqual(headers);
    expect(parseLine(rowLine)).toEqual([
      "0913456789",
      formatCurrency(1234.5),
      "برونزي",
      "150",
      formatCurrency(2345.75),
      "2",
      "2026-08-01",
    ]);
  });
});
