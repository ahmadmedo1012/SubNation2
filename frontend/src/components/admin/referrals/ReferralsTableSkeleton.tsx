import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the table's page-shaped loading skeleton (the shared TableSkeleton
// primed with the referral column geometry). The loading atom stays in
// the page; this shell owns no state. The move only changes its address;
// the rendered DOM is byte-identical.

export function ReferralsTableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={6}
      cells={["w-28", "w-28", "rounded-full w-14", "flex-1 w-24", "w-16"]}
    />
  );
}
