import React from "react";
import { CheckSquare, ChevronDown, Square } from "lucide-react";
import { formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { MaskedCredential } from "@/components/admin/orders/MaskedCredential";
import type { OrderRowProps } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the desktop
// table row (the visible <tr> + its credentials expansion <tr>). The
// R118-B2 memoization rides along: the component stays a module-level
// React.memo so a keystroke re-renders the search box and NOTHING else.
// Every input is a prop (order / isSelected / expanded / creds /
// credsFailed + the two page-owned useCallback toggles) — no state of
// its own, no duplicated truth. The move only changes the address; DOM,
// classes and aria are byte-identical.

/** Desktop table row: the visible <tr> plus its expansion <tr>. */
export const DesktopOrderRow = React.memo(function DesktopOrderRow({
  order,
  idx,
  isSelected,
  expanded,
  creds,
  credsFailed,
  onToggleSelect,
  onToggleExpand,
}: OrderRowProps) {
  return (
    <React.Fragment>
      <tr
        /* R139 (precision): the row register (the r138-e cart
           line-data precedent — rows are line data, not tiles):
           seams step /30→/60 (the table's hairline rhythm, matching
           the header seam), hover calms to a bg-muted/30 wash with
           NO elevation, and the selected tint rises /3→/8 — half the
           calm pill's /15, so a persistent selection out-reads the
           zebra while staying a tint, never a primary fill. The zebra
           wash and the memo bail-out contract are untouched. */
        className={`border-b border-border/60 transition-colors hover:bg-muted/30 cursor-pointer group ${
          isSelected ? "bg-primary/8" : (idx ?? 0) % 2 !== 0 ? "bg-muted/[0.035]" : ""
        }`}
      >
        <td className="px-4 py-2.5">
          {/* F3-08 (R111): name + aria-pressed on the row selector (was an
              icon-only button — the selection state feeding the bulk
              refund was visual-only). */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(order.id);
            }}
            aria-label={`تحديد الطلب ${order.order_code} للإجراء الجماعي`}
            aria-pressed={isSelected}
            /* R120-B4 (A2-F13): p-2 -m-1 ≈ 28px hit area (the expand
               chevron's fix) — the ~14px icon-only target fed the bulk
               refund selection on touch devices. */
            className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary-text transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </button>
        </td>
        <td
          className="px-4 py-2.5 font-mono text-xs text-muted-foreground"
          onClick={() => onToggleExpand(order.id)}
        >
          {/* R-140-l (semantics): VERIFIED no dir="ltr" — order codes
              are a pure-ASCII strong-LTR run ("SN" + hex,
              backend crypto.ts generateOrderCode) with NO bidi-neutral
              separators, so the run renders in logical order inside
              the RTL cell and announces as one unit (the scope="col"
              «رقم الطلب» header precedes it in the sweep). The
              storefront chip isolates as belt-and-suspenders; the
              neutral-bearing runs nearby (usernames / IPs in
              AuditTrailTable) DO need dir="ltr" and carry it. */}
          {order.order_code}
        </td>
        <td
          className="px-4 py-2.5 font-mono text-xs font-bold"
          onClick={() => onToggleExpand(order.id)}
        >
          {displayUserName(userFromRow(order))}
        </td>
        <td
          className="px-4 py-2.5 font-semibold text-sm max-w-40 truncate"
          onClick={() => onToggleExpand(order.id)}
        >
          {order.product_name}
        </td>
        <td
          /* R125-I2 (A6-B6): money cell — raw --primary on a dark card is
           * 3.76:1 (under the 4.5:1 text floor; dark is the admin
           * default). --primary-text is the text-safe variant (5.75:1
           * dark / 5.30 light — button.tsx:35-37 documents raw
           * text-primary as surface-only). */
          className="px-4 py-2.5 font-bold text-primary-text text-sm tabular-nums"
          onClick={() => onToggleExpand(order.id)}
        >
          {formatCurrency(order.amount)}
        </td>
        <td className="px-4 py-2.5" onClick={() => onToggleExpand(order.id)}>
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the deprecated
              statusColor() — 93-C7 follow-up. */}
          <StatusBadge
            variant={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="sm"
          >
            {statusLabel(order.status)}
          </StatusBadge>
        </td>
        <td
          className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums"
          onClick={() => onToggleExpand(order.id)}
        >
          {order.created_at ? formatDate(order.created_at) : "—"}
        </td>
        {/* F3-02 (R111 WCAG 2.1.1): the toggle is now a real <button>
            (Enter/Space work natively) with aria-expanded + a state-aware
            accessible name; the other cells keep their onClick for the
            mouse-affordance of tapping anywhere on the row.
            stopPropagation keeps a click on the chevron from
            double-firing the td handler. */}
        <td className="px-4 py-2.5 text-muted-foreground transition-colors">
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
            className="p-1.5 -m-1 rounded-lg text-muted-foreground group-hover:text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10">
          <td
            colSpan={8}
            /* R139 (precision): the expansion's closing seam joins the
               /60 row rhythm (was /30) — one seam value across the
               grid. */
            className="px-4 py-3 border-b border-border/60"
          >
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
              {/* B6-03 (R116): values render from the per-order credentials
                  fetch (the list no longer decrypts) — masking + copy UX
                  unchanged (96-F7). */}
              {order.has_credentials && !creds && !credsFailed && (
                <span className="text-muted-foreground">جارٍ تحميل بيانات التسليم…</span>
              )}
              {order.has_credentials && credsFailed && (
                <span className="text-destructive">تعذّر تحميل بيانات التسليم</span>
              )}
              {/* R117 (A1-P6): raw columns populated but every decrypt
                  null — the operator needs the ENCRYPTION_KEY signal,
                  not a misleading "no data". */}
              {order.has_credentials && creds?.decrypt_failed && (
                <span role="alert" className="text-destructive font-bold">
                  تعذّر فك التشفير — راجع مطابقة ENCRYPTION_KEY مع مفتاح التشفير الأصلي
                </span>
              )}
              {creds?.delivered_email && (
                <MaskedCredential label="البريد" value={creds.delivered_email} />
              )}
              {creds?.delivered_password && (
                <MaskedCredential label="كلمة المرور" value={creds.delivered_password} />
              )}
              {creds?.delivered_extra_details && (
                <div>
                  <span className="text-muted-foreground">تفاصيل: </span>
                  <span>{creds.delivered_extra_details}</span>
                </div>
              )}
              {order.coupon_code && (
                <div>
                  <span className="text-muted-foreground">الكوبون: </span>
                  <span className="font-mono font-bold text-status-success">
                    {order.coupon_code}
                  </span>
                  {(order.discount_amount ?? 0) > 0 && (
                    <span className="text-muted-foreground mr-1">
                      (خصم {formatCurrency(order.discount_amount ?? 0)})
                    </span>
                  )}
                </div>
              )}
              {!order.has_credentials && !creds?.delivered_extra_details && !order.coupon_code && (
                <span className="text-muted-foreground">لا توجد بيانات تسليم</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});
