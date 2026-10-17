import {
  AppWindow,
  Briefcase,
  Gamepad2,
  GraduationCap,
  Music2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Tv2,
  type LucideIcon,
} from "lucide-react";
import { categoryLabel } from "@/lib/utils";

/**
 * R146 (components audit F2): THE category registry — the one table the
 * storefront's category vocabulary derives from. Ten hand-rolled
 * slug→(label | icon | accent-classes) tables had to change together
 * (ProductCard's CATEGORY_ACCENT + CATEGORY_ICON, CategoryRail's tile
 * tint, category-presentation's gradient/initial-color pair,
 * products-meta's INITIAL_COLOR + both admin option lists,
 * catalog-filters' CATEGORIES, Navbar's drawer list); a new category
 * missing one produced a half-themed surface. Adding a category is now
 * ONE row here (+ the eager-safe pair in lib/utils: a LIVE_CATEGORY_SLUGS
 * entry — the Navbar drawer's order source — and a categoryLabel entry,
 * the canonical chip-brevity map every label in these rows derives from,
 * + the SEO entry in lib/categories.ts; pages/category.tsx's
 * CATEGORY_THEME stays the per-surface landing-page density).
 *
 * Each row's class strings are LITERALS, spelled out once per category —
 * Tailwind's content scan only sees candidates that appear in source
 * text, so computing `bg-cat-${slug}/10` would silently drop every
 * utility from the bundle. Surfaces compose these atoms freely: the
 * parts (e.g. "bg-cat-streaming/10" + " " + "text-cat-streaming") each
 * appear here, which is all the scanner needs.
 *
 * Labels ride utils.categoryLabel (R134 A2-F1's canonical map — the
 * registry deliberately does NOT import labels inline) and NO eager
 * module imports this file: lib/utils feeds the eager entry chunk and
 * must not drag the lucide icon set with it (the R120-B5 eager-sum
 * budget), so Navbar (eager) derives from utils' LIVE_CATEGORY_SLUGS
 * instead — its sync with these rows is pinned by
 * lib/__tests__/category-registry.test.ts. Every other consumer
 * (ProductCard, catalog-filters, CategoryRail, products-meta) lives in
 * lazy chunks where the icons belong. Two label forms exist because
 * the surfaces genuinely render two: the chip-brevity `label` (chips,
 * drawer, rail) and `adminLabel` — the admin catalog selects' form,
 * which carries the definite article on ai-tools («أدوات الذكاء
 * الاصطناعي» vs the chip «أدوات ذكاء اصطناعي», per utils' A10-F8c
 * note); identical for every other slug. Both must be spelled out so
 * each surface keeps its byte-identical rendered strings.
 */

export interface CategoryAccent {
  bg: string;
  text: string;
  border: string;
  gradient: string;
  accentLine: string;
}

export interface CategoryRegistryRow {
  /** URL slug + database `products.category` value. */
  slug: string;
  /** Chip-brevity Arabic label (derived from lib/utils' categoryLabel). */
  label: string;
  /** The admin catalog selects' label (editor + toolbar filter) — the
   *  definite-article form where it diverges from chip-brevity. */
  adminLabel: string;
  /** The category's lucide icon — image-area fallback + chips + tiles. */
  Icon: LucideIcon;
  /** ProductCard's accent family (rides the shared --cat-* tokens). */
  accent: CategoryAccent;
  /** CategoryRail's tile tint (bg/12 + text composite). */
  tile: string;
  /** category-presentation's PDP hero gradient (from/30 via/15). */
  pdpGradient: string;
}

