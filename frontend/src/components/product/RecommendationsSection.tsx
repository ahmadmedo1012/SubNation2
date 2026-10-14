import { Link } from "wouter";
import { formatCurrency } from "@/lib/utils";
import {
  getGetProductRecommendationsQueryKey,
  useGetProductRecommendations,
  type ProductRecommendation,
} from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the same-category cross-sell rail. It was already a fully
// self-contained component inside the page file (owns its own query +
// skeleton + hide-on-empty policy — nothing else on the page reads its
// data), so the move only changes its address. No props changed:
// `numericId` is the resolved product id (either fetch path).
export function RecommendationsSection({ numericId }: { numericId: number }) {
  const {
    data: recommendations = [],
    isLoading,
    isError,
  } = useGetProductRecommendations(numericId, {
    query: {
      queryKey: getGetProductRecommendationsQueryKey(numericId),
      enabled: !!numericId,
      staleTime: 5 * 60 * 1000,
      // R115-I1 (A7 P3-9): one genuine retry for transient failures — a
      // single blip used to kill the section silently on attempt #1.
      retry: 1,
    },
  });

  // R115-I1 (A7 P3-9): hide DELIBERATELY on a definitive failure (after
  // the retry above) or an empty payload. The recommendations rail is
  // decorative cross-sell — an error card inside the purchase funnel
  // is noise, and the product itself (already on screen, with its own
  // error/retry states) carries the page's honest surfaces. The retry
  // is what keeps this from being a silent vanish.
  if (isError || (!isLoading && recommendations.length === 0)) return null;

  return (
    <div className="mt-8 space-y-4">
      {/* A4-F9 (R120-B2): h2 (was h3) — this section heading sat directly
          under the page h1, skipping a level; the card titles below are
          h3 (one under their own section heading). */}
      <h2 className="text-lg font-bold pr-1">قد يعجبك أيضاً</h2>
      <div className="grid grid-cols-2 gap-3">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                // Mirrors the real card below (rounded-2xl p-3.5 + aspect-[4/3]
                // image + two text rows) so the grid doesn't jump on load.
                className="bg-card border border-border/50 rounded-2xl p-3.5 space-y-3 skeleton-shimmer"
              >
                <div className="aspect-[4/3] rounded-xl" />
                <div className="h-4 w-3/4 rounded-md" />
                <div className="h-3 w-1/2 rounded-md" />
              </div>
            ))
          : recommendations.map((r) => (
              /* R115-I1 (A7 P3-9): wouter <Link> instead of a raw <a href> —
                 the anchor did a FULL page reload (SPA state lost: cart
                 context, auth boot, scroll restoration) while every
                 other product surface navigates client-side.
                 R122 (A1 P2-8): the href is now SLUG-canonical — the
                 backend adds `slug` to the recommendations DTO in the
                 same push, but the generated type regen may land apart
                 from this edit, so the local widening reads it with the
                 `slug ?? id` fallback (the exact idiom cart.tsx and
                 ProductCard already use). Crawlers stop seeing
                 non-canonical /product/<id> internal links and the URL
                 bar stays clean on first paint. */
              <Link
                key={r.id}
                href={`/product/${(r as ProductRecommendation & { slug?: string | null }).slug ?? r.id}`}
                onClick={() => window.scrollTo(0, 0)}
                className="block bg-card border border-border/50 rounded-2xl p-3.5 space-y-3 cursor-pointer hover:border-primary/40 transition-all group"
              >
                <div className="aspect-[4/3] bg-muted/30 rounded-xl overflow-hidden relative">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.name || "منتج مقترح"}
                      /* R-140-a (image discipline): alt — the
                         recommendations DTO carries no category
                         (ProductRecommendation: id/slug/name/
                         image_url/price), so the name IS the full
                         descriptive context available; the ||
                         fallback mirrors the letter-tile's (r.name
                         || "؟") guard so a blank enrichment name
                         can never render an empty alt on a content
                         image. */
                      loading="lazy"
                      decoding="async"
                      /* R-140-a (image discipline): 450×450 = the
                         measured intrinsic of every live
                         /products/*.webp (45 files re-probed this
                         round — the R132 L4-F9 census). The
                         aspect-[4/3] well already pins the box
                         (CLS zero); these attrs keep the
                         aspect-ratio reserve honest pre-CSS. */
                      width={450}
                      height={450}
                      className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                      /* R115-I1 (A7 P3-9): ProductCard-parity fallback — a
                         dead enrichment URL swaps to the initial-letter
                         tile instead of painting the browser's
                         broken-image glyph inside the recommendation. */
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = "none";
                        const fallback = el.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  {/* Always-mounted fallback tile (hidden while an image
                      URL exists) so onError above can reveal it without
                      a re-render — the same idiom as the hero image. */}
                  <div
                    style={{ display: r.image_url ? "none" : "flex" }}
                    className="w-full h-full items-center justify-center"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 border border-border/40">
                      {/* R125-I7 (A7 B-6 class, computed): the first-letter
                          fallback rode muted-foreground/55 — 2.39:1 light /
                          3.19:1 dark on the muted/50 tile. Full
                          --muted-foreground measures 6.20:1 / 7.54:1. */}
                      <span className="text-xl font-bold text-muted-foreground select-none">
                        {(r.name || "؟")[0]}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  {/* R143 (L3-2): dir="auto" + text-right — the ProductCard
                      F-1 recipe: pure-Latin product names truncate from
                      the wrong end in an RTL block (the ellipsis eats the
                      brand head); text-right re-anchors the visual edge.
                      Arabic names resolve rtl — zero change. */}
                  <h3 dir="auto" className="text-sm font-bold truncate mb-1 text-right">
                    {r.name}
                  </h3>
                  <div className="text-primary-text font-bold tabular-nums">
                    {formatCurrency(r.price)}
                  </div>
                </div>
              </Link>
            ))}
      </div>
    </div>
  );
}
