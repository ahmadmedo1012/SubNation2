import { Clock, Plus } from "lucide-react";
import { NAV_SECTIONS } from "./nav-sections";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the admin shell's pure nav-derivation logic: the route→title map (derived
// from NAV_SECTIONS so nav labels and top-bar/document titles cannot drift),
// the longest-prefix active-route matcher, the storefront title the layout
// restores on unmount, and the per-route context-action shortcuts the active
// nav item renders. React-free (the Clock/Plus imports are icon REFERENCES
// the CONTEXT_ACTIONS table carries — data, not JSX — the home/catalog-filters
// precedent); the move only changes its address, zero behavior change.

// R124-I5 (A6 F16): the top-bar titles derive from NAV_SECTIONS — ONE
// source. The hand-maintained map had drifted on three routes (nav
// «الرئيسية» vs title «لوحة التحكم», nav «سجل الأمان» vs «الأمان», nav
// «التنبيهات» vs «صندوق التنبيهات»); deriving keeps nav and title
// honest by construction — a label can never change in one place only.
const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.href, i.label])),
);

/** R125 (A6 B-1): mirrors the App-level fallback MetaTags title
 *  (App.tsx) — restored on AdminLayout unmount so routes without a
 *  layout (/admin/login) don't inherit the last visited page's title.
 *  A local constant: importing it from App.tsx would be circular
 *  (App → lazy admin pages → layout). */
export const STOREFRONT_DEFAULT_TITLE = "SubNation — سوق الاشتراكات الرقمية";

/** Detail-route title fallbacks (no exact PAGE_TITLES entry possible). */
export function pageTitleFor(location: string): string {
  if (PAGE_TITLES[location]) return PAGE_TITLES[location];
  if (location.startsWith("/admin/risk/events/")) return "تفاصيل الحدث — مراقبة المخاطر";
  return "الإدارة";
}

/**
 * Longest-prefix match across all nav hrefs: the most specific nav item
 * stays highlighted on detail/sub routes (e.g. /admin/risk/events/:id
 * lights up مراقبة المخاطر, /admin/products/enrichment lights up its own
 * entry rather than المنتجات). Exact-match only used to leave these
 * routes dark.
 */
const ALL_NAV_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
export function computeActiveHref(location: string): string {
  const matches = ALL_NAV_HREFS.filter((h) => h === location || location.startsWith(h + "/"));
  if (matches.length === 0) return location;
  return matches.sort((a, b) => b.length - a.length)[0];
}

export const CONTEXT_ACTIONS: Record<
  string,
  { label: string; icon: React.ElementType; href: string }[]
> = {
  "/admin/products": [{ label: "إضافة منتج جديد", icon: Plus, href: "/admin/products#new" }],
  // R120-B4 (A2-F7): the topups context action used to link to the
  // page ITSELF (no filter — a dead link). It now deep-links the
  // pending queue via ?status=pending, which topups.tsx consumes on
  // mount. The orders entry ("آخر الطلبات" → the same unfiltered
  // page) was removed outright: the orders list is newest-first by
  // server default, so the link promised a filter that does not
  // exist — only the working products#new pattern stays.
  // R124-C2 (A6 F2): «قيد الانتظار فقط» — the last معلق-family string
  // on the topups surface; the CTA now reads exactly like the queue tab
  // and row badges it deep-links to (?status=pending → statusLabel).
  "/admin/topups": [
    { label: "قيد الانتظار فقط", icon: Clock, href: "/admin/topups?status=pending" },
  ],
};
