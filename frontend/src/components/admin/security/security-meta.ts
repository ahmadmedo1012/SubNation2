// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the page's pure label maps, window/page-size constants, Arabic plural
// forms and predicates moved to their own React-free module so the page
// file shrinks to orchestration. The page (and the extracts) import these
// by name — every map, constant and function is byte-identical; ZERO
// behavior change. The queries and quiet-catches that CONSUME the 401
// predicate stay in the page (the catches duck-type it; the predicate
// itself is pure). The generated row types re-exported below are
// TYPE-ONLY (erased at runtime — no react-query / api-client runtime
// surface ever rides through this module).

// R126-L8b: customFetch rejects 401s with its ApiError — type-only from
// the package, so the quiet-catch duck-types the `status` field (the
// App.tsx isRetryableQueryError idiom).
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

/** 94-C2 (A2 P3-18): the timeline used to render the raw backend
 *  `action` enum in English ("login") while the filter select next to
 *  it showed the same value in Arabic — one shared map keeps the two
 *  in lockstep. */
export const ACTION_LABELS: Record<string, string> = {
  login: "تسجيل دخول",
  register: "تسجيل",
  logout: "تسجيل خروج",
  change_password: "تغيير كلمة المرور",
  unlink_provider: "فصل مزود",
};

export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

/**
 * R127-L5 (B15-1): the audit-trail tab's Arabic action map — the
 * actionLabel idiom applied to the `<resource>.<verb>` audit action
 * strings (the writer inventory across admin/topups, users, orders,
 * coupons, products, pricing, flash-sales, tickets, risk, admins,
 * alerts, whatsapp, settings + the B11-F1 telegram webhook rows).
 * Unknown actions fall back to the raw stable string (honest, and a
 * new writer can't break the tab).
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "topup.approve": "اعتماد شحن رصيد",
  "topup.reject": "رفض شحن رصيد",
  "user.update": "تحديث مستخدم",
  "order.credentials_view": "عرض بيانات طلب",
  "order.bulk_refund": "استرداد جماعي للطلبات",
  "order.bulk_status_update": "تحديث حالة الطلبات جماعياً",
  "referral.credit": "قيد نقاط إحالة",
  "coupon.create": "إنشاء كوبون",
  "coupon.update": "تحديث كوبون",
  "coupon.archive": "أرشفة كوبون",
  "product.create": "إنشاء منتج",
  "product.update": "تحديث منتج",
  "product.archive": "أرشفة منتج",
  "product.inventory.set-count": "تعيين مخزون منتج",
  "product.inventory.upload": "رفع مخزون منتج",
  "product.variant.create": "إنشاء خيار منتج",
  "product.variant.update": "تحديث خيار منتج",
  "product.variant.delete": "حذف خيار منتج",
  "pricing.config.update": "تحديث إعدادات التسعير",
  "pricing.recompute": "إعادة احتساب الأسعار",
  "flash_sale.create": "إنشاء عرض فلاش",
  "flash_sale.update": "تحديث عرض فلاش",
  "flash_sale.deactivate": "إيقاف عرض فلاش",
  "ticket.reply": "رد على تذكرة",
  "ticket.status_update": "تحديث حالة تذكرة",
  "risk.label": "وسم حدث مخاطر",
  "risk.rule_update": "تحديث قاعدة مخاطر",
  "risk.config_update": "تحديث إعدادات المخاطر",
  "risk.synth": "إنشاء حدث مخاطر تجريبي",
  "risk.soft_block_applied": "حظر مؤقت لمستخدم",
  "risk.hard_block_applied": "حظر دائم لمستخدم",
  "admin.created": "إنشاء مسؤول",
  "admin.updated": "تحديث مسؤول",
  "admin.disabled": "تعطيل مسؤول",
  "admin.enabled": "تفعيل مسؤول",
  "admin.logout": "تسجيل خروج مسؤول",
  "admin.password_changed": "تغيير كلمة مرور المسؤول",
  "admin.totp_enabled": "تفعيل المصادقة الثنائية",
  "admin.totp_disabled": "تعطيل المصادقة الثنائية",
  "alert.test_dispatch": "إرسال تنبيه تجريبي",
  "whatsapp.session_create": "إنشاء جلسة واتساب",
  "whatsapp.session_start": "تشغيل جلسة واتساب",
  "whatsapp.session_pair_code": "ربط جلسة واتساب",
  "whatsapp.session_delete": "حذف جلسة واتساب",
  "settings.auth_provider.update": "تحديث مزود مصادقة",
};

export const auditActionLabel = (a: string) => AUDIT_ACTION_LABELS[a] ?? a;

export const AUDIT_ACTOR_TYPE_LABELS: Record<string, string> = {
  admin: "مسؤول",
  user: "مستخدم",
  system: "النظام",
};

/** R125-I5 (A3-5): the backend hard-caps auth-activity at .limit(100)
 *  (admin/security.ts) with no page param and no total — the window the
 *  UI receives is always "the newest 100 at most". Surfaced honestly
 *  instead of presenting a truncated audit log as complete. */
export const ACTIVITY_WINDOW_CAP = 100;

/** Arabic plural forms for the timeline counter (formatCount, A2 P3-4). */
export const ACTIVITY_COUNT_FORMS = {
  zero: "أحداث",
  one: "حدث",
  two: "حدثان",
  few: "أحداث",
  many: "حدثاً",
  other: "حدث",
};

/** R127-L5: the audit tab's page size — matches the endpoint's default
 *  (backend clamps to [1, 200]; the UI pins it so the «عرض N من إجمالاً
 *  M» counter and the pager stay in lockstep). */
export const AUDIT_PAGE_SIZE = 50;

/** Arabic plural forms for the audit-trail counter (formatCount). */
export const AUDIT_COUNT_FORMS = {
  zero: "إجراءات",
  one: "إجراء",
  two: "إجراءان",
  few: "إجراءات",
  many: "إجراءًا",
  other: "إجراء",
};

/** The auth timeline's filter atoms (the page's `filters` useState
 *  shape — structural, so the page's inferred tuple stays compatible). */
export type AuthTimelineFilters = { action: string; success: string };

/** The audit tab's filter draft (the page's `auditFilters` useState
 *  shape — action rides the 300 ms debounce; actor/date fire on
 *  complete values). */
export type AuditFilterDraft = {
  action: string;
  actor: string;
  startDate: string;
  endDate: string;
};

/** B11-F1 rows identify the actor in metadata (actorId is null for the
 * telegram webhook path) — a compact `key=value` join of the parsed
 * payload, LTR + truncated, so the tab names WHO without dumping the
 * raw JSON blob. */
export function auditMetadataLine(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return entries.length > 0 ? entries.slice(0, 6).join(" · ") : null;
  } catch {
    return null;
  }
}

export type {
  AdminAuthActivity,
  AdminAuditLog,
  AdminAuthStatsSummary,
} from "@workspace/api-client-react";
