import { Package } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { LoadMoreButton } from "@/components/ui/load-more-button";

/**
 * R167 (F11, wave 1) — verbatim extract from pages/orders.tsx: the two
 * FILTERED-empty states (an active bucket chip with no visible rows).
 * The page's first-run hero is deliberately NOT here — it stays
 * page-owned beside its shared-hero import (the skeleton-primitives
 * adoption floor pins that page address).
 *
 * The R120-B7 honesty split, verbatim: while more pages may exist the
 * filter chips run CLIENT-SIDE over the accumulated pages, so an
 * active bucket can read empty while matching rows sit on unloaded
 * pages — the load-more stays visible with the incompleteness hint;
 * the provable end (single short page) renders the drop-the-filter
 * CTA instead. Values + callbacks in, no state (the R137 extract
 * idiom). Rendered DOM byte-identical — pinned by orders-load-more /
 * orders-filter-url (render) + the R167 decomposition pin (source).
 */
export function OrdersEmptyResults({
  hasNextPage,
  loadingMore,
  parentLoading,
  onLoadMore,
  onShowAll,
}: {
  hasNextPage: boolean;
  loadingMore: boolean;
  parentLoading: boolean;
  onLoadMore: () => void;
  onShowAll: () => void;
}) {
  return hasNextPage ? (
    /* R120-B7 (A6-F1, admin/orders.tsx R115 A9 P2 pattern): the
       filter chips run CLIENT-SIDE over the accumulated pages, so
       an active bucket can read «لا توجد طلبات» while matching
       rows sit on unloaded pages (hasNextPage=true). The hard
       empty state was a false claim; keep the load-more visible
       + the honest incompleteness hint instead.
       R135 (FE-2): converged on the storefront EmptyState — this
       block WAS the compact-tile idiom the component canonized
       (same w-12/w-5/opacity-35 shape, identical strings/CTAs);
       adoption nets role="status" so the loading→empty swap
       announces (R125 A6 B-8, admin parity — the hand-rolled div
       was silent). */
    <EmptyState
      icon={Package}
      title="لا طلبات مطابقة ضمن الصفحات المحمّلة"
      description="قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل"
      action={
        <div className="flex justify-center gap-2 flex-wrap pt-1">
          <LoadMoreButton
            /* R124-I4 (A4 F1): the fixed h-9 capped the button at
               36px (it even capped Button's own min-h-8) — min-h-11
               restores the 44px tap-target floor (twMerge drops the
               sm variant's min-h-8). */
            className="min-h-11 gap-1.5"
            busy={loadingMore}
            disabled={parentLoading}
            onClick={onLoadMore}
          />
          <button
            onClick={onShowAll}
            /* R122 (A1 P2-7): the text CTA was ~24px tall — min-h-11
               rides the 44px tap-target floor. R124-I4 (A4 F1): the
               load-more beside it lost its h-9 cap and rides the
               same floor now (the old comment claimed it already
               did). */
            className="inline-flex items-center min-h-11 px-2 text-xs font-bold text-primary-text hover:underline"
          >
            عرض كل الطلبات
          </button>
        </div>
      }
      className="reveal-up"
    />
  ) : (
    // Filter is active but matched nothing (and the whole list is
    // provably loaded — a single short page). Distinct from the
    // page's first-run "no orders at all" hero (still page-owned in
    // orders.tsx) — here the user has orders, just none in the
    // chosen bucket. Surface a quick way to drop the filter without
    // forcing them to find the "all" chip again.
    //
    // R135 (FE-2): converged on the storefront EmptyState (the
    // hand-rolled twin this component canonized — identical
    // classes, strings and CTA); role="status" is net-new (R125
    // A6 B-8: the loading→empty swap was silent here).
    <EmptyState
      icon={Package}
      title="لا توجد طلبات في هذه الفئة"
      action={
        <button
          onClick={onShowAll}
          /* R122 (A1 P2-7): py-1.5 was ~30px tall — min-h-11 rides the
             44px tap-target floor.
             R125-I7 (A7 B-2): the hover tint rode raw text-primary
             (3.76:1 on the dark card) — the text-safe token keeps the
             hover state AA; hover:bg-primary/8 still carries the
             hover feedback. */
          className="text-xs font-bold text-primary-text hover:text-primary-text border border-primary/22 px-4 min-h-11 rounded-xl hover:bg-primary/8 transition-colors press-spring"
        >
          عرض كل الطلبات
        </button>
      }
      className="reveal-up"
    />
  );
}
