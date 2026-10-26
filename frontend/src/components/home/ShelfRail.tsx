import type { ProductListItem } from "@workspace/api-client-react";
import { productToItem, trackSelectItem } from "@/lib/analytics-events";
import { productArtUrl } from "@/lib/product-art";
import { Link } from "wouter";

// R145 (visual transformation): the guest hero's signature surface —
// "the lit shelf" (الرف المضيء). A horizontal rail of REAL catalog
// product imagery sitting on a lit shelf plane: the shop-window
// metaphor for a marketplace. Depth cues per the Scroll-Craft taste
// floor: the muted /60 well (the shelf surface, the r138 idiom), the
// hairline light under the row (the shelf's lit edge — the same
// transparent→primary/25→transparent family as .hairline-glow), and
// drop-shadow grounding on each asset. NO glow halos, no floating
// decoration — a shelf reads as a shelf because of the edge light and
// the consistent well, not because it glows.
//
// HONESTY CONTRACT (R145, live reality 1/45 available): the shelf
// answers "what does this store carry" — brand recognition — NOT
// "what can I buy right now". Availability truth stays where it
// belongs: the card badges and the PDP. The rail rides
// displayProducts (the page's available-first re-order), so any
// in-stock item naturally leads; the caption under the rail (rendered
// by GuestHero, which owns the stats props) carries the honest
// catalog numbers.
//
// The rail is natively scrollable (overflow-x-auto + snap proximity)
// on EVERY viewport and under reduced motion — horizontal travel is
// navigation, not animation, so it never depends on JS motion (the
// Scroll-Craft reduced-motion rule for rails).

/** Items shown on the shelf — enough to fill a desktop column and
 *  leave a healthy mobile overflow without requesting more rows. */
const SHELF_SIZE = 8;

export function ShelfRail({
  products,
  isLoading,
}: {
  products: ProductListItem[];
  isLoading: boolean;
}) {
  const shelfProducts = products.slice(0, SHELF_SIZE);

  // Loading / empty-catalog guards: a skeleton row while the first
  // fetch is pending (shaped like the content — the FINAL_UX_SYSTEM
  // §3 loading contract); the rail is REMOVED entirely for an empty
  // catalog (decorative secondary surface — the grid below carries the
  // page's honest empty state; a shelf of skeletons above an honest
  // "no products" grid would contradict it).
  if (!isLoading && shelfProducts.length === 0) return null;

  return (
    <div className="relative">
      {/* The shelf row — RTL-native horizontal scroll. pb-1 keeps the
          focus rings clear of the lit edge; snap-proximity makes thumb
          scrolling settle on items without scroll-jacking. */}
      {/* NOTE: NO scroll-snap here (deliberate). Chromium's RTL
          scroll-snap implementation reports the snap areas into the
          DOCUMENT's scrollable overflow (html.scrollWidth grew to 722px
          on a 390px viewport — measured, scrollableLeft -100), creating
          a real leftward page pan on mobile. The pre-R145 rails (hero
          chips, category page chips) never snapped; matching that
          behavior keeps the rail natively scrollable without the
          document-level phantom overflow. */}
      <div
        className="flex items-stretch gap-2.5 overflow-x-auto scrollbar-none pb-1.5"
        aria-label="منتجات المتجر"
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="shrink-0 w-[86px] h-[86px] sm:w-[96px] sm:h-[96px] rounded-xl bg-muted/60 border border-border/40 skeleton-shimmer"
              />
            ))
          : shelfProducts.map((p, i) => (
              <Link
                key={p.id}
                /* R177: the slug ?? id fallback every sibling surface
                   carries (ProductCard:335, CatalogFiltersBar:140,
                   RecommendationsSection:87, seo-builders:107) — a legacy
                   slug-less row must never link to /product/null. */
                href={`/product/${p.slug ?? p.id}`}
                /* R188-4 (R188-A seed): GA4 select_item — the shelf→PDP
                   hop, the same event every sibling product-click surface
                   fires (ProductCard :339, flash-sales :104,
                   RecommendationsSection :94 = R187's A-F3 for this
                   identical blindness class). The list DTO is
                   single-price, so no variant arg (the flash-card
                   shape). */
                onClick={() => trackSelectItem(productToItem(p), "home-shelf")}
                className="group shrink-0 block rounded-xl focus-visible:outline-offset-4"
                aria-label={p.name ?? "منتج"}
              >
                <div
                  className={`w-[86px] h-[86px] sm:w-[96px] sm:h-[96px] rounded-xl bg-muted/60 border border-border/50 flex items-center justify-center transition-colors duration-200 group-hover:border-border ${
                    p.is_available ? "" : "opacity-75"
                  }`}
                >
                  {p.image_url ? (
                    <img
                      src={productArtUrl(p.image_url)}
                      alt={p.name ?? "منتج"}
                      // The measured intrinsic size of every live asset
                      // (1024×1024, the R174 census) reserves the box; the
                      // rail renders it at ~86-96px.
                      width={1024}
                      height={1024}
                      // LCP discipline: on mobile the shelf is the first
                      // product imagery in the fold — the leading two
                      // items load eager (index 0 high priority, matching
                      // the grid's index-based fetchpriority contract).
                      loading={i < 2 ? "eager" : "lazy"}
                      fetchPriority={i === 0 ? "high" : "low"}
                      decoding="async"
                      className={`max-w-[76%] max-h-[76%] w-auto h-auto object-contain drop-shadow-md transition-transform duration-300 ease-out ${
                        p.is_available ? "group-hover:scale-[1.07]" : "group-hover:scale-[1.03]"
                      }`}
                    />
                  ) : null}
                </div>
              </Link>
            ))}
      </div>

      {/* The lit edge — the shelf itself. A 1px hairline with the
          sanctioned transparent→primary/25→transparent ramp (the
          .hairline-glow family, horizontal) + a 2px resting surface
          line under it: the plane the products "sit" on. Static,
          GPU-free, identical in both themes (token-driven). */}
      <div aria-hidden="true" className="pointer-events-none -mt-1.5">
        <div className="h-px bg-gradient-to-l from-transparent via-primary/25 to-transparent" />
        <div className="h-[2px] bg-border/40" />
      </div>
    </div>
  );
}
