import type { Colors } from "@/theme";

/**
 * The storefront's static vocabulary — the native twin of the web's
 * lib/category-registry.ts + components/home/catalog-filters.ts tables
 * (R146/R134: THE category table; a new category is ONE row here plus a
 * cat* token in theme/colors.ts).
 *
 * Labels mirror the web's canonical chip-brevity map
 * (frontend/src/lib/utils.ts → categoryLabel) byte-for-byte — the same
 * strings the web's chips, ProductCard badges and category heroes render.
 */

/** Category accent keys — the cat* tokens of the theme palette. */
export type CategoryColorKey = {
  [K in keyof Colors]: K extends `cat${string}` ? K : never;
}[keyof Colors];

export interface CategoryMeta {
  /** URL slug + database `products.category` value. */
  slug: string;
  /** Chip-brevity Arabic label (the web's categoryLabel form). */
  label: string;
  /** Theme color key — screens index into `useColors()` via this key. */
  colorKey: CategoryColorKey;
  /** SF Symbol name (iOS) — paired with `md`, never shipped alone. */
  sf: string;
  /** MaterialIcons glyph name (Android). */
  md: string;
}

/** The seven live catalog categories, in storefront editorial order. */
export const CATEGORIES: CategoryMeta[] = [
  {
    slug: "streaming",
    label: "منصات المشاهدة",
    colorKey: "catStreaming",
    sf: "tv",
    md: "tv",
  },
  {
    slug: "music",
    label: "موسيقى وصوتيات",
    colorKey: "catMusic",
    sf: "music.note",
    md: "music-note",
  },
  {
    slug: "software",
    label: "برامج وتراخيص",
    colorKey: "catSoftware",
    sf: "macwindow",
    md: "apps",
  },
  {
    slug: "vpn",
    label: "شبكات VPN",
    colorKey: "catVpn",
    sf: "shield.checkered",
    md: "vpn-lock",
  },
  {
    slug: "ai-tools",
    label: "أدوات ذكاء اصطناعي",
    colorKey: "catAiTools",
    sf: "sparkles",
    md: "auto-awesome",
  },
  {
    slug: "seo-tools",
    label: "أدوات SEO",
    colorKey: "catSeoTools",
    sf: "chart.line.uptrend.xyaxis",
    md: "trending-up",
  },
  {
    slug: "education",
    label: "تعليم ومكتبات",
    colorKey: "catEducation",
    sf: "graduationcap",
    md: "school",
  },
];

/** Lookup a live category row (null for unknown/retired slugs). */
export function categoryMeta(slug: string | null | undefined): CategoryMeta | null {
  if (!slug) return null;
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/** Slug → Arabic label (unknown slugs degrade to the raw slug, like the web). */
export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "عام";
  return categoryMeta(slug)?.label ?? slug;
}

/** Catalog sort values — "" is the backend default (الأحدث). */
export type SortValue = "" | "popular" | "price_asc" | "price_desc";

/** Sort options — mirrors the web's SORTS table (catalog-filters.ts). */
export const SORTS: { value: SortValue; label: string }[] = [
  { value: "", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];
