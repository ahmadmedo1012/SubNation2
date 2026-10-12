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
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-card/85 supports-[backdrop-filter]:bg-card/65 backdrop-blur-md">
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
                  className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary transition-colors"
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
      <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
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
