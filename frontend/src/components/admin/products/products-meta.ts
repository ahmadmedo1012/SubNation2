// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the page's pure catalog vocabulary (the create/edit form's empty seed +
// the per-field SEO caps contract, the canonical 9-hue category fallback
// map, the two category option lists, the 200-row server cap and the
// Arabic plural forms for the catalog counter). React-free by contract
// (the r135/r136 pure-module idiom): the page, the editor shell, the
// toolbar and the card all import from here — one source for the admin
// products vocabulary; the move only changes its address, zero behavior
// change.

export const EMPTY_FORM = {
  name: "",
  description: "",
  image_url: "",
  price: "",
  cost_price: "",
  category: "",
  usage_terms: "",
  // R123 (E3 item 2): the operator SEO overrides (backend columns
  // seo_title ≤200 / seo_description ≤320). Empty-by-default for the
  // CREATE path; startEdit seeds the row's LIVE values (R125-I3 — the
  // list payload now carries them). The submit path still omits
  // UNTOUCHED fields (see handleSubmit) as belt-and-suspenders against
  // accidental clears.
  seo_title: "",
  seo_description: "",
  is_active: true,
};

/** The editor's flat form shape (typeof EMPTY_FORM) — one source for the
 * page's form/baseline atoms and the ProductEditorCard props. */
export type ProductForm = typeof EMPTY_FORM;

/* R128 (A1-D4/F1): the admin fallback tile rode raw palette hues that
 * DIVERGE from the storefront's --cat-* tokens for the same category
 * (software: sky vs the token's 217° blue; vpn: cyan vs 199°) — the
 * one true semantic split between the two surfaces. Migrated to the
 * canonical 9-hue family (the storefront chip recipe — a cat hue at
 * 10% surface + the full cat hue ink — AA-tuned in both themes by the
 * R124 sweep). NOTE: keep any literal class mention out of this
 * comment — a `bg-cat-STAR-SLASH-10` string would close this block
 * comment early. */
export const CATEGORY_INITIAL_COLOR: Record<string, string> = {
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

// Seven live categories first (mirror products.category in production);
// gaming/productivity kept at the end so the operator can still manage
// their archived products (PS Plus, Xbox, Canva, MS 365 …) and re-list
// them the moment stock returns.
export const CATEGORY_OPTIONS = [
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

export const CATEGORY_FILTERS = [
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

/** R120-B4 (A2-F2): the backend list (routes/admin/products.ts) clamps
 *  at 200 newest rows with NO page param — the client-side search used
 *  to run only over that window while the header presented its length
 *  as «N منتج في الكتالوج» (a false total: older products beyond the
 *  cap were invisible to both the search and the counter). The search
 *  now rides the server-side ?search= (ILIKE + trigram, covers the
 *  WHOLE catalog); a full 200-row page means the total is NOT known
 *  and the header switches to the honest «عرض N (الأحدث أولاً)».
 *  Accumulating load-more is impossible against this frozen contract
 *  (no `page` param server-side) — the cap hint + search is the honest
 *  surface instead. */
export const PRODUCTS_SERVER_CAP = 200;

/** Arabic plural forms for the catalog counter (formatCount). */
export const PRODUCT_COUNT_FORMS = {
  zero: "منتجات",
  one: "منتج",
  two: "منتجان",
  few: "منتجات",
  many: "منتجًا",
  other: "منتج",
};
