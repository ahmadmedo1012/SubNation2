import { Link } from "wouter";
import { CheckCircle, ChevronLeft, Clock, Tag, Undo2, XCircle } from "lucide-react";
import { formatCurrency, formatDateShort, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import type { Order } from "@workspace/api-client-react";

/**
 * R167 (F11, wave 2) — verbatim extract from pages/orders.tsx: the
 * orders-list row card (the ~200-line headline cut the R166 audit's
 * F11 deferred behind the source-pin re-point). STAGGER,
 * StatusIcon and statusAccentBorder moved WITH the row — they have no
 * other consumer. The page owns WHICH rows render (the accumulating
 * query, the buckets, the ?filter= mirror) and WHICH index starts a
 * cluster run; this row renders exactly the order + position it is
 * handed.
 *
 * Presentational by contract (the R137 extract idiom): values in, no
 * state, no effects. Rendered DOM byte-identical — pinned by
 * orders-load-more / orders-filter-url / orders-error-state /
 * orders-group-clustering-r165 / order-refund-receipt (render) + the
 * R167 orders decomposition pin (source; the image/semantics/visual
 * suites read the page ∪ this extract).
 */

const STAGGER = [
  "",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
  "stagger-7",
  "stagger-8",
  "stagger-9",
  "stagger-10",
  "stagger-11",
  "stagger-12",
];

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-3.5 h-3.5 text-status-success" />;
  // R115-I1 (A8 P2-3): refunded is NOT a failure — the money came back.
  // The old red XCircle on a refunded row (while its status pill is BLUE
  // status-info via statusColor) read as a failed purchase; the calm
  // info tone + undo glyph now match the pill (utils.ts statusLabel
  // «مُسترد» / statusColor status-info).
  if (status === "refunded") return <Undo2 className="w-3.5 h-3.5 text-status-info" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-status-error" />;
  return <Clock className="w-3.5 h-3.5 text-status-warning" />;
}

function statusAccentBorder(status: string): string {
  // 93-C5 / F-15 (A4 #4): the card mixes a LOGICAL width (border-s-[3px] =
  // right edge in RTL) with a PHYSICAL color (border-l-* = left edge) —
  // the status tint landed on the opposite 1px edge, leaving a neutral
  // 3px bar and an effectively invisible status accent for every RTL
  // user (i.e. everyone). One system now: physical border-r-* on BOTH,
  // matching support.tsx's ticket-card idiom (border-r-[3px] +
  // border-r-blue-500/55).
  // R115-I1 (A8 P2-3): refunded carries the info accent — matches the
  // pill + icon instead of the error red it used to share with failed.
  if (status === "completed") return "border-r-status-success/55";
  if (status === "refunded") return "border-r-status-info/55";
  if (status === "failed") return "border-r-status-error/55";
  return "border-r-status-warning/45";
}

