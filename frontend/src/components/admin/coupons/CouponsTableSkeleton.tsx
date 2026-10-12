import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";

// R137 (FE decomposition): extracted verbatim from pages/admin/coupons.tsx —
// the table's page-shaped loading skeleton (the shared TableSkeleton
// primed with the coupon column geometry). The loading atom stays in the
// page; this shell owns no state. The move only changes its address; the
// rendered DOM is byte-identical.

export function CouponsTableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={5}
      cells={[
        "w-24",
        "rounded-full w-16 shrink-0",
        "w-16 shrink-0",
        "flex-1 w-20",
        "w-14 shrink-0",
        "w-16 shrink-0",
      ]}
      zebra={false}
    />
  );
}
