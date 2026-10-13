import { CheckCircle, Tag } from "lucide-react";
import {
  CATEGORY_GRADIENTS,
  CATEGORY_INITIAL_COLOR,
} from "@/components/product/category-presentation";
import { categoryLabel } from "@/lib/utils";
import type { Product } from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the START column of the R116-S2 desktop split (media + title + long
// description + features; below lg it dissolves via max-lg:contents into
// the page's single-card flow). Pure presentation: it reads ONLY the
// product prop (the category-tinted gradient/initial lookups moved with
// it — they were already pure map reads used nowhere else). The h1's
// dir="auto" + text-right contract is render-pinned by
// product-cta-mobile-r126 (R128 A2-F1); DOM and classes are
// byte-identical.
export function ProductMediaSection({ product }: { product: Product }) {
  const gradientClass =
    CATEGORY_GRADIENTS[product.category ?? "streaming"] ??
    "from-primary/20 via-primary/8 to-transparent";
  const initialColorClass = CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "text-white/30";

  return (
    // ── START column (RTL first = right): media + description ──
    <section className="max-lg:contents lg:bg-card lg:border lg:border-border/55 lg:rounded-2xl lg:overflow-hidden lg:shadow-xl">
      {/* Image — max-lg:-mb-4 cancels the wrapper gap so the media stays
            flush against the card body exactly like the pre-split layout.
            R138 (visual): bg-muted/60 — the media plane gets the SAME shelf
            wash the ProductCard's image well moved to this round (the
            empty-state icon-tile vocabulary, theme-aware via color-mix). The
            plane used to be bare card with only the category gradient —
            perceptible at the top where the tint peaks, sub-perceptual at
            the transparent bottom, so the lower half read as raw card. The
            /60 wash gives the whole 16:9 plane its own shelf surface under
            the still-live category gradient (bg-color under bg-image — the
            to-transparent stops now settle onto the shelf instead of bare
            card), and the two product surfaces rhyme end-to-end. The img's
            drop-shadow-2xl → drop-shadow-lg (below) grounds the asset with
            the card well's ONE grounding recipe. */}
      <div
        className={`order-1 max-lg:-mb-4 aspect-[16/9] bg-muted/60 bg-gradient-to-b ${gradientClass} flex items-center justify-center relative overflow-hidden group/img`}
      >
        {/* Ambient inner glow */}
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-black/20 pointer-events-none" />

        {product.image_url ? (
          <img
            src={product.image_url}
            alt={(() => {
              const name = (product.name ?? "").trim();
              const cat = categoryLabel(product.category);
              if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";
              const hasSub = /اشتراك/.test(name);
              return cat && cat !== "عام"
                ? `${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()
                : name;
            })()}
            // L4-F9 (R132, measured): the intrinsic source of every
            // live product asset is 450×450 webp (verified against
            // https://subnation.ly/products/*.webp — all 45). The
            // old width/height={800} was a false preload hint: it
            // told the scanner to expect a larger resource than
            // exists while the RENDERED box (object-contain inside
            // the 16:9 media area, ~250-500 CSS px depending on
            // viewport, ≤1.4 device-px upscale at DPR 2) sits close
            // to the source. Honest intrinsic dimensions keep the
            // aspect-ratio math truthful without regenerating
            // artwork (no bigger sources exist; upscaling adds
            // weight, not detail).
            width={450}
            height={450}
            fetchPriority="high"
            decoding="async"
            className="w-full h-full object-contain p-6 sm:p-8 transition-transform duration-500 ease-out group-hover/img:scale-[1.04] drop-shadow-lg"
            // B4 P1-6: mirror ProductCard's fallback — a dead enrichment
            // URL swaps to the initial-letter tile instead of painting the
            // browser's broken-image glyph inside the page's largest
            // visual element. width/height (above) already pin the box.
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = "none";
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
        ) : null}

        {/* No-image fallback — always mounted (hidden when an image URL
              exists) so an onError above can reveal it without a re-render,
              exactly like ProductCard's category-icon fallback. */}
        <div
          style={{ display: product.image_url ? "none" : "flex" }}
          className="absolute inset-0 z-[2] items-center justify-center pointer-events-none"
        >
          {/* R138 (visual): the glass pair retired — backdrop-blur-sm (the
              banned glass vocabulary; over the WASH, not over imagery, so
              no scrim legibility was ever at stake) and shadow-lg → the
              card-fallback tile's shadow-sm; the translucent white/5 +
              white/10 chip character stays (reads on the tinted wash in
              dark, neutral-quiet in light — the big cat-hued glyph carries
              the identity either way). */}
          <div className="flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white/5 border border-white/10 shadow-sm">
            <span
              className={`text-5xl sm:text-6xl font-bold select-none drop-shadow-lg ${initialColorClass}`}
            >
              {(product.name || "؟")[0]}
            </span>
          </div>
        </div>

        {/* Top badges — z-[3] keeps them above the z-[2] fallback layer
              (same stacking discipline as ProductCard's media area). */}
        <div className="absolute top-3 right-3 z-[3] bg-black/55 backdrop-blur-sm text-white/85 text-2xs font-bold px-2.5 py-1 rounded-full border border-white/8">
          {categoryLabel(product.category)}
        </div>
        {product.discount_percent && (
          /* R123-E4b (P3-h): text-primary-foreground — the shared token
             every other primary-surface badge rides; raw text-white
             broke the theme-tinted primary of the R115 palette.
             R138 (visual): shadow-lg shadow-primary/40 → shadow-md
             shadow-primary/30 — ONE primary-chip elevation value shared
             with the ProductCard's discount badge + desktop quick-add
             (the r138-B unification; a same-family 10% alpha spread is
             vocabulary drift). */
          <div className="absolute top-3 left-3 z-[3] flex items-center gap-1 bg-primary text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full shadow-md shadow-primary/30">
            <Tag className="w-3 h-3" />
            خصم {product.discount_percent}%
          </div>
        )}

        {/* Fade into card body */}
        <div className="absolute inset-x-0 bottom-0 z-[3] h-20 bg-gradient-to-t from-card to-transparent" />
      </div>

      {/* R116-S2: below lg this dissolves (max-lg:contents) so its
            children join the wrapper's flex flow; at lg it is the START
            column's padded content stack (the image stays full-bleed
            above it inside the section card). */}
      <div className="max-lg:contents lg:p-5 lg:space-y-4">
        {/* Title */}
        <div className="order-2 max-lg:px-5 max-lg:pt-5">
          {/* R116-S2 (P3): dir="auto" (Latin-heavy product names were
                scrambled by the RTL base direction) + the dead
                leading-tight/tracking-tight overrides dropped — Arabic
                letter-spacing tears the cursive joins.
                R128-A2 (F-1): text-right re-anchors the ALIGNMENT to
                the RTL reading edge — pure-Latin names resolve dir=auto
                to ltr, so text-align:start computed LEFT and the h1
                floated up to 41px off the right line the breadcrumb and
                labels anchor to. Same fix as ProductCard's h3.
                R138 (visual): text-fluid-2xl → text-fluid-3xl — the
                page's #1 anchor step (GuestHero's h1 rides the same
                token; category.tsx keeps 2xl for the LIST header). At
                fluid-2xl the PDP title measured ≈23.6px on a 390px
                viewport — UNDER the price block's fixed 30px — so the
                money read as the page's FIRST anchor on the
                mobile-majority surface; 3xl (≈29.5px mobile → 46.4px
                desktop) restores title → price → everything-else. mb-2
                gives the bigger title one more breath before the muted
                description (mb-1.5 rode the smaller step). */}
          <h1 dir="auto" className="text-fluid-3xl font-bold mb-2 text-right">
            {product.name}
          </h1>
          {product.description && (
            <p className="text-muted-foreground leading-relaxed text-sm">{product.description}</p>
          )}
        </div>

        {/* Long-form description (Phase 2 SEO content) — rendered ONLY
              when an editor has provided one. Mirrors the value embedded
              in the Product JSON-LD so on-page text matches the
              structured data Google ingests. */}
        {product.description_long && (
          <div className="order-3 max-lg:px-5 rounded-xl border border-border/45 bg-muted/15 p-4 text-sm text-foreground/85 leading-relaxed whitespace-pre-line">
            {product.description_long}
          </div>
        )}

        {/* Feature checklist (catalog 2026-09-20) — the imported Arabic
              bullets. Rendered as a real list (a11y: listitem semantics) with
              check icons; Google reads the same text into the product's
              content signals. */}
        {Array.isArray(product.features) && product.features.length > 0 && (
          <ul className="order-4 max-lg:px-5 grid sm:grid-cols-2 gap-2 list-none">
            {product.features.map((feature: string) => (
              <li
                key={feature}
                className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/10 px-3.5 py-2.5 text-sm text-foreground/85 leading-relaxed"
              >
                <CheckCircle
                  className="w-4 h-4 mt-0.5 shrink-0 text-status-success"
                  aria-hidden="true"
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* R117 (F-3): the FAQ accordion now lives in the END (buy panel)
        column, directly after the trust grid — moving it there made
        the mobile DOM/reading order match the visual order (it used
        to sit here in DOM, right after the features list, while
        rendering visually after the trust grid — a WCAG 1.3.2
        divergence). See the R117 (F-3) comment at its new home. */}
    </section>
  );
}