/** The seven live catalog categories, in storefront editorial order. */
const LIVE_ROWS: CategoryRegistryRow[] = [
  {
    slug: "streaming",
    label: categoryLabel("streaming"),
    // R161-C: streaming adminLabel = the chip label (identical now —
    // the family is all on-demand viewing platforms, no live-broadcast
    // service among the 17 live products).
    adminLabel: "منصات المشاهدة",
    Icon: Tv2,
    accent: {
      bg: "bg-cat-streaming/10",
      text: "text-cat-streaming",
      border: "border-cat-streaming/22",
      gradient: "from-cat-streaming/12 via-cat-streaming/4 to-transparent",
      accentLine: "bg-cat-streaming/55",
    },
    tile: "bg-cat-streaming/12 text-cat-streaming",
    pdpGradient: "from-cat-streaming/30 via-cat-streaming/15 to-transparent",
  },
  {
    slug: "music",
    label: categoryLabel("music"),
    // R161-C: music adminLabel = the chip label (TuneIn/Headspace/
    // Brain.fm make the family audio-wide, not music-only).
    adminLabel: "موسيقى وصوتيات",
    Icon: Music2,
    accent: {
      bg: "bg-cat-music/10",
      text: "text-cat-music",
      border: "border-cat-music/22",
      gradient: "from-cat-music/12 via-cat-music/4 to-transparent",
      accentLine: "bg-cat-music/55",
    },
    tile: "bg-cat-music/12 text-cat-music",
    pdpGradient: "from-cat-music/30 via-cat-music/15 to-transparent",
  },
  {
    slug: "software",
    label: categoryLabel("software"),
    adminLabel: "برامج وتراخيص",
    Icon: AppWindow,
    accent: {
      bg: "bg-cat-software/10",
      text: "text-cat-software",
      border: "border-cat-software/22",
      gradient: "from-cat-software/12 via-cat-software/4 to-transparent",
      accentLine: "bg-cat-software/55",
    },
    tile: "bg-cat-software/12 text-cat-software",
    pdpGradient: "from-cat-software/30 via-cat-software/15 to-transparent",
  },
  {
    slug: "vpn",
    label: categoryLabel("vpn"),
    adminLabel: "شبكات VPN",
    Icon: ShieldCheck,
    accent: {
      bg: "bg-cat-vpn/10",
      text: "text-cat-vpn",
      border: "border-cat-vpn/22",
      gradient: "from-cat-vpn/12 via-cat-vpn/4 to-transparent",
      accentLine: "bg-cat-vpn/55",
    },
    tile: "bg-cat-vpn/12 text-cat-vpn",
    pdpGradient: "from-cat-vpn/30 via-cat-vpn/15 to-transparent",
  },
  {
    slug: "ai-tools",
    label: categoryLabel("ai-tools"),
    adminLabel: "أدوات الذكاء الاصطناعي",
    Icon: Sparkles,
    accent: {
      bg: "bg-cat-ai-tools/10",
      text: "text-cat-ai-tools",
      border: "border-cat-ai-tools/22",
      gradient: "from-cat-ai-tools/12 via-cat-ai-tools/4 to-transparent",
      accentLine: "bg-cat-ai-tools/55",
    },
    tile: "bg-cat-ai-tools/12 text-cat-ai-tools",
    pdpGradient: "from-cat-ai-tools/30 via-cat-ai-tools/15 to-transparent",
  },
  {
    slug: "seo-tools",
    label: categoryLabel("seo-tools"),
    adminLabel: "أدوات SEO",
    Icon: TrendingUp,
    accent: {
      bg: "bg-cat-seo-tools/10",
      text: "text-cat-seo-tools",
      border: "border-cat-seo-tools/22",
      gradient: "from-cat-seo-tools/12 via-cat-seo-tools/4 to-transparent",
      accentLine: "bg-cat-seo-tools/55",
    },
    tile: "bg-cat-seo-tools/12 text-cat-seo-tools",
    pdpGradient: "from-cat-seo-tools/30 via-cat-seo-tools/15 to-transparent",
  },
  {
    slug: "education",
    label: categoryLabel("education"),
    adminLabel: "تعليم ومكتبات",
    Icon: GraduationCap,
    accent: {
      bg: "bg-cat-education/10",
      text: "text-cat-education",
      border: "border-cat-education/22",
      gradient: "from-cat-education/12 via-cat-education/4 to-transparent",
      accentLine: "bg-cat-education/55",
    },
    tile: "bg-cat-education/12 text-cat-education",
    pdpGradient: "from-cat-education/30 via-cat-education/15 to-transparent",
  },
];

/** Retired categories — kept so archived products still render a themed
 * accent/icon if surfaced from admin previews (r100), and so the admin
 * option lists can still manage their archived products. */
const RETIRED_ROWS: CategoryRegistryRow[] = [
  {
    slug: "gaming",
    label: categoryLabel("gaming"),
    adminLabel: "ألعاب",
    Icon: Gamepad2,
    accent: {
      bg: "bg-cat-gaming/10",
      text: "text-cat-gaming",
      border: "border-cat-gaming/22",
      gradient: "from-cat-gaming/12 via-cat-gaming/4 to-transparent",
      accentLine: "bg-cat-gaming/55",
    },
    tile: "bg-cat-gaming/12 text-cat-gaming",
    pdpGradient: "from-cat-gaming/30 via-cat-gaming/15 to-transparent",
  },
  {
    slug: "productivity",
    label: categoryLabel("productivity"),
    adminLabel: "إنتاجية",
    Icon: Briefcase,
    accent: {
      bg: "bg-cat-productivity/10",
      text: "text-cat-productivity",
      border: "border-cat-productivity/22",
      gradient: "from-cat-productivity/12 via-cat-productivity/4 to-transparent",
      accentLine: "bg-cat-productivity/55",
    },
    tile: "bg-cat-productivity/12 text-cat-productivity",
    pdpGradient: "from-cat-productivity/30 via-cat-productivity/15 to-transparent",
  },
];

/** All rows, live first then retired (the admin lists' order). */
export const CATEGORY_REGISTRY: readonly CategoryRegistryRow[] = [...LIVE_ROWS, ...RETIRED_ROWS];

/** The seven live rows, in storefront editorial order. */
export const LIVE_CATEGORY_ROWS: readonly CategoryRegistryRow[] = LIVE_ROWS;

/** The two retired rows (admin-manageable, archived). */
export const RETIRED_CATEGORY_ROWS: readonly CategoryRegistryRow[] = RETIRED_ROWS;

/** Derive a slug→value lookup over the registry rows (insertion order) —
 * the shared shape of every former hand-rolled table. */
export function categoryLookup<T>(value: (row: CategoryRegistryRow) => T): Record<string, T> {
  return Object.fromEntries(CATEGORY_REGISTRY.map((row) => [row.slug, value(row)] as const));
}
