import { CheckSquare, Square } from "lucide-react";
import { formatCount, formatCurrency } from "@/lib/utils";
import { ORDER_COUNT_FORMS } from "@/components/admin/orders/orders-meta";
import { DesktopOrderRow } from "@/components/admin/orders/DesktopOrderRow";
import type { AdminOrderRow, OrderCredentials } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the desktop
// table (the sticky header + the select-all + the R118-B2 memoized row
// map + the honest-counts footer). Selection / expansion / credentials
// state and the toggleSelectAll money-action input stay page-owned —
// every value and callback flows down as props (DesktopOrderCard rides
// along inside its consumer). The move only changes the address; DOM,
// classes and aria are byte-identical.

export function OrdersTable({
  filtered,
  selectedIds,
  expandedRow,
  credentialsCache,
  failedCredentialIds,
  allFilteredSelected,
  onToggleSelectAll,
  onToggleSelect,
  onToggleExpand,
  search,
  knownTotal,
  totalRevenue,
}: {
  filtered: AdminOrderRow[];
  selectedIds: Set<number>;
  expandedRow: number | null;
  credentialsCache: Map<number, OrderCredentials>;
  failedCredentialIds: Set<number>;
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  search: string;
  knownTotal: boolean;
  totalRevenue: number;
}) {
  return (
    <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        {/* R-140-l (semantics): Arabic aria-label — the money directory
            announces WHAT it is (the page's «الطلبات» h1 lives in the
            topbar, one landmark away) instead of a bare «جدول» with 8
            unnamed columns. The family naming idiom (aria-label on
            icon-only controls / role=status regions) extended to the
            real-table register; scope="col" already rode every th. */}
        <table aria-label="جدول الطلبات" className="w-full text-sm">
          <thead>
            {/* R139 (precision): the header band goes solid — the old
                bg-card/85 + supports-backdrop-blur glass pair is r138-
                retired (glass → solid surfaces); bg-muted/30 is the
                admin header-band family (risk-event.tsx / enrichment.tsx
                headers ride it) and the seam joins the /60 hairline
                rhythm the rows below now speak. The th cells already
                carry the quiet treatment (font-semibold + muted ink +
                text-2xs). sticky/z-10 stay byte-identical (z-10 = the
                documented local-stacking layer). */}
            <tr className="sticky top-0 z-10 border-b border-border/60 bg-muted/30">
              {/* 96-F7 (R96 A6 #15): scope="col" so screen readers
                  announce the header↔cell relation on vertical
                  sweeps instead of a bare "خلية". */}
              <th scope="col" className="px-4 py-3 w-8">
                {/* F3-08 (R111 WCAG 1.1.1 + 4.1.2): the icon-only
                    select-all carried no accessible name and no
                    state — the input to the bulk-refund money
                    action was visual-only. */}
                <button
                  onClick={onToggleSelectAll}
                  aria-label="تحديد كل الطلبات المعروضة للإجراء الجماعي"
                  aria-pressed={allFilteredSelected}
                  /* R120-B4 (A2-F13): same p-2 -m-1 hit-area fix
                     as the row selectors. */
                  className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary-text transition-colors"
                >
                  {allFilteredSelected ? (
                    <CheckSquare className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                رقم الطلب
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المستخدم
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المنتج
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                المبلغ
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                الحالة
              </th>
              <th
                scope="col"
                className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
              >
                التاريخ
              </th>
              <th scope="col" className="w-8 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((order, idx: number) => (
              <DesktopOrderRow
                key={order.id}
                order={order}
                idx={idx}
                isSelected={selectedIds.has(order.id)}
                expanded={expandedRow === order.id}
                creds={credentialsCache.get(order.id)}
                credsFailed={failedCredentialIds.has(order.id)}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
              />
            ))}
          </tbody>
        </table>
      </div>
      {/* R139 (precision): receipt rhythm on the money summary band —
          the boundary rule softens /100→/20 (the r138 hairline value;
          stacked on the last row's /60 seam it reads as the terminal
          double-rule of a slip) and tabular-nums rides the whole line:
          the counts and the «مجموع المعروض» sum are digits. Emphasis
          stays weight-only — no color on the amount. */}
      <div className="px-4 py-2.5 border-t border-border/20 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {formatCount(filtered.length, ORDER_COUNT_FORMS)}
          {search && ` · نتائج "${search}"`}
          {/* R125-I2 (A1-10): honest partial-window wording — the
              footer sums the ACCUMULATED pages; «إجمالي» claims a
              total the window can't prove while more pages exist
              (the same honest-counts convention as the header's
              «عرض N» and the coupon panel's caveat). */}
          {filtered.length > 0 &&
            (knownTotal
              ? ` · إجمالي ${formatCurrency(totalRevenue)}`
              : ` · مجموع المعروض ${formatCurrency(totalRevenue)}`)}
        </span>
        <span className="hidden sm:inline text-muted-foreground">
          انقر على الصف لعرض بيانات التسليم
        </span>
      </div>
    </div>
  );
}
