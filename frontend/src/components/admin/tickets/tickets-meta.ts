import { TICKET_STATUSES } from "@/components/ui/status-badge";
import { statusLabel } from "@/lib/utils";
import type { AdminTicketSummary, AdminTicketThread } from "@workspace/api-client-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's pure metadata moved to its own React-free module so the
// page file shrinks to orchestration. The page (and the extracts)
// import these by name — every map, constant and predicate is
// byte-identical; ZERO behavior change. The reply/status money path
// that CONSUMES the 401 predicate stays in the page (the catches
// duck-type it; the predicate itself is pure). The generated row types
// aliased below are TYPE-ONLY (erased at runtime — no react-query /
// api-client runtime surface ever rides through this module).

// Ticket status rendering now derives from the shared canonical maps:
// tone = STATUS_TONE[status] (info/warning/neutral on the --status-*
// tokens), label = statusLabel(status) — one source shared with the
// storefront wallet/orders surfaces (93-C7 / C-UX2).
export const CATEGORIES: Record<string, string> = {
  billing: "الدفع",
  order: "الطلبات",
  technical: "تقني",
  account: "الحساب",
  other: "أخرى",
};

// Filter labels derive from statusLabel (93-C7 / C-UX5, A12 §2.4): the
// tabs previously hand-repeated the same words as the badges — now one
// map feeds both, so the «معلق/قيد الانتظار»-class drift can't recur.
export const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...TICKET_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
];

export const CATEGORY_FILTERS = [
  { value: "", label: "جميع الفئات" },
  { value: "billing", label: "الدفع" },
  { value: "order", label: "الطلبات" },
  { value: "technical", label: "تقني" },
  { value: "account", label: "الحساب" },
  { value: "other", label: "أخرى" },
];

/** 94-C2 (A2 P1-1): page size for the support queue — the backend
 *  truncates at 100 rows with no page param; the UI now drives the
 *  frozen `?page=&limit=` contract and accumulates in place. */
export const TICKETS_PAGE_SIZE = 100;

/** Arabic plural forms for the queue counter (formatCount, A2 P3-4). */
export const TICKET_COUNT_FORMS = {
  zero: "تذاكر",
  one: "تذكرة",
  two: "تذكرتان",
  few: "تذاكر",
  many: "تذكرةً",
  other: "تذكرة",
};

// R127-L1: the hand-rolled row/thread interfaces are the generated
// AdminTicketSummary / AdminTicketThread (field-identical — the batch-1
// contract row pins the shapes); aliased so the render code keeps its
// local names.
export type TicketSummary = AdminTicketSummary;
export type TicketDetail = AdminTicketThread;

/** R127-L1 (B1 §3.4 step 5): a 401 from the generated fetcher is the
 * global admin-session handler's business (toast + redirect fired inside
 * customFetch) — the catches below stay quiet on it. ApiError is
 * type-only from the package, so the check duck-types `status` (the
 * alerts.tsx R126-L8b idiom). */
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}
