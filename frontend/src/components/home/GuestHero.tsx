import { ShelfRail } from "@/components/home/ShelfRail";
import { buttonVariants } from "@/components/ui/button";
import { useOnScreen } from "@/hooks/use-on-screen";
import { cn } from "@/lib/utils";
import { formatCount, formatCurrency } from "@/lib/utils";
import type { ProductListItem, CatalogStats } from "@workspace/api-client-react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { memo, useState } from "react";
import { Link } from "wouter";

// R145 (visual transformation): the guest hero, recomposed — "the lit
// shelf" composition. The r138/r139 hero was audited against the LIVE
// production site (VLM critique, 2026-10-14) and read as "a dark
// rectangle with text — three competing focal points, stats that look
// like debugging info, the CTA buried low". The recomposition:
//
//   1. ONE typographic focal point — the h1 (byte-identical SEO text,
//      two lines, the accent line carries the locale phrase).
//   2. ONE value line under it (the sub-line: dinar + instant
//      delivery — the two claims the trust strip already makes).
//   3. The CTAs immediately after the copy (R116-S1 recipe untouched).
//   4. THE SHELF: real product imagery on a lit plane — the store's
//      actual inventory answering "what does this shop sell" before a
//      single word of marketing prose (ShelfRail, its own file).
//   5. The stats, demoted from side-column chips to the shelf's
//      CAPTION: honest catalog numbers in the place where they have
//      context (under the products they describe). Same tri-state
//      contract as the old StatsWidgets (skeleton → content →
//      deliberate hide on error) — the R111-F1 G2 discipline, kept.
//   6. The SEO prose moves BELOW the composition (full text still in
//      the DOM; mobile keeps the 2-line collapse + R120-B1 toggle).
//
// The brand-chip row is REMOVED from the hero: discovery moved to the
// CategoryRail section (real category tiles with per-category depth +
// honest stock truth) — three competing discovery mechanisms in one
// viewport was part of the chaos verdict. BRANDS' Arabic
// transliterations keep their SEO weight inside the prose paragraph
// (نتفلكس، ديزني+، سبوتيفاي، ويندوز، إكسبرس، شات جي بي تي — all
// already in the copy) and the CategoryRail's example lines.
//
// Fold budget (mobile 390×844): navbar 56 + h1 ~84 + sub ~20 + CTA 44
// + shelf ~110 + caption ~18 + paddings ≈ 380px — product imagery in
// the first fold, prose after it. The old hero spent ~500px before
// ANY product surface.

