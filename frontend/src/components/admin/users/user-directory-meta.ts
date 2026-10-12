// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the users directory's pure module: the wallet-edit form contract, the
// tier/sort option lists, the tier→StatusBadge tone map, the load-more
// page size, the Arabic plural forms for the directory counter and the
// backend-Arabic save-error describer. ZERO React, zero behavior change
// (the page and the row extracts import them by name — every value and
// call site stays byte-identical).

import { type StatusBadgeVariant } from "@/components/ui/status-badge";

export interface EditUserForm {
  wallet_mode: "set" | "add" | "subtract";
  wallet_value: string;
  loyalty_points: string;
  // (r110) Backend contract (round-94 39a84be): PATCH
  // /api/admin/users/:id requires `note` (≥3 trimmed chars)
  // whenever a wallet field (wallet_adjustment / wallet_balance)
  // rides the body — the operator justification recorded on the
  // wallet_ledger row.
  // R115 (A1/A5 + backend 6caa63b): the note is now ALSO required
  // whenever loyalty_points rides the body (points are LYD-convertible
  // money — 100:1 — and the admin_set points_ledger row persists the
  // reason); loyalty_tier is GONE from the form entirely (tiers derive
  // strictly from net qualifying spend, Part 11 — the backend rejects
  // any loyalty_tier with a 400).
  note: string;
}

export const TIER_FILTERS = [
  { value: "", label: "الكل" },
  { value: "bronze", label: "برونزي" },
  { value: "silver", label: "فضي" },
  { value: "gold", label: "ذهبي" },
  { value: "platinum", label: "بلاتيني" },
];

export const SORT_OPTIONS = [
  { value: "wallet_desc", label: "الرصيد ↓" },
  { value: "spend_desc", label: "الإنفاق ↓" },
  { value: "orders_desc", label: "الطلبات ↓" },
  { value: "points_desc", label: "النقاط ↓" },
  { value: "created_asc", label: "الأقدم" },
];

/** R125-I4 (A6 B-4): tier → StatusBadge tone (theme-aware by
 * construction — the raw cyan-400/yellow-400/slate-300/amber-600 pill
 * failed 1.4.3 AA on the light theme). bronze→low-stock (orange),
 * gold→warning, platinum→info, silver→neutral. */
export const TIER_TONE: Record<string, StatusBadgeVariant> = {
  bronze: "low-stock",
  silver: "neutral",
  gold: "warning",
  platinum: "info",
};

/** 94-C2 (A2 P1-1): the backend supports `page`/`limit` (clamped
 *  1..200, default 100) but the UI never sent either — the directory
 *  silently capped at the newest 100 users while the summary cards
 *  presented the slice as «إجمالي المستخدمين / الأرصدة / الإنفاق».
 *  The frozen `?page=&limit=` contract now accumulates in place. */
export const USERS_PAGE_SIZE = 100;

/** Arabic plural forms for the directory counter (formatCount, A2 P3-4). */
export const USER_COUNT_FORMS = {
  zero: "مستخدمين",
  one: "مستخدم",
  two: "مستخدمان",
  few: "مستخدمين",
  many: "مستخدمًا",
  other: "مستخدم",
};

// R115: prefer the backend's OWN Arabic wording on save failures — the
// users PATCH route answers with specific, actionable messages (the
// loyalty note/scope guardrails, the derived-tier 400, points bounds,
// the CONCURRENT points race…). getErrorMessage()'s code map collapses
// them all into generic per-code Arabic; the raw message is the honest
// text when it carries Arabic script (same describeError pattern as the
// pricing page).
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

export function describeSaveError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null })?.data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  const direct =
    (err as { error?: string; message?: string } | null)?.error ??
    (err as { message?: string } | null)?.message;
  if (typeof direct === "string" && direct.trim() && ARABIC_SCRIPT_RE.test(direct)) return direct;
  return "";
}
