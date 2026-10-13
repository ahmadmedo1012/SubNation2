import React from "react";
import { CheckSquare, ChevronDown, Square } from "lucide-react";
import { formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { MaskedCredential } from "@/components/admin/orders/MaskedCredential";
import type { OrderRowProps } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the mobile
// card (the list card + its inline expansion). The R118-B2 memoization
// rides along (module-level React.memo, props-only — the desktop row's
// twin contract). The move only changes the address; DOM, classes and
// aria are byte-identical.

/** Mobile card: the list card plus its inline expansion. */
export const MobileOrderCard = React.memo(function MobileOrderCard({
  order,
  isSelected,
  expanded,
  creds,
  credsFailed,
  onToggleSelect,
  onToggleExpand,
}: OrderRowProps) {
  return (
    <div
      /* R139 (precision): the selected tint aligns with the desktop
         row's bg-primary/8 — one selection dialect across both
         layouts (the border-primary/40 edge still does the signaling
         here); the resting /60 → hover /100 border step was already
         the r138 family recipe, left untouched. */
      className={`bg-card border rounded-2xl p-4 cursor-pointer transition-colors ${
        isSelected ? "border-primary/40 bg-primary/8" : "border-border/60 hover:border-border"
      }`}
      onClick={() => onToggleExpand(order.id)}
    >
      <div className="flex items-start gap-2 mb-2">
        {/* F3-08 (R111): same name + aria-pressed fix as the desktop row
            selector. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(order.id);
          }}
          aria-label={`تحديد الطلب ${order.order_code} للإجراء الجماعي`}
          aria-pressed={isSelected}
          /* R120-B4 (A2-F13): same p-2 -m-1 hit-area fix as the desktop
             row selector. */
          className="mt-0.5 p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary-text transition-colors shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-primary" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{order.product_name}</div>
          <div className="font-mono text-xs text-muted-foreground mt-0.5">
            {displayUserName(userFromRow(order))}
          </div>
        </div>
        <div className="text-right shrink-0">
          {/* R125-I2 (A6-B6): money cell — --primary-text (see the desktop
           * row's money-cell note). */}
          <div className="font-bold text-primary-text tabular-nums">
            {formatCurrency(order.amount)}
          </div>
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the
              deprecated statusColor() — 93-C7 follow-up. */}
          <StatusBadge
            variant={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="sm"
            className="mt-1"
          >
            {statusLabel(order.status)}
          </StatusBadge>
        </div>
      </div>
      {/* F3-02 (R111 WCAG 2.1.1): the mobile card was a mouse-only onClick
          div — the meta row is now the keyboard-reachable expand toggle
          (real <button>, Enter/Space native, aria-expanded + state-aware
          name, chevron affordance). The card keeps its onClick so taps
          anywhere still expand. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(order.id);
        }}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `إخفاء بيانات تسليم الطلب ${order.order_code}`
            : `عرض بيانات تسليم الطلب ${order.order_code}`
        }
        /* R139 (precision): card-internal section boundaries (this
           meta rule + the three expansion separators below) soften
           /30→/20 — the r138 receipt hairline value at section
           seams. */
        className="w-full flex items-center gap-2 text-2xs text-muted-foreground border-t border-border/20 pt-2 mt-2 text-right hover:text-foreground transition-colors"
      >
        <span className="font-mono">{order.order_code}</span>
        {order.created_at && (
          <>
            <span>·</span>
            <span>{formatDate(order.created_at)}</span>
          </>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 ms-auto transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded &&
        order.has_credentials &&
        (credsFailed ? (
          <div className="mt-2 pt-2 border-t border-border/20 text-xs text-destructive">
            تعذّر تحميل بيانات التسليم
          </div>
        ) : creds ? (
          <div className="mt-2 pt-2 border-t border-border/20 space-y-1.5">
            {creds.delivered_email && (
              <MaskedCredential label="البريد" value={creds.delivered_email} />
            )}
            {creds.delivered_password && (
              <MaskedCredential label="كلمة المرور" value={creds.delivered_password} />
            )}
            {creds.decrypt_failed && (
              /* R117 (A1-P6): mobile card parity — the decrypt-failure
                 signal must reach the phone too, not just the desktop
                 row. */
              <span role="alert" className="text-xs text-destructive font-bold">
                تعذّر فك التشفير — راجع مطابقة ENCRYPTION_KEY مع مفتاح التشفير الأصلي
              </span>
            )}
            {!creds.delivered_email && !creds.delivered_password && !creds.decrypt_failed && (
              <span className="text-xs text-muted-foreground">لا توجد بيانات تسليم</span>
            )}
          </div>
        ) : (
          <div className="mt-2 pt-2 border-t border-border/20 text-xs text-muted-foreground">
            جارٍ تحميل بيانات التسليم…
          </div>
        ))}
    </div>
  );
});
