import React from "react";
import { Edit2 } from "lucide-react";
import { displayUserName, type AdminUserShape } from "@/lib/admin/user-display";
import { formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import { type UserRowProps } from "@/components/admin/users/DesktopUserRow";
import { ProviderBadges } from "@/components/admin/users/ProviderBadges";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the mobile directory card (name / provider pills / tier · order count /
// wallet balance / points / the edit trigger). The R124-I5 memoization
// rides along unchanged; `user` + `onEdit` flow down from the page
// (openEdit is the page-owned callback). The move only changes its
// address; DOM, classes and aria are byte-identical.

/** Mobile card. */
export const MobileUserCard = React.memo(function MobileUserCard({ user, onEdit }: UserRowProps) {
  return (
    <div
      /* R139 (precision): the mobile card joins the row register (the
         MobileOrderCard twin) — hover is the border step ONLY (the old
         hover shadow lifted a line-data card; rows are not tiles) and
         the transition narrows to the colors it actually animates. The
         resting /60 edge + float-in entrance stay byte-identical. */
      className="float-in bg-card border border-border/60 rounded-2xl p-4 flex items-center gap-3 hover:border-border transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono font-bold text-sm truncate">
          {displayUserName(user as unknown as AdminUserShape)}
        </div>
        <div className="mt-1">
          <ProviderBadges user={user as unknown as Record<string, unknown>} />
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          <span className={tierColor(user.loyalty_tier)}>{tierLabel(user.loyalty_tier)}</span>
          <span>·</span>
          <span>{user.order_count} طلب</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold text-primary-text tabular-nums text-sm">
          {formatCurrency(user.wallet_balance)}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{user.loyalty_points} نقطة</div>
      </div>
      <button
        onClick={() => onEdit(user)}
        /* R123 (E3 P3b): the mobile twin of the desktop edit
           button — same accessible name so screen readers
           announce the same action in both layouts. */
        aria-label={`تعديل المستخدم ${user.phone ?? ""}`}
        className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
      >
        <Edit2 className="w-4 h-4" />
      </button>
    </div>
  );
});