// R140-d (runtime perf): the hero rides React.memo — its props are
// referentially stable across the page's keystroke re-renders
// (products is the query's structurally-shared ref, stats likewise,
// booleans), so the search input's page-root state never re-renders
// this subtree. Kept through the recomposition.
export const GuestHero = memo(function GuestHero({
  products,
  productsLoading,
  stats,
  statsPending,
}: {
  products: ProductListItem[];
  productsLoading: boolean;
  stats: CatalogStats | undefined;
  statsPending: boolean;
}) {
  // 96-F5 (R96 F-4b): pause the ambient blobs when the hero leaves
  // the viewport — kept through the recomposition (same observer, same
  // cleanup; the blobs are the only continuous animation here).
  const { ref: guestHeroRef, onScreen: heroOnScreen } = useOnScreen<HTMLDivElement>();
  // R120-B1 (A1-F3/A3-F2): the SEO prose collapses to 2 lines below sm
  // with this expand toggle (the FULL text stays in the DOM for
  // crawlers; ≥sm shows it in full). Kept byte-identically.
  const [heroProseOpen, setHeroProseOpen] = useState(false);

  return (
    // R125-I7: 16px card-radius family (matches every catalog card +
    // the authed hero); page-in entrance stays (one-shot, CSS).
    <div
      ref={guestHeroRef}
      className="relative overflow-hidden rounded-2xl border border-border/40 mb-4 sm:mb-6 bg-card page-in shadow-xl"
    >
      {/* ── The quiet stage (kept from r138, unchanged vocabulary) ── */}
      <div className="absolute inset-0 ambient-wash pointer-events-none" />
      <div className="absolute inset-0 dot-grid pointer-events-none opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-l from-primary/12 via-transparent to-transparent pointer-events-none" />
      <div className="hairline-glow" />
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-primary/80 via-primary/30 to-transparent" />
      <div
        className="absolute top-[-50px] right-[8%] w-72 h-72 bg-primary/14 rounded-full blur-3xl pointer-events-none blob-drift"
        style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
      />
      <div
        className="absolute bottom-[-40px] left-[15%] w-56 h-56 bg-primary/9 rounded-full blur-3xl pointer-events-none blob-drift-slow"
        style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
      />

      <div className="relative px-4 py-6 sm:px-8 sm:py-9 lg:px-10 lg:py-11">
        {/* Desktop: copy (start side) + shelf column (end side) in one
            row — the shelf travels beside the headline like a shop
            window beside its sign. Mobile: the natural stack (copy →
            shelf — product imagery still inside the fold), prose after
            both. */}
        {/* lg:items-center — the shelf column centers against the copy block
            (the render-review pass read the top-aligned shelf as "floating
            disconnected"; centering ties the two planes into one hero
            composition — the shop window beside its sign). */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:gap-10">
          {/* ── Copy column ─────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            <h1 className="text-fluid-3xl font-bold mb-2.5 sm:mb-3">
              {/* Single contiguous phrase for Google's NLU; visual
                  two-line split via block spans (NOT <br>) — the
                  R120-B1 whitespace-node contract, kept verbatim. */}
              <span className="block">سوق الاشتراكات الرقمية</span>{" "}
              <span className="block text-primary-text">في ليبيا</span>
            </h1>

            {/* R145: the value line — ONE sentence, the two claims the
                trust strip already makes honestly (dinar pricing,
                post-payment instant delivery). No new promises. */}
            <p className="text-foreground/75 text-sm sm:text-base font-semibold mb-4 sm:mb-5 max-w-md">
              اشتراكاتك الرقمية بالدينار الليبي — تشتريها بضغطة، وتصلك فوراً بعد الدفع.
            </p>

            {/* CTAs — R116-S1 recipe untouched (size lg, w-full
                sm:w-auto, one Link = one tab stop). */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:flex-wrap">
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
              >
                إنشاء حساب مجاني
              </Link>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "w-full sm:w-auto gap-1.5 text-muted-foreground [&_svg]:size-3.5",
                )}
              >
                لدي حساب — سجّل دخولك
                <ArrowLeft className="opacity-40" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* ── The shelf column ────────────────────────────────── */}
          <div className="mt-5 lg:mt-0 lg:w-[420px] xl:w-[460px] shrink-0">
            <ShelfRail products={products} isLoading={productsLoading} />

            {/* The shelf's caption — the honest catalog numbers, in the
                place they have context. Replaces the r111 stats column
                + mobile strip (same data, same tri-state contract:
                skeleton while pending, content when loaded, deliberate
                hide on error — decorative secondary data; the grid
                below carries the honest error surface). Count-aware
                labels via formatCount; tabular-nums + Western digits +
                «د.ل» (the money idiom). */}
            {/* R145 (honesty guard): a malformed/unparseable stats payload
                (the customFetch fallthrough shape) must hide the caption —
                NOT render «NaN منتج متاح الآن · تبدأ الأسعار من 0.00 د.ل».
                Caught by the local harness stubbing the wrong path (the
                SPA HTML fallback parses to a truthy object with undefined
                fields); the guard makes the caption self-validating:
                finite count + finite price or nothing. */}
            {stats &&
            Number.isFinite(stats.available_products) &&
            Number.isFinite(stats.lowest_price) ? (
              <p className="mt-2.5 text-2xs sm:text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                {/* The dot is decorative; the count is the content. */}
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0"
                />
                {formatCount(stats.available_products, {
                  one: "منتج متاح الآن",
                  two: "منتجان متاحان الآن",
                  few: "منتجات متاحة الآن",
                  many: "منتجاً متاحاً الآن",
                  other: "منتج متاح الآن",
                })}
                <span aria-hidden="true">·</span>
                <span>تبدأ الأسعار من {formatCurrency(stats.lowest_price)}</span>
              </p>
            ) : statsPending ? (
              <div className="mt-2.5 flex items-center gap-1.5" aria-hidden="true">
                <div className="h-2 w-16 skeleton-shimmer rounded" />
                <div className="h-2 w-28 skeleton-shimmer rounded" />
              </div>
            ) : null}
          </div>
        </div>

        {/* ── The SEO prose — below the composition ───────────────
            Full text in the DOM at every viewport (topic vector);
            visually: 2-line clamp below sm with the R120-B1 toggle,
            full (muted, measured max-w) from sm up. */}
        <p
          className={`text-muted-foreground text-xs leading-relaxed max-w-2xl mt-4 sm:mt-5 ${
            heroProseOpen ? "" : "line-clamp-2"
          } sm:line-clamp-none`}
        >
          <strong lang="en" className="font-bold text-foreground">
            SubNation
          </strong>{" "}
          سوق إلكتروني متخصّص في بيع الاشتراكات الرقمية للسوق الليبي. تجد على المنصّة اشتراكات البثّ
          المباشر مثل نتفلكس وديزني+، وخدمات الموسيقى مثل سبوتيفاي، ومفاتيح البرامج مثل ويندوز،
          وشبكات VPN مثل إكسبرس، وأدوات الذكاء الاصطناعي مثل شات جي بي تي — كلّها بالدينار الليبي مع
          تسليم فوري بعد الدفع.
        </p>
        <button
          type="button"
          onClick={() => setHeroProseOpen((v) => !v)}
          aria-expanded={heroProseOpen}
          className="sm:hidden w-full min-h-11 inline-flex items-center justify-center gap-1 text-2xs font-bold text-primary-text hover:text-primary-text/80 transition-colors press-spring"
        >
          {heroProseOpen ? "عرض أقل" : "عرض المزيد"}
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-200 ${
              heroProseOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
});
