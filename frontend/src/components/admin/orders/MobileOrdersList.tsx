import { MobileOrderCard } from "@/components/admin/orders/MobileOrderCard";
import type { AdminOrderRow, OrderCredentials } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the mobile
// card list. Same contract as the desktop table twin: the selection /
// expansion / credentials state and the two useCallback toggles are
// page-owned and flow down as props (MobileOrderCard rides along inside
// its consumer). The move only changes the address; DOM and classes are
// byte-identical.

export function MobileOrdersList({
  filtered,
  selectedIds,
  expandedRow,
  credentialsCache,
  failedCredentialIds,
  onToggleSelect,
  onToggleExpand,
}: {
  filtered: AdminOrderRow[];
  selectedIds: Set<number>;
  expandedRow: number | null;
  credentialsCache: Map<number, OrderCredentials>;
  failedCredentialIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
}) {
  return (
    <div className="md:hidden space-y-2">
      {filtered.map((order) => (
        <MobileOrderCard
          key={order.id}
          order={order}
          isSelected={selectedIds.has(order.id)}
          expanded={expandedRow === order.id}
          creds={credentialsCache.get(order.id)}
          credsFailed={failedCredentialIds.has(order.id)}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}
