// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the page's pure catalog vocabulary (the create/edit form's empty seed +
// the per-field SEO caps contract, the canonical 9-hue category fallback
// map, the two category option lists, the 200-row server cap and the
// Arabic plural forms for the catalog counter). React-free by contract
// (the r135/r136 pure-module idiom): the page, the editor shell, the
// toolbar and the card all import from here — one source for the admin
// products vocabulary; the move only changes its address, zero behavior
// change.
// R146 (components audit F2): the three category tables derive from
// lib/category-registry (THE category table). Its lucide icon references
// are data, not JSX (the r136 catalog-filters precedent) and every admin
// surface importing this vocabulary already loads lucide — the module
// still imports no React itself.
import {
  CATEGORY_REGISTRY,
  LIVE_CATEGORY_ROWS,
  RETIRED_CATEGORY_ROWS,
  categoryLookup,
} from "@/lib/category-registry";

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
  // R163: the feature bullets as the editor's string form — one bullet
  // per textarea line (startEdit seeds the live rows; the page's submit
  // splits lines back into the array).
  features: "",
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
 * comment early. R146 (F2): the composite derives from the registry's
 * accent atoms (bg/10 + text) — byte-identical values, retired rows
 * included. */
export const CATEGORY_INITIAL_COLOR: Record<string, string> = categoryLookup(
  (row) => `${row.accent.bg} ${row.accent.text}`,
);

// Seven live categories first (mirror products.category in production);
// gaming/productivity kept at the end so the operator can still manage
// their archived products (PS Plus, Xbox, Canva, MS 365 …) and re-list
// them the moment stock returns. R146 (F2): both lists map the
// registry's rows (adminLabel — the admin selects' label form); the
// only per-surface deltas left are the head entry and the «(مؤرشفة)»
// suffixes on the retired pair (OPTIONS only — the filter chips stay
// suffix-free so they read as filters, not warnings).
export const CATEGORY_OPTIONS = [
  { value: "", label: "اختر الفئة" },
  ...LIVE_CATEGORY_ROWS.map((row) => ({ value: row.slug, label: row.adminLabel })),
  ...RETIRED_CATEGORY_ROWS.map((row) => ({ value: row.slug, label: `${row.adminLabel} (مؤرشفة)` })),
];

export const CATEGORY_FILTERS = [
  { value: "", label: "الكل" },
  ...CATEGORY_REGISTRY.map((row) => ({ value: row.slug, label: row.adminLabel })),
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