export function OrderRow({ order, index }: { order: Order; index: number }) {
  const staggerClass = STAGGER[Math.min(index, 12)] ?? "";
  return (
    <Link href={`/orders/${order.order_code}`}>
      <div
        className={`
                  float-in ${staggerClass}
                  bg-card border border-border/60 border-r-[3px] ${statusAccentBorder(order.status)}
                  rounded-xl p-4
                  card-spring hover:border-border hover:shadow-xl
                  cursor-pointer group
                `}
      >
        {/* R139 (precision): the card's hand-rolled hover lift
                      (hover:-translate-y-0.5 + transition-all + the
                      active: overrides) is replaced by the family's
                      unified .card-spring — the exact ProductCard recipe
                      (one sanctioned spring: hover lift + active press,
                      border step + the calm neutral xl elevation;
                      R157-C retired the hover black/25 color override
                      for the bare themed hover:shadow-xl
                      (the theme ladder's .light step stays inside the
                      6–14% ceiling). The status accent edge + StatusBadge tokens
                      are untouched (pinned by order-refund-receipt). */}
        <div className="flex items-center gap-3.5">
          {/* Product image */}
          <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
            {order.product_image_url ? (
              <img
                src={order.product_image_url}
                alt={order.product_name}
                loading="lazy"
                decoding="async"
                /* R-140-a (image discipline): width/height
                             mirror the catalog art's measured 450×450
                             intrinsic (all 45 /products/*.webp, the
                             R132 L4-F9 census re-probed this round) —
                             the fixed w-12 h-12 well already pins CLS
                             at zero; the attrs keep the aspect-ratio
                             reserve honest pre-CSS. */
                width={450}
                height={450}
                className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-200"
              />
            ) : (
              /* R125-I7 (A7 B-6 class, computed): sibling of the
                           cart fallback — text-primary/50 measured
                           1.65:1 dark / 2.35:1 light on the muted/60
                           tile; full --muted-foreground: 7.44:1 / 6.09:1. */
              <span className="text-xl font-bold text-muted-foreground select-none">
                {(order.product_name ?? "؟")[0]}
              </span>
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* R124-I4 (A5 #1): hover tint rides the text-safe
                          token — raw text-primary is 3.76:1 on the dark
                          card (AA fail on the hover state of small text). */}
            {/* R143 (L3-2): dir="auto" + text-right — the
                          ProductCard F-1 recipe; order product names are
                          Latin by design and truncate from the wrong end
                          in an RTL block (the ellipsis eats the brand
                          head on the money-history surface). */}
            <div
              dir="auto"
              className="font-bold text-sm leading-snug truncate text-right group-hover:text-primary-text transition-colors duration-150"
            >
              {order.product_name}
            </div>
            {/* R116-S2 (P2): the purchased option under the product
                          name — the same chip idiom as cart.tsx (the
                          shopper's mental model of WHAT the line is, not just
                          which brand). Null for legacy pre-variant orders. */}
            {order.variant_label && (
              <div className="text-2xs font-semibold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2 py-0.5 mt-0.5 inline-block leading-tight">
                {order.variant_label}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                dir="ltr"
                className="font-mono text-2xs bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded border border-border/30"
              >
                {order.order_code}
              </span>
              {order.created_at && (
                <span className="text-2xs text-muted-foreground">
                  {formatDateShort(order.created_at)}
                </span>
              )}
              {(order as { coupon_code?: string }).coupon_code && (
                <span className="flex items-center gap-0.5 text-3xs font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                  <Tag className="w-2.5 h-2.5" />
                  <span dir="ltr">{(order as { coupon_code?: string }).coupon_code}</span>
                </span>
              )}
              {/* R115-I1 (A8 P2-3c): the refund receipt on the row —
                            RefundService credits the FULL orders.amount
                            back to the wallet (terminal-state guarded), so
                            the amount IS available on the row. Info tone,
                            never error red: the money came back. */}
              {order.status === "refunded" && (
                <span className="flex items-center gap-0.5 text-3xs font-bold text-status-info bg-status-info/10 border border-status-info/22 px-1.5 py-0.5 rounded-full whitespace-nowrap tabular-nums">
                  <Undo2 className="w-2.5 h-2.5" />
                  استُرد {formatCurrency(order.amount)} إلى محفظتك
                </span>
              )}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0 max-w-[42%] sm:max-w-none">
            <div className="text-right min-w-0">
              {((order as { discount_amount?: number }).discount_amount ?? 0) > 0 && (
                <div className="text-3xs text-muted-foreground line-through tabular-nums">
                  {formatCurrency(
                    (order.amount ?? 0) +
                      ((order as { discount_amount?: number }).discount_amount ?? 0),
                  )}
                </div>
              )}
              <div className="font-bold text-sm tabular-nums">{formatCurrency(order.amount)}</div>
              {/* R116: shared StatusBadge (STATUS_TONE)
                            replaces the deprecated statusColor() — 93-C7
                            follow-up; the status glyph stays a child. */}
              <StatusBadge
                variant={
                  STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE
                }
                size="sm"
                className="mt-1 justify-end"
              >
                <StatusIcon status={order.status} />
                <span>{statusLabel(order.status)}</span>
              </StatusBadge>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary-text group-hover:translate-x-[-2px] transition-all duration-150 shrink-0" />
          </div>
        </div>
      </div>
    </Link>
  );
}
