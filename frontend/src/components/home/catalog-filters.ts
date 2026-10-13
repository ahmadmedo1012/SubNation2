import type { CategoryMeta } from "@/lib/categories";
import { categoryLabel } from "@/lib/utils";
import {
  AppWindow,
  GraduationCap,
  LayoutGrid,
  Music2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Tv2,
} from "lucide-react";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the catalog filter option tables + the mount-time querystring reader.
// Pure data + pure functions (zero React): CATEGORIES/SORTS feed the
// filter bar and the results grid (the same consumers as before — they
// now import them), BRANDS feeds the page's heroBrands memo, and
// readInitialFiltersFromUrl stays the R98-04 mount-time seed the page's
// filter-quartet state initializes from. The page imports them by name
// — every value, whitelist and label is byte-identical.

// The seven live catalog categories (mirrors products.category values
// verified against production — see lib/categories.ts). Retired chips
// (gaming/productivity) were removed once their products were archived:
// a chip that filters to an empty grid misleads shoppers.
// R134 (A2-F1): the labels DERIVE from categoryLabel() (lib/utils — the
// canonical chip-brevity map that already feeds the results h2 below,
// ProductCard badges, Product-LD and breadcrumbs). The previous
// hand-rolled table was a third parallel source: «برامج»/«VPN
// وشبكات»/«تعليم» chips sat a viewport away from the «برامج وتراخيص»/
// «شبكات VPN»/«تعليم ومكتبات» their own filter results rendered —
// one source, three consumers, zero drift (Navbar derives too).
export const CATEGORIES = [
  { value: "", label: "الكل", Icon: LayoutGrid },
  { value: "streaming", label: categoryLabel("streaming"), Icon: Tv2 },
  { value: "music", label: categoryLabel("music"), Icon: Music2 },
  { value: "software", label: categoryLabel("software"), Icon: AppWindow },
  { value: "vpn", label: categoryLabel("vpn"), Icon: ShieldCheck },
  { value: "ai-tools", label: categoryLabel("ai-tools"), Icon: Sparkles },
  { value: "seo-tools", label: categoryLabel("seo-tools"), Icon: TrendingUp },
  { value: "education", label: categoryLabel("education"), Icon: GraduationCap },
];

export const SORTS = [
  { value: "", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];

// ── R98-04 (A5 §2): catalog filters ↔ querystring ────────────────────────
//
// The four catalog filters (search/category/sort/availableOnly) lived in
// local state only — refresh, back-navigation from a product page, or a
// shared link all landed on a zeroed catalog (admin pages got ?search=
// syncing in 94-C2; the storefront never did). The filters now seed from
// the URL on mount and mirror back via history.replaceState on every
// change (replaceState, not pushState: filtering is the same logical
// page — the Back button must leave the page, not replay every filter
// click — and it is invisible to wouter, so no route re-resolution).
const SORT_VALUES = new Set(SORTS.map((s) => s.value));
const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value));

export function readInitialFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  // Whitelist category/sort values — a hand-typed ?sort=bogus must not
  // blank the <select> (an unknown value renders no <option> selected)
  // or arm a phantom filter chip.
  const rawCategory = params.get("category") ?? "";
  const rawSort = params.get("sort") ?? "";
  const search = params.get("search") ?? "";
  return {
    search,
    searchInput: search,
    category: CATEGORY_VALUES.has(rawCategory) ? rawCategory : "",
    sort: SORT_VALUES.has(rawSort) ? rawSort : "",
    availableOnly: params.get("available_only") === "true",
  };
}

/**
 * Featured brand chips on the editorial hero.
 *
 * Each entry has both the canonical Latin name (visible label —
 * preserves brand recognition for users) and the Arabic
 * transliteration (the form Arabic users actually type into Google:
 * "نتفلكس", "ديزني+", etc). The Arabic form is exposed to
 * crawlers via `aria-label` + a visually-hidden `.sr-only` span so
 * the chip carries Arabic-keyword weight without changing the visual.
 *
 * R120-B1 (A7-F5): every chip now references a brand the LIVE catalog
 * sells (verified against the active products + lib/categories.ts).
 * PlayStation Plus / Canva / Adobe / Microsoft 365 were removed —
 * their categories were archived 2026-09-19 and the catalog returns
 * 0 results for all four (a chip that filters to nothing misleads
 * shoppers and dilutes the page's topic vector).
 *
 * R122 (A11-F1): each chip now carries `cat` — the live category its
 * brand sells under — so the chip is a real navigation affordance to
 * that category's landing page (they were sr-only spans: advertised
 * brands shoppers could not tap). R122 (A11 P0-adjacent): the same
 * mapping powers the client-side in-stock surfacing below (chips whose
 * category currently has stock lead the row + carry a success dot);
 * while the live catalog runs this thin (44/45 sold out at audit
 * time), the hero must not funnel guests into a wall of نفد cards.
 */
export type HeroBrand = { latin: string; ar: string; cat: CategoryMeta["slug"] };
export const BRANDS: HeroBrand[] = [
  { latin: "Netflix", ar: "نتفلكس", cat: "streaming" },
  { latin: "Spotify", ar: "سبوتيفاي", cat: "music" },
  { latin: "Disney+", ar: "ديزني+", cat: "streaming" },
  { latin: "YouTube", ar: "يوتيوب", cat: "streaming" },
  // I-4 (R142): Shahid VIP swapped for Paramount+ — the live catalog no
  // longer sells Shahid (lane I's 2026-10-13 probe: search=شاهد → 0), so
  // the chip's own R120-B1 rule ("a chip that filters to nothing misleads
  // shoppers") fired on it; Paramount+ is verified-live in streaming
  // (docs/SEO_PRODUCTS.json). Restocking Shahid re-adds it the same way.
  { latin: "Paramount+", ar: "باراماونت+", cat: "streaming" },
  { latin: "ExpressVPN", ar: "إكسبرس في بي إن", cat: "vpn" },
  { latin: "ChatGPT Plus", ar: "شات جي بي تي", cat: "ai-tools" },
  { latin: "Windows 10", ar: "ويندوز 10", cat: "software" },
];
