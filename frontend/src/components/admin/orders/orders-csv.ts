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
export function downloadCsv(rows: (string | number)[][], filename: string) {
  const csv = rows.map((r) => r.join(",")).join("\n");
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
      o.user_phone ?? "",
      (o.product_name ?? "").replace(/,/g, "؛"),
      o.amount ?? 0,
      statusLabel(o.status),
      o.created_at ? formatDate(o.created_at) : "",
    ]),
  ];
}
