import type { AdminAlert, AdminAlertsPage } from "@workspace/api-client-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the inbox's pure metadata and helpers moved to their own React-free
// module so the page file shrinks to orchestration. The page (and the
// extracts) import these by name — every type, constant, table and
// predicate is byte-identical; ZERO behavior change. The five mutations
// that CONSUME isSessionExpiredError / alertActionToast stay in the page
// (the optimistic cache patches + toasts fire only through page-owned
// onMutate/onError handlers).

export type AlertType =
  "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock" | "system" | "forecast_stockout";

/** R126-L8b: rows come from the generated client now — AdminAlert.type
 * is an open string (the spec deliberately keeps it non-enum so a new
 * alert producer can't break the contract); the known-type map stays
 * keyed by the AlertType union and the two row-type lookups below cast
 * through it with the same fallbacks as before. */
export type AdminAlertItem = AdminAlert;

export type AlertsPageData = AdminAlertsPage;

export type FilterType = "all" | "unread" | AlertType;

/** R125 (A3 #6): the filter tabs now cover EVERY type TYPE_META renders
 * (system + forecast_stockout rows were rendered but unfilterable —
 * the filter runs client-side over the loaded window, so both entries
 * are a pure UI completion; the backend list endpoint has no type
 * param to consult). */
export const FILTERS: { value: FilterType; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "unread", label: "غير مقروء" },
  { value: "no_stock", label: "نفاد مخزون" },
  { value: "low_stock", label: "مخزون منخفض" },
  { value: "forecast_stockout", label: "نفاد متوقع" },
  { value: "coupon_maxed", label: "كوبون استُنفد" },
  { value: "coupon_expiring", label: "كوبون منتهٍ" },
  { value: "system", label: "نظام" },
];

/** 94-C2 (A2 P1-1): page size for the alerts inbox — the backend's
 *  DEFAULT_LIMIT is 50 with `page`/`limit` (and total/hasMore) already
 *  supported; the UI previously loaded one silent 50-row window while
 *  the footer claimed «N تنبيه إجمالاً». The frozen `?page=&limit=`
 *  contract now accumulates in place. */
export const ALERTS_PAGE_SIZE = 50;

/** Query key — keeps the "admin-alerts" prefix so the existing
 *  invalidations (`["admin-alerts"]`) refresh the accumulated pages. */
export const ALERTS_LIST_KEY = ["admin-alerts", "inbox"] as const;

/** Arabic plural forms for تنبيه (formatCount) — shared by the footer's
 *  «عرض N» counter and the R123 deleteRead confirm's count copy. */
export const ALERT_COUNT_FORMS = {
  zero: "تنبيهات",
  one: "تنبيه",
  two: "تنبيهان",
  few: "تنبيهات",
  many: "تنبيهًا",
  other: "تنبيه",
};

/** 94-C2 (A2 P2-10) → R126-L8b: a 401 from the generated fetcher is the
 * global admin-session handler's business (toast + redirect fired inside
 * customFetch) — the mutations below stay quiet on it. ApiError is
 * type-only from the package, so the check duck-types `status`. */
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

/** 94-C2 (A2 P2-11): the inbox mutations get the same error surface as
 *  every other admin action (r.ok + parsed envelope + onError toast) —
 *  a failed delete/read used to invalidate the cache and silently
 *  resurrect the rows. */
export function alertActionToast(title: string, description: string) {
  return { title, description, variant: "destructive" as const };
}

// (R126-L8b) AlertsPageData is the generated AdminAlertsPage envelope —
// every field the handler emits (alerts, unreadCount, total, page,
// limit, hasMore) is required in the contract now.

export type AlertsInfiniteData = { pages: AlertsPageData[]; pageParams: number[] };

/** Maps the cached infinite shape with one shared helper so the three
 *  optimistic mutations below stay in lockstep. (patchCachedAlerts — the
 *  function itself — lives in the PAGE beside the mutations that call
 *  it; R137 decomposition.) */

export function groupByDate(
  alerts: AdminAlertItem[],
): { label: string; items: AdminAlertItem[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const weekAgo = today - 7 * 86_400_000;

  const groups: { label: string; items: AdminAlertItem[] }[] = [
    { label: "اليوم", items: [] },
    { label: "أمس", items: [] },
    { label: "هذا الأسبوع", items: [] },
    { label: "أقدم", items: [] },
  ];

  for (const a of alerts) {
    const t = new Date(a.createdAt).getTime();
    if (t >= today) groups[0].items.push(a);
    else if (t >= yesterday) groups[1].items.push(a);
    else if (t >= weekAgo) groups[2].items.push(a);
    else groups[3].items.push(a);
  }

  return groups.filter((g) => g.items.length > 0);
}
