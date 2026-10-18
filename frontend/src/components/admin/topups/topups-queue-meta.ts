import { ORDER_COUNT_FORMS_SUBJECT, statusLabel } from "@/lib/utils";
import type { AdminTopup } from "@workspace/api-client-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue's pure metadata moved to its own React-free module so the page
// file shrinks to orchestration. The page (and the extracts) import these
// by name — every type, constant and predicate is byte-identical; ZERO
// behavior change. The money-path handlers that CONSUME the 401 predicate
// stay in the page (the loops break on it; the predicate itself is pure).

export type AdminTopupRow = AdminTopup & { payment_method?: string; sender_account?: string };

/** R127-L1 (B1 §3.2): a 401 from the generated fetcher is the global
 * admin-session handler's business (toast + redirect fired inside
 * customFetch) — the money loops below break on it quietly. ApiError
 * is type-only from the package, so the check duck-types `status` (the
 * alerts.tsx R126-L8b idiom; replaces the raw loops' isAdminUnauthorized
 * Response check). */
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

// R124-I5 (A6 F2): tab labels derive from statusLabel — the same map
// that feeds the row badges (the tickets.tsx STATUS_FILTERS pattern). The
// tabs previously hand-rolled «معلق»/«مقبول» while the badges on the very
// same cards read «قيد الانتظار»/«موافق عليه» — one status can never show
// two different Arabic words on one page (the status-badge invariant).
export const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...(["pending", "approved", "rejected"] as const).map((s) => ({
    value: s,
    label: statusLabel(s),
  })),
];

/** 94-C2 (A2 P1-1): page size for the topup queue — the backend
 *  truncates at 100 rows with NO page param (money queue), so the
 *  frontend now drives the frozen `?page=&limit=` contract itself and
 *  accumulates pages in place. 100 keeps the first payload identical
 *  to what the route already returned. */
export const TOPUPS_PAGE_SIZE = 100;

/** Arabic plural forms for the queue counter (formatCount, A2 P3-4).
 *  R166-A (F16): the queue's count surfaces (TopupsHeader's
 *  «… إجمالاً» / «عرض …» / «نتائج البحث: …» and BulkConfirmModal's
 *  «… سيتم معالجته» — the noun is the sentence SUBJECT there) are
 *  nominative contexts — the dual «طلبان», now sourced from the shared
 *  SUBJECT registry instead of a hand-typed literal (zero/many stay
 *  local: this file's forms differ from the storefront's). Rendered
 *  bytes unchanged. */
export const TOPUP_COUNT_FORMS = {
  zero: "طلبات",
  one: "طلب",
  two: ORDER_COUNT_FORMS_SUBJECT.two,
  few: "طلبات",
  many: "طلبًا",
  other: "طلب",
};
