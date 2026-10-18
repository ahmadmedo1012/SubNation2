import { ArrowLeft, Layers } from "lucide-react";
import { Link } from "wouter";

/**
 * R167 (F12, wave 1) — verbatim extract from pages/order-detail.tsx
 * (the R165/R166 order-group chip): the «ضمن عملية شراء واحدة» link
 * under the order code. The page owns the GATE (the order's group-id
 * token — checkout mints it on every confirm, single-unit runs
 * included); this chip is the static view-siblings affordance.
 *
 * Presentational by contract (the R137 extract idiom): no props, no
 * state, no effects. Rendered DOM byte-identical — pinned by
 * order-detail-group-chip-r165 (render) + the R167 order-detail
 * decomposition pin (source).
 *
 * R165 (the R162 ADR §6.3) + R166-A F01 (copy honesty): checkout
 * mints the group token on EVERY confirm (no unit-count gate), so
 * the id rides single-unit purchases too — the neutral copy «ضمن
 * عملية شراء واحدة» is true for a run of 1 AND multi-unit groups,
 * and reuses the exact vocabulary the /orders divider ships (one
 * mental model).
 */
export function OrderGroupChip() {
  return (
    <Link
      href="/orders"
      className="inline-flex items-center gap-1 mt-1.5 text-2xs font-bold text-primary-text bg-muted/40 border border-border/35 rounded-full px-2.5 py-1 hover:bg-muted/70 hover:border-border/60 transition-colors"
    >
      <Layers className="w-3 h-3" />
      ضمن عملية شراء واحدة
      {/* R166-A F03: the trailing arrow is a view-siblings affordance —
          ArrowLeft per the app's RTL forward/view convention (right is
          reserved for رجوع/العودة back verbs). */}
      <ArrowLeft className="w-2.5 h-2.5 opacity-70" />
    </Link>
  );
}
