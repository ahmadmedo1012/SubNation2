import { csvCell } from "@/lib/csv";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { formatDate, statusLabel } from "@/lib/utils";
import type { AdminOrderRow } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the CSV
// export ritual (pure + DOM-only, React-free — the r136 pure-module
// idiom). The page keeps the exportCSV/exportSelected click handlers
// (they close over the live filtered/selectedIds); this module owns only
// the row builder and the download side effect, both taking explicit
// arguments. The move only changes the address.

// R120-B4 (A2-F18): one CSV download ritual shared by both export
// paths (the two copies were byte-identical except the filename).
// R186 (C-F1): every cell now rides the shared csvCell escaper (RFC-4180
// quoting + the OWASP formula-injection guard — the users-csv convention)
// and the user column rides displayUserName (placeholder tg_/fb_/gh_
// phones never ship in the export; a display name survives instead).
export function downloadCsv(rows: (string | number)[][], filename: string) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function orderCsvRows(list: AdminOrderRow[]): (string | number)[][] {
  const csvHeaders = ["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"];
  return [
    csvHeaders,
    ...list.map((o) => [
      o.order_code ?? "",
      displayUserName(userFromRow(o)),
      o.product_name ?? "",
      o.amount ?? 0,
      statusLabel(o.status),
      o.created_at ? formatDate(o.created_at) : "",
    ]),
  ];
}
