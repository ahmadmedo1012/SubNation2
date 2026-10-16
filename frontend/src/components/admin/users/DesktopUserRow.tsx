import React from "react";
import { Edit2 } from "lucide-react";
// R125-I4 (A6 B-4): the desktop tier pill rides the canonical
// StatusBadge on the --status-* tokens — tiers are domain levels, so
// the tone map stays LOCAL (the status-badge.tsx:75-78 rule, the
// risk.tsx LEVEL_META idiom) instead of raw cyan/yellow/slate hues
// that collapse to 1.43–2.86:1 on the shipped light theme.
import { StatusBadge } from "@/components/ui/status-badge";
import { displayUserName, displayUserPhone, type AdminUserShape } from "@/lib/admin/user-display";
import { formatCurrency, formatDate, tierLabel } from "@/lib/utils";
import { type AdminUser } from "@workspace/api-client-react";
import { TIER_TONE } from "@/components/admin/users/user-directory-meta";
import { ProviderBadges } from "@/components/admin/users/ProviderBadges";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the desktop directory row (name / provider pills / wallet balance /
// tier badge / points / lifetime spend / orders / registration date /
// the edit trigger). The R124-I5 memoization rides along unchanged;
// `user` + `onEdit` flow down from the table extract, which gets them
// from the page (openEdit is the page-owned callback). The move only
// changes its address; DOM, classes and aria are byte-identical.

/* ── R124-I5 (A6 F4 — the R118-B2 orders.tsx pattern) ──────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered the
 * whole page and recomputed the directory sort inline (100+ rows) plus
 * every row subtree with fresh inline closures (the network debounces at
 * 300ms; the RENDER path did not). The rows are now module-level
 * React.memo components whose props are stable across a keystroke (user
 * refs come from the memoized `users` array; onEdit is useCallback-
 * stable), so typing re-renders the search box and nothing else. */
export interface UserRowProps {
  user: AdminUser;
  onEdit: (user: AdminUser) => void;
}

/** Desktop table row. */
export const DesktopUserRow = React.memo(function DesktopUserRow({
  user,
  idx,
  onEdit,
}: UserRowProps & { idx: number }) {
  return (
    <tr
      /* R139 (precision): the row register (the r138-e cart line-data
         precedent, the DesktopOrderRow twin) — seams step /30→/60
         (matching the header seam above; one hairline rhythm per table)
         and hover calms to a bg-muted/30 wash with NO elevation. The
         zebra wash and the memo bail-out contract are untouched. NO
         selected state exists in this table (rows are action-per-row
         via the edit pencil, not selectable) — nothing to migrate. */
      className={`border-b border-border/60 transition-colors hover:bg-muted/30 ${idx % 2 !== 0 ? "bg-muted/[0.035]" : ""}`}
    >
      <td className="px-4 py-2.5 font-mono font-bold text-sm">
        {displayUserName(user as unknown as AdminUserShape)}
        {/* R154 (P3-D): the REAL phone when the channel provided one —
            «لا يوجد رقم هاتف مرتبط» for placeholder phones (tg_/f_),
            with the Telegram identity line beside it. */}
        <div className="font-sans font-normal text-2xs text-muted-foreground mt-0.5">
          {displayUserPhone(user as unknown as AdminUserShape)}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <ProviderBadges user={user as unknown as Record<string, unknown>} />
      </td>
      <td className="px-4 py-2.5 font-bold text-primary-text tabular-nums">
        {/* R125-I2 (A6-B6): money cell — raw --primary on a dark card is
         * 3.76:1 (under the 4.5:1 text floor; dark is the admin
         * default). --primary-text is the text-safe variant (5.75:1
         * dark / 5.30 light). R139 (precision): verified the family
         * keeps this ink on table money cells — the orders lane's
         * amount cell rides the identical pair. */}
        {formatCurrency(user.wallet_balance)}
      </td>
      <td className="px-4 py-2.5">
        {/* R125-I4 (A6 B-4 + B-6): StatusBadge on the status tokens
            (light-theme AA) + text-primary-text on the money cell
            (5.75:1 dark vs raw text-primary's 3.76:1). */}
        <StatusBadge variant={TIER_TONE[user.loyalty_tier] ?? "neutral"} size="sm">
          {tierLabel(user.loyalty_tier)}
        </StatusBadge>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-sm">{user.loyalty_points}</td>
      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
        {formatCurrency(user.lifetime_spend)}
      </td>
      <td className="px-4 py-2.5 tabular-nums font-semibold">{user.order_count}</td>
      <td className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums">
        {user.created_at ? formatDate(user.created_at) : "—"}
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onEdit(user)}
          aria-label={`تعديل المستخدم ${displayUserName(user as unknown as AdminUserShape)}`}
          /* 93-C6 / F-07 (A5 S-6): p-1.5 ≈ 28px target —
             p-2 + min sizes lift the tappable area for
             the 375px admin layout. */
          className="p-2 min-w-9 min-h-9 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
});
