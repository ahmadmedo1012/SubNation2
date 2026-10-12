import { TableSkeleton } from "@/components/admin/TableSkeleton";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the directory's loading skeleton (the shared admin TableSkeleton
// wrapped with the users table's cell shapes). Renamed
// TableSkeleton → UsersTableSkeleton so the page's import can't be
// confused with the shared component it wraps. The move only changes
// its address; DOM and classes are byte-identical.

export function UsersTableSkeleton() {
  return (
    <TableSkeleton
      rows={6}
      cells={[
        "w-28 shrink-0",
        "w-16 shrink-0",
        "rounded-full w-14 shrink-0",
        "w-12 shrink-0",
        "flex-1 w-16",
        "w-8 shrink-0",
        "w-20 shrink-0",
        "w-7 shrink-0",
      ]}
    />
  );
}
