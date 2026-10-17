import { BRANDS, CATEGORIES } from "@/components/home/catalog-filters";
import { categoryLookup } from "@/lib/category-registry";
import { Reveal, RevealGroup, RevealItem } from "@/lib/motion-primitives";
import { formatCount } from "@/lib/utils";
import { Link } from "wouter";

// R145 (visual transformation): the category discovery section. The
// hero's brand-chip row (8 text pills) and the filter bar's category
// select carried discovery between them but neither SOLD the range:
// the live-site audit read the chips as ambiguous UI chrome, and the
// r122 stock-dot fix lived at 11px. This section gives discovery its
// own real estate with honest depth signals:
//
//   - every tile = one live category (the 7 with products, per
//     lib/categories.ts — no empty categories, the R134 rule)
//   - an example line naming real brands the category sells (BRANDS,
//     the same table the hero chips used — Latin names for brand
//     recognition + the sr-only Arabic the crawler indexes)
//   - a count line (formatCount) — the category's actual catalog
//     depth, from the page's products array
//   - stock truth: a success dot + «متاح الآن» only when the
//     category genuinely has a stocked product (the r122
//     categoryHasStock map — category-level truth, never brand-level)
//
// Tiles link to the category landing pages (the r122 navigation
// contract) — the same routes the old chips targeted.
//
// Motion: the section header + rail ride the R145 reveal vocabulary
// (RevealGroup, 48ms stagger, once) — a drawer-of-categories arriving
// in sequence, per the Scroll-Craft rail settle pattern. Under
// reduced-motion the stagger's transform drops and the opacity fade
// remains (MotionConfig reducedMotion="user").

/** The per-category accent families (index.css cat-* tokens — the
 *  products-carry-the-color principle: the tile's icon tint is the
 *  category's own hue, not chrome decoration). R146 (components audit
 *  F2): the local table folded onto lib/category-registry's tile atoms
 *  (the same bg/12 + text strings, now spelled out there once). */
const CATEGORY_ACCENT: Record<string, string> = categoryLookup((row) => row.tile);

/** Brand examples per category — the first three BRANDS rows whose
 *  category matches, Latin label visible (brand recognition) + the
 *  Arabic transliteration sr-only (the SEO contract the hero chips
 *  carried — preserved here, zero keyword loss). */
function exampleBrands(cat: string): { latin: string; ar: string }[] {
  return BRANDS.filter((b) => b.cat === cat).slice(0, 3);
}

export function CategoryRail({
  categoryCounts,
  categoryHasStock,
}: {
  categoryCounts: Record<string, number>;
  categoryHasStock: Set<string> | null;
}) {
  // Stocked categories lead the rail (stable sort — the editorial
  // order survives within each group; the same r122 ordering rule the
  // old heroBrands memo applied to chips, here applied to tiles).
  const tiles = [...CATEGORIES.filter((c) => c.value)].sort(
    (a, b) =>
      Number(categoryHasStock?.has(b.value) ?? false) -
      Number(categoryHasStock?.has(a.value) ?? false),
  );
  if (tiles.length === 0) return null;

  // style={{contain:"layout"}} on the section below — the Chromium RTL
  // scrollable-overflow bug fix. Measured (R145, 390×844): a
  // direction:rtl overflow-x-auto scroller sitting in open page flow
  // propagates its LEFTWARD scrollable region into
  // documentElement.scrollWidth (722px on a 390px viewport → a real
  // leftward page pan; overflow:hidden/clip on the ancestor do NOT
  // stop it — tested). contain:layout severs the propagation
  // (722 → 390) while the rail keeps its native internal scrolling.
  // The shelf rail needs nothing: it lives inside the hero card's
  // overflow-hidden, which empirically contains it.
  return (
    <section
      aria-labelledby="category-rail-heading"
      className="mt-7 sm:mt-10"
      style={{ contain: "layout" }}
    >
      {/* Section header — the taste-floor spacing rule: the gap ABOVE
          the section is the boundary (mt-7/10); the header's own
          mb stays tight so heading + rail read as one group. */}
      <Reveal as="header" className="mb-3 sm:mb-3.5">
        <h2 id="category-rail-heading" className="text-lg sm:text-xl font-bold text-foreground">
          تسوّق حسب الفئة
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          سبع فئات حقيقية في الكتالوج — لكل فئة صفحتها وعروضها
        </p>
      </Reveal>

      {/* NO scroll-snap (the ShelfRail note: Chromium RTL snap areas
          leak into the document scrollable overflow — measured). */}
      <RevealGroup className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1.5">
        {tiles.map((c) => {
          const count = categoryCounts[c.value] ?? 0;
          const inStock = categoryHasStock?.has(c.value) ?? false;
          const examples = exampleBrands(c.value);
          return (
            <RevealItem key={c.value} className="shrink-0">
              <Link
                href={`/category/${c.value}`}
                className="group block w-[150px] sm:w-[168px] rounded-2xl border border-border/60 bg-card p-3.5 sm:p-4 transition-colors duration-200 hover:border-border/100 focus-visible:outline-offset-4"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105 ${CATEGORY_ACCENT[c.value] ?? "bg-muted text-muted-foreground"}`}
                >
                  <c.Icon className="w-5 h-5" aria-hidden="true" />
                </div>
                <p className="font-bold text-sm text-foreground mt-2.5">{c.label}</p>
                {/* Brand examples — honest (the BRANDS table maps to the
                    live catalog) + the sr-only Arabic forms for the
                    crawler (the old chips' SEO contract, preserved). */}
                {examples.length > 0 && (
                  <p className="text-2xs text-muted-foreground mt-1 truncate text-right" dir="ltr">
                    <span lang="en">{examples.map((e) => e.latin).join(" · ")}</span>
                    <span className="sr-only">{examples.map((e) => e.ar).join("، ")}</span>
                  </p>
                )}
                {/* Depth + stock truth, one line: the real count, and a
                    green dot ONLY when the category truly has stock. */}
                <p className="text-2xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  {count > 0 && (
                    <span className="tabular-nums">
                      {formatCount(count, {
                        one: "اشتراك واحد",
                        two: "اشتراكان",
                        few: "اشتراكات",
                        many: "اشتراكاً",
                        other: "اشتراك",
                      })}
                    </span>
                  )}
                  {inStock && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-status-success">
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full bg-status-success"
                        />
                        متاح الآن
                      </span>
                    </>
                  )}
                </p>
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}
