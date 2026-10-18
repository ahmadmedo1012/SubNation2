import { ORDER_COUNT_FORMS_SUBJECT, statusLabel } from "@/lib/utils";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the page's
// pure module constants (the r136 checkout idiom: filter-option lists,
// label maps and date comparators are React-free so any lane can import
// them). The BULK_STATUSES / STATUS_FILTERS derivations from statusLabel
// are byte-identical; only the `export` keyword was added.

// R124-I5 (A6 F2): bulk-action + filter-tab labels derive from
// statusLabel — the same map that feeds the row badges (the tickets.tsx
// pattern). The tabs previously hand-rolled a THIRD vocabulary mix
// («معلق»/«فاشل»/«مسترجع» tabs vs «قيد الانتظار»/«فشل»/«مُسترد» badges
// vs «مسترجع» bulk entries) — one status can never show two different
// Arabic words on one page (the status-badge invariant).
export const BULK_STATUSES = (["completed", "pending", "failed", "refunded"] as const).map((s) => ({
  value: s,
  label: statusLabel(s),
  /* R125-I2 (A6-B4): the raw -400 label hues collapse to 1.53-2.77:1
   * on the shipped light admin theme — the --status-* token family
   * (the StatusBadge ink) is contrast-safe in BOTH themes. Icons/dots
   * keep their raw hues elsewhere; these are TEXT labels. */
  color:
    s === "completed"
      ? "text-status-success"
      : s === "pending"
        ? "text-status-warning"
        : s === "failed"
          ? "text-status-error"
          : "text-status-info",
}));

export const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...(["completed", "pending", "failed", "refunded"] as const).map((s) => ({
    value: s,
    label: statusLabel(s),
  })),
];

export const DATE_RANGES = [
  { label: "الكل", days: 0 },
  { label: "اليوم", days: 1 },
  { label: "7 أيام", days: 7 },
  { label: "30 يوم", days: 30 },
];

/** 94-C2 (A2 P1-1 + P2-2): server-side page size for the orders
 *  list. The backend (routes/admin/orders.ts) clamps limit to
 *  [1, 200] (default 100) and supports `page` + `search`. Round-93
 *  made history reachable with page-swapping التالي/السابق controls;
 *  round-94 replaces them with the accumulating "load more" pattern
 *  (frozen contract: 1-based `page` + `limit`, response body stays a
 *  plain array) so fetched rows — and the operator's row selections —
 *  survive, while the server-side `?search=` (LIKE across order code /
 *  phone / email / name / product) reaches orders BEYOND the loaded
 *  window: the old client-side filter searched only what was already
 *  on screen, so an older order was "غير موجود" until you paged to it. */
export const ORDERS_PAGE_SIZE = 100;

/** Arabic plural forms for the orders counter (formatCount — the
 *  shared Arabic-plural helper had zero admin usage, A2 P3-4).
 *  R166-A (F16): the admin surfaces consuming this (OrdersHeader's
 *  «… إجمالاً» / «عرض …» counts, OrdersStatsPanel's parenthetical,
 *  OrdersTable's chip) are STANDALONE counts — the nominative dual
 *  «طلبان», now sourced from the shared SUBJECT registry instead of a
 *  hand-typed literal (zero/many stay local: the admin sites' forms
 *  differ from the storefront's). Rendered bytes unchanged. */
export const ORDER_COUNT_FORMS = {
  zero: "طلبات",
  one: "طلب",
  two: ORDER_COUNT_FORMS_SUBJECT.two,
  few: "طلبات",
  many: "طلبًا",
  other: "طلب",
};

// Arabic labels for the RefundService failure codes the 207 partial
// body carries (backend/src/services/refund.service.ts RefundErrorCode).
export const REFUND_FAILURE_LABELS: Record<string, string> = {
  ORDER_NOT_FOUND: "الطلب غير موجود",
  NOT_REFUNDABLE: "الطلب غير قابل للاسترداد",
  ALREADY_REFUNDED: "مُسترد مسبقاً",
  USER_NOT_FOUND: "المستخدم غير موجود",
  CONCURRENCY_ERROR: "تعارض تزامني",
};

// R151: Arabic labels for the bulk-status `reason` codes the backend
// returns when every requested id was skipped (updated:0). Mirrors the
// backend's F2/F3 guards (backend/src/routes/admin/orders.ts) — the
// operator sees the exact Arabic reason, never the raw English code nor
// a misleading green "Updated 0 orders".
export const BULK_SKIPPED_REASON_LABELS: Record<string, string> = {
  REFUNDED_IS_TERMINAL: "الطلبات المُستردة حالة نهائية",
  COMPLETED_IS_PURCHASE_ONLY: "الاكتمال يتم عبر عملية الشراء فقط",
  COMPLETED_NOT_DEMOTABLE: "لا يمكن التراجع عن طلب مكتمل",
};

export function isWithinDays(dateStr: string, days: number) {
  if (!days) return true;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

// ── R159 (the R158-A P3 «no sort affordance on orders» / the R158
// deferred ledger item): the ?sort= whitelist ──────────────────────────
// Hand-mirrors the backend route's zod enum (backend/src/routes/admin/
// orders.ts ORDER_SORT_VALUES) and the openapi param (the generated
// ListAdminOrdersSort). The generated const is deliberately NOT imported
// here: every admin orders render suite mocks @workspace/api-client-react
// with a narrow factory surface, so pulling a runtime value through
// orders-meta would crash those mocks at module init. Keep the three lists
// in lockstep — the orders-sort test pins meta ↔ generated parity.
export const ORDER_SORTS = [
  "created_at:asc",
  "created_at:desc",
  "total:asc",
  "total:desc",
] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

/** Tolerant intake: an invalid ?sort= deep link degrades to the default
 * ordering ("" — the param is dropped) instead of a 400. */
export const isOrderSort = (v: string): v is OrderSort =>
  (ORDER_SORTS as readonly string[]).includes(v);

/** The desktop sortable-header toggle: the default ("" — no ?sort= param)
 * IS created_at DESC (the header's «الأحدث أولاً» contract), so the
 * effective direction maps through before the asc/desc flip. */
export function nextOrderSort(key: "created_at" | "total", current: string): OrderSort {
  const effective = current === "" ? "created_at:desc" : current;
  return effective === `${key}:desc` ? `${key}:asc` : `${key}:desc`;
}

// R159: the mobile chip labels (the shared FilterTabs chips dialect —
// the users panel's «الأقدم» label precedent). The default maps to
// «الأحدث» because an absent ?sort= is newest-first.
export const ORDER_SORT_CHIPS: Array<{ value: OrderSort; label: string }> = [
  { value: "created_at:desc", label: "الأحدث" },
  { value: "created_at:asc", label: "الأقدم" },
  { value: "total:desc", label: "الأعلى قيمة" },
  { value: "total:asc", label: "الأقل قيمة" },
];
