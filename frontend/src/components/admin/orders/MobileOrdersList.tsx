import { FilterTabs } from "@/components/ui/filter-tabs";
import { MobileOrderCard } from "@/components/admin/orders/MobileOrderCard";
import { ORDER_SORT_CHIPS, isOrderSort } from "@/components/admin/orders/orders-meta";
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
  sortBy,
  onSelectSort,
}: {
  filtered: AdminOrderRow[];
  selectedIds: Set<number>;
  expandedRow: number | null;
  credentialsCache: Map<number, OrderCredentials>;
  failedCredentialIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  /** R159: the current ?sort= value — "" (the default) maps to
   * "created_at:desc" for the chip bar because an absent param IS
   * newest-first (the header's «الأحدث أولاً» contract). */
  sortBy: string;
  onSelectSort: (value: string) => void;
}) {
  return (
    <div className="md:hidden space-y-2">
      {/* R159 (orders sort affordance): the mobile control — the desktop
          table's aria-sort headers don't exist in the card layout, so the
          shared FilterTabs chips dialect carries the same whitelist (the
          44px touch floor is baked into the primitive — DESIGN.md
          spacing.touch-target; the users panel's sort chips are the
          label precedent). The state + the ?sort= write-back stay
          page-owned like every other extract callback. */}
      <FilterTabs
        variant="chips"
        ariaLabel="ترتيب الطلبات"
        value={isOrderSort(sortBy) ? sortBy : "created_at:desc"}
        onSelect={onSelectSort}
        items={ORDER_SORT_CHIPS}
      />
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
