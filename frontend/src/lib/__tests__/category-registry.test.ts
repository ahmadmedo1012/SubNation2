/**
 * R146 (components audit F2) — the category registry's byte-identity
 * contract.
 *
 * The whole point of folding the ~10 hand-rolled category tables onto
 * lib/category-registry was: the SAME rendered strings, derived once.
 * The per-surface suites pin their own slices (admin palette atoms,
 * category.tsx theme literals, Navbar labels, the cart 7-slug list);
 * this file pins the DERIVATIONS the surfaces compose — the composites
 * (rail tile, admin fallback tile, both admin option lists) and the
 * label flow — against the exact pre-R146 vocabulary, hardcoded below
 * from the tables the fold deleted. A registry row that drifts a single
 * character fails here before any surface renders it.
 *
 * Adding a category: add ONE registry row (plus the eager-safe pair in
 * lib/utils — LIVE_CATEGORY_SLUGS + the categoryLabel entry — and the
 * SEO/meta entry in lib/categories.ts), then extend the expectation
 * tables here — the failure message lists what every surface will
 * render.
 */
import { describe, expect, it } from "vitest";
import { categoryLabel, LIVE_CATEGORY_SLUGS } from "@/lib/utils";
import {
  CATEGORY_REGISTRY,
  LIVE_CATEGORY_ROWS,
  RETIRED_CATEGORY_ROWS,
  categoryLookup,
} from "@/lib/category-registry";
import {
  CATEGORY_GRADIENTS,
  CATEGORY_INITIAL_COLOR,
} from "@/components/product/category-presentation";
import {
  CATEGORY_FILTERS,
  CATEGORY_INITIAL_COLOR as ADMIN_INITIAL_COLOR,
  CATEGORY_OPTIONS,
} from "@/components/admin/products/products-meta";

/** The pre-R146 slug order: 7 live (storefront editorial) + 2 retired. */
const SLUGS = [
  "streaming",
  "music",
  "software",
  "vpn",
  "ai-tools",
  "seo-tools",
  "education",
  "gaming",
  "productivity",
] as const;

/** The pre-R146 PDP tables (category-presentation.ts) — verbatim. */
const OLD_GRADIENTS: Record<string, string> = {
  streaming: "from-cat-streaming/30 via-cat-streaming/15 to-transparent",
  music: "from-cat-music/30 via-cat-music/15 to-transparent",
  software: "from-cat-software/30 via-cat-software/15 to-transparent",
  vpn: "from-cat-vpn/30 via-cat-vpn/15 to-transparent",
  "ai-tools": "from-cat-ai-tools/30 via-cat-ai-tools/15 to-transparent",
  "seo-tools": "from-cat-seo-tools/30 via-cat-seo-tools/15 to-transparent",
  education: "from-cat-education/30 via-cat-education/15 to-transparent",
  gaming: "from-cat-gaming/30 via-cat-gaming/15 to-transparent",
  productivity: "from-cat-productivity/30 via-cat-productivity/15 to-transparent",
};
const OLD_PDP_INITIAL: Record<string, string> = {
  streaming: "text-cat-streaming",
  music: "text-cat-music",
  software: "text-cat-software",
  vpn: "text-cat-vpn",
  "ai-tools": "text-cat-ai-tools",
  "seo-tools": "text-cat-seo-tools",
  education: "text-cat-education",
  gaming: "text-cat-gaming",
  productivity: "text-cat-productivity",
};

/** The pre-R146 admin fallback tile (products-meta.ts) — the composite
 *  the registry now composes from its bg/10 + text atoms. */
const OLD_ADMIN_INITIAL: Record<string, string> = {
  streaming: "bg-cat-streaming/10 text-cat-streaming",
  music: "bg-cat-music/10 text-cat-music",
  software: "bg-cat-software/10 text-cat-software",
  vpn: "bg-cat-vpn/10 text-cat-vpn",
  "ai-tools": "bg-cat-ai-tools/10 text-cat-ai-tools",
  "seo-tools": "bg-cat-seo-tools/10 text-cat-seo-tools",
  education: "bg-cat-education/10 text-cat-education",
  gaming: "bg-cat-gaming/10 text-cat-gaming",
  productivity: "bg-cat-productivity/10 text-cat-productivity",
};

/** The pre-R146 admin option lists — the two-label vocabulary (only
 *  ai-tools carries the definite article; retired rows wear the
 *  «(مؤرشفة)» suffix in the editor select only). */
const OLD_OPTIONS = [
  { value: "", label: "اختر الفئة" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "software", label: "برامج وتراخيص" },
  { value: "vpn", label: "شبكات VPN" },
  { value: "ai-tools", label: "أدوات الذكاء الاصطناعي" },
  { value: "seo-tools", label: "أدوات SEO" },
  { value: "education", label: "تعليم ومكتبات" },
  { value: "gaming", label: "ألعاب (مؤرشفة)" },
  { value: "productivity", label: "إنتاجية (مؤرشفة)" },
];
const OLD_FILTERS = [
  { value: "", label: "الكل" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "software", label: "برامج وتراخيص" },
  { value: "vpn", label: "شبكات VPN" },
  { value: "ai-tools", label: "أدوات الذكاء الاصطناعي" },
  { value: "seo-tools", label: "أدوات SEO" },
  { value: "education", label: "تعليم ومكتبات" },
  { value: "gaming", label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

describe("R146 (F2) — the category registry derives the former tables byte-identically", () => {
  it("carries the 9 slugs in the storefront order (7 live, then the retired pair)", () => {
    expect(CATEGORY_REGISTRY.map((row) => row.slug)).toEqual([...SLUGS]);
    expect(LIVE_CATEGORY_ROWS.map((row) => row.slug)).toEqual(SLUGS.slice(0, 7));
    expect(RETIRED_CATEGORY_ROWS.map((row) => row.slug)).toEqual(SLUGS.slice(7));
  });

  it("utils' LIVE_CATEGORY_SLUGS (the eager Navbar source) stays in sync with the registry's live rows", () => {
    expect([...LIVE_CATEGORY_SLUGS]).toEqual(LIVE_CATEGORY_ROWS.map((row) => row.slug));
  });

  it("every row's label rides utils.categoryLabel (the canonical chip-brevity map)", () => {
    for (const row of CATEGORY_REGISTRY) {
      expect(row.label).toBe(categoryLabel(row.slug));
    }
  });

  it("the PDP gradient + initial-color lookups keep the former hand-rolled values", () => {
    expect(CATEGORY_GRADIENTS).toEqual(OLD_GRADIENTS);
    expect(CATEGORY_INITIAL_COLOR).toEqual(OLD_PDP_INITIAL);
  });

  it("the admin fallback tile composes the registry atoms into the former composites", () => {
    expect(ADMIN_INITIAL_COLOR).toEqual(OLD_ADMIN_INITIAL);
    // The composition itself — bg/10 + text, one space, nothing else.
    expect(ADMIN_INITIAL_COLOR).toEqual(
      categoryLookup((row) => `${row.accent.bg} ${row.accent.text}`),
    );
  });

  it("both admin option lists keep their former entries exactly (heads, labels, archived suffixes)", () => {
    expect(CATEGORY_OPTIONS).toEqual(OLD_OPTIONS);
    expect(CATEGORY_FILTERS).toEqual(OLD_FILTERS);
  });
});
