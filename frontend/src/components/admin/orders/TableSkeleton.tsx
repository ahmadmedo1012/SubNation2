import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the list's
// loading skeleton (7 rows × the orders column widths). Stateless by
// contract: no values flow down, nothing to call back. The move only
// changes the address; DOM and classes are byte-identical.

export function TableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={7}
      cells={[
        "w-24 shrink-0",
        "w-28",
        "flex-1",
        "w-16 shrink-0",
        "rounded-full w-14 shrink-0",
        "w-20 shrink-0",
      ]}
    />
  );
}
