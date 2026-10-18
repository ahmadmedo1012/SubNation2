import { Layers } from "lucide-react";
import { ORDER_COUNT_FORMS_SUBJECT, formatCount } from "@/lib/utils";

/**
 * R167 (F11, wave 1) — verbatim extract from pages/orders.tsx: the
 * R165/R166 order-group cluster divider («عملية شراء واحدة»), rendered
 * ABOVE the first row of every run of ≥2 consecutive orders sharing
 * one non-null order_group_id. The page owns the run computation
 * (lib/order-groups.ts) and WHICH index starts a run; this chip only
 * renders the count it is handed.
 *
 * Presentational by contract (the R137 extract idiom): values in, no
 * state, no effects. Rendered DOM byte-identical — pinned by
 * orders-group-clustering-r165 (render) + the R167 decomposition pin
 * (source).
 */
export function OrderClusterDivider({ runCount }: { runCount: number }) {
  return (
    /* R166-A (F05): the wrapper carries NO aria-label —
       aria-label on a role-less generic div is ignored
       (and would hide the run count if honored); the
       chip's own text carries the full information. */
    <div className="flex items-center justify-center gap-1.5 pt-1">
      <span className="flex items-center gap-1 text-2xs font-bold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2.5 py-1">
        <Layers className="w-3 h-3" />
        عملية شراء واحدة
        <span className="text-muted-foreground/80 tabular-nums">
          (
          {/* R166-A (F02 + F16): the run count is a standalone
              parenthetical — the nominative dual «طلبان» via
              the shared SUBJECT registry (was the oblique
              «طلبين», contradicting the same page's header
              chip). */}
          {formatCount(runCount, ORDER_COUNT_FORMS_SUBJECT)})
        </span>
      </span>
    </div>
  );
}
