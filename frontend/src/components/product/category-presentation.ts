// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the product page's category-tinted presentation maps + the shared
// KNOWN_CATEGORIES routing guard moved to their own module (pure data +
// one pure lookup; zero React). The page, its media section and the CTA
// block all import from here — one source, unchanged values.
// R146 (components audit F2): the two tint maps derive from
// lib/category-registry (THE category table — the gradient/initial-color
// literals live in its rows, retired gaming/productivity included, so
// Tailwind's content scan still sees every class string).
import { CATEGORY_META } from "@/lib/categories";
import { categoryLookup } from "@/lib/category-registry";

// Category-tinted hero gradients on the product page. Ride the shared
// --cat-* tokens (defined in index.css, exposed to Tailwind via @theme)
// so the hero re-tones correctly on the light theme — the previous
// `from-violet-950 via-violet-900/60 to-violet-800/20` style produced
// a near-black slab on light backgrounds because the 800/900/950
// palette is dark-only by design. Retired categories keep their themed
// gradient so archived products still render one if the operator
// previews them from admin.
export const CATEGORY_GRADIENTS: Record<string, string> = categoryLookup((row) => row.pdpGradient);

/**
 * Categories that have a dedicated landing page at /category/<slug>.
 * The breadcrumb middle segment links to the category page only when
 * the product's category is in this set; unknown categories fall back
 * to "/" so the breadcrumb never produces a broken link.
 */
export const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_META));

/** The product's category landing-page meta (label + slug route) when it
 * has one — null for retired/unknown categories so the visible breadcrumb
 * and the back affordance below degrade to the home path instead of a
 * broken /category/<retired> link (the JSON-LD breadcrumb follows the same
 * KNOWN_CATEGORIES rule). */
export const categoryMetaFor = (cat: string | null | undefined) =>
  cat && KNOWN_CATEGORIES.has(cat) ? CATEGORY_META[cat as keyof typeof CATEGORY_META] : null;

// Empty-image fallback foreground tint per category. Mirrors the
// gradient palette above so the giant first-letter glyph reads as
// "this is a [category] product" without needing the actual image.
// Retired — same rationale as CATEGORY_GRADIENTS above.
export const CATEGORY_INITIAL_COLOR: Record<string, string> = categoryLookup(
  (row) => row.accent.text,
);
