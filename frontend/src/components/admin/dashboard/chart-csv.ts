import type { ChartDay } from "./chart-data";

// R137 (FE admin decomposition): the dashboard's CSV export moved verbatim
// from pages/admin/dashboard.tsx — pure, React-free. The INVOCATION stays
// in the page (the export handler owns which series/period it exports);
// this module is the byte-minting implementation the page imports by name
// (the checkout-unit-key.ts r136 idiom — never duplicated inline).

/** R120-B5 (A5-F13): the money columns in the CSV export render in
 *  formatCurrency's underlying en-US 2-decimal shape — but WITHOUT the
 *  " د.ل" suffix (CSV cells stay numeric) and WITHOUT grouping: the
 *  rows join on ",", so a grouped "1,234.50" would split into two
 *  columns. Same digits as every money tile, CSV-parse-safe. */
const CSV_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function exportChartCSV(data: ChartDay[], days: number) {
  const headers = [
    "التاريخ",
    "الطلبات",
    "الإيرادات",
    "الخصومات",
    "طلبات بكوبون",
    "المستخدمون الجدد",
  ];
  const rows = data.map((d) => [
    d.date,
    d.orders,
    CSV_DECIMAL_FORMATTER.format(d.revenue ?? 0),
    CSV_DECIMAL_FORMATTER.format((d.discounts ?? 0) || 0),
    d.coupon_orders || 0,
    d.users,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chart_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
