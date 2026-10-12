// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the product page's category-tinted presentation maps + the shared
// KNOWN_CATEGORIES routing guard moved to their own module (pure data +
// one pure lookup; zero React). The page, its media section and the CTA
// block all import from here — one source, unchanged values.
import { CATEGORY_META } from "@/lib/categories";

// Category-tinted hero gradients on the product page. Ride the shared
// --cat-* tokens (defined in index.css, exposed to Tailwind via @theme)
// so the hero re-tones correctly on the light theme — the previous
// `from-violet-950 via-violet-900/60 to-violet-800/20` style produced
// a near-black slab on light backgrounds because the 800/900/950
// palette is dark-only by design.
export const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming: "from-cat-streaming/30 via-cat-streaming/15 to-transparent",
  music: "from-cat-music/30 via-cat-music/15 to-transparent",
  software: "from-cat-software/30 via-cat-software/15 to-transparent",
  vpn: "from-cat-vpn/30 via-cat-vpn/15 to-transparent",
  "ai-tools": "from-cat-ai-tools/30 via-cat-ai-tools/15 to-transparent",
  "seo-tools": "from-cat-seo-tools/30 via-cat-seo-tools/15 to-transparent",
  education: "from-cat-education/30 via-cat-education/15 to-transparent",
  // Retired categories — kept so archived products still render a
  // themed gradient if the operator previews them from admin.
  gaming: "from-cat-gaming/30 via-cat-gaming/15 to-transparent",
  productivity: "from-cat-productivity/30 via-cat-productivity/15 to-transparent",
};

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
export const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "text-cat-streaming",
  music: "text-cat-music",
  software: "text-cat-software",
  vpn: "text-cat-vpn",
  "ai-tools": "text-cat-ai-tools",
  "seo-tools": "text-cat-seo-tools",
  education: "text-cat-education",
  // Retired — same rationale as CATEGORY_GRADIENTS above.
  gaming: "text-cat-gaming",
  productivity: "text-cat-productivity",
};
