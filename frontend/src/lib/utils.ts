import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Round-3 (8-e §1.1): group thousands with Intl so money-critical surfaces
// stop rendering "12345.50 د.ل" (digit-count misreads on wallet balances
// and revenue tiles). Deliberately en-US grouping ("1,234.50") — the
// site's established numeral language is Latin digits, and ar-LY's CLDR
// separators ("1.234,50" + a trailing-dot currency glyph "د.ل.") would
// flip every separator on every screen at once. Currency label stays the
// hand-written " د.ل" suffix. Cached formatter instance per call pattern
// — Intl.NumberFormat construction is the expensive part, so we reuse a
// module-level formatter (options never vary).
const CURRENCY_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "0.00 د.ل";
  return `${CURRENCY_NUMBER_FORMATTER.format(amount)} د.ل`;
}

// Round-3 (8-e §4 — Arabic pluralization): Arabic needs one/two/few/many
// forms (منتج واحد / منتجان / منتجات / منتجاً). Every count+noun site
// previously froze a single form. This helper implements the six-way
// Arabic plural rules via Intl.PluralRules so count labels read natively.
// Usage: formatCount(3, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" })
const AR_PLURAL_RULES =
  typeof Intl !== "undefined" && Intl.PluralRules ? new Intl.PluralRules("ar") : null;

// Integer count formatter (no forced decimals — counts are whole).
const COUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export type ArabicPluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export function formatCount(count: number, forms: ArabicPluralForms): string {
  const category = AR_PLURAL_RULES ? AR_PLURAL_RULES.select(count) : count === 1 ? "one" : "other";
  // "one" (and any category without a provided form) falls back to
  // `other`; "zero" is a real Arabic plural category (CLDR) and is
  // honored when the caller provides it.
  const label =
    category === "other"
      ? forms.other
      : ((forms[category as keyof ArabicPluralForms] as string | undefined) ?? forms.other);
  return `${COUNT_FORMATTER.format(count)} ${label}`;
}

// 96-F7 (R96 A6 #6): every ar-LY DATE call below pins -u-nu-latn.
// Bare "ar-LY" relies on the engine having ar-LY locale data; engines
// that lack it (older Safari/WebView) fall back to the generic "ar"
// root whose CLDR default numbering is Arabic-Indic (٠١٢…) — that
// silently breaks the site-wide Latin-digits convention. This mirrors
// formatRelativeTime, which already pinned the extension (93-C6/F-06).
// NOTE: never use Intl.NumberFormat("ar-LY") for money — European
// separators + a trailing-dot currency glyph — formatCurrency's en-US
// grouping stays the money path (comment atop this file).
const AR_DATE_LOCALE = "ar-LY-u-nu-latn";

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(AR_DATE_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function tierLabel(tier: string): string {
  const labels: Record<string, string> = {
    bronze: "برونزي",
    silver: "فضي",
    gold: "ذهبي",
    platinum: "بلاتيني",
  };
  return labels[tier] ?? tier;
}

// R94-A1 #5 (P2, WCAG AA): gold's text-yellow-400 was 1.53:1 on white
// cards (light theme) — the tier label was unreadable. gold now rides the
// shared --status-warning token (theme-aware); silver/platinum move to
// mid shades that hold on BOTH card colors. bronze was already amber-600.
export function tierColor(tier: string): string {
  const colors: Record<string, string> = {
    bronze: "text-amber-600",
    silver: "text-slate-500",
    gold: "text-status-warning",
    platinum: "text-cyan-600",
  };
  return colors[tier] ?? "text-muted-foreground";
}

export function categoryLabel(cat: string | null | undefined): string {
  // Live categories first (mirror products.category in production),
  // then the retired gaming/productivity kept for archived products
  // and old links so labels never degrade to a raw English slug.
  const labels: Record<string, string> = {
    streaming: "بث مباشر",
    music: "موسيقى",
    software: "برامج وتراخيص",
    vpn: "شبكات VPN",
    "ai-tools": "ذكاء اصطناعي",
    "seo-tools": "أدوات SEO",
    education: "تعليم ومكتبات",
    gaming: "ألعاب",
    productivity: "إنتاجية",
  };
  return cat ? (labels[cat] ?? cat) : "عام";
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "قيد الانتظار",
    processing: "جارٍ التنفيذ",
    completed: "مكتمل",
    delivered: "مكتمل",
    failed: "فشل",
    // R111-F2 N2: unified on the استرداد root (canonical across
    // order-detail «تم الاسترداد», support, terms). Was «مسترجع».
    refunded: "مُسترد",
    approved: "موافق عليه",
    rejected: "مرفوض",
    // 93-C7 / C-UX2 (A12 §11.1 rule 1): the label side of the status
    // unification — every status the STATUS_TONE mapper (ui/status-badge)
    // covers can now resolve an Arabic label here, so filter tabs and
    // row badges on admin pages derive from ONE map instead of drifting
    // («معلق/قيد الانتظار», «مفتوحة», «نشط» were per-page literals).
    open: "مفتوحة",
    in_progress: "قيد المعالجة",
    closed: "مغلقة",
    credited: "ناجحة",
    active: "نشط",
    expired: "منتهي",
    scheduled: "مجدول",
    archived: "مؤرشف",
  };
  return labels[status] ?? status;
}

// 93-C6 / F-06 (A5 PR-1 + A11 §4, round-93): formatRelativeTime now
// delegates to Intl.RelativeTimeFormat so Arabic plurals are correct
// (دقيقة واحدة / دقيقتين / 5 دقائق / 11 دقيقة) in BOTH directions.
// Previously:
//   - truncated single-letter units («منذ 5 د») inside prose,
//   - collapsed every plural to the singular («منذ 2 أيام»),
//   - and — the P1 — returned "الآن" for FUTURE dates (negative diff
//     fell into the `mins < 1` branch), so every flash sale on
//     admin/promotions rendered «ينتهي الآن» for its whole runtime.
// The `ar-LY-u-nu-latn` locale extension pins Latin digits: the bare
// "ar" CLDR default is Arabic-Indic (٥ دقائق), which would violate the
// site-wide Latin-numerals convention (see the pin comment atop this
// file). `numeric: "auto"` yields «قبل …» for the past, «خلال …» for
// the future, and the special forms أمس / أول أمس / غدًا — formal MSA,
// no hand-rolled plural tables to drift.
// Cached formatter (module-level): Intl construction is the expensive
// part; options never vary.
const AR_RELATIVE_TIME_FORMATTER =
  typeof Intl !== "undefined" && Intl.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat("ar-LY-u-nu-latn", { numeric: "auto" })
    : null;

export function formatRelativeTime(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  if (!Number.isFinite(target)) return "الآن";
  // Positive = future (clock at target still to run), negative = past.
  const diffMs = target - Date.now();
  const future = diffMs > 0;
  const pastMs = Math.abs(diffMs);
  // Under a minute AGO reads as "الآن" (matches the previous behavior);
  // a future target always has at least "خلال دقيقة واحدة" left.
  if (!future && pastMs < 60_000) return "الآن";
  // Past buckets FLOOR (a full hour must pass before «قبل ساعة»);
  // future buckets CEIL (a sale with 59s left honestly reads
  // «خلال دقيقة واحدة», never «الآن» while still active).
  const mins = future ? Math.ceil(pastMs / 60_000) : Math.floor(pastMs / 60_000);
  const fmtUnit = (value: number, unit: Intl.RelativeTimeFormatUnit): string => {
    const signed = future ? value : -value;
    if (AR_RELATIVE_TIME_FORMATTER) return AR_RELATIVE_TIME_FORMATTER.format(signed, unit);
    return future ? `بعد ${value} ${unit}` : `منذ ${value} ${unit}`;
  };
  if (mins < 60) return fmtUnit(mins, "minute");
  const hours = future ? Math.ceil(pastMs / 3_600_000) : Math.floor(pastMs / 3_600_000);
  if (hours < 24) return fmtUnit(hours, "hour");
  const days = future ? Math.ceil(pastMs / 86_400_000) : Math.floor(pastMs / 86_400_000);
  if (days < 7) return fmtUnit(days, "day");
  // Older / farther than a week: the calendar date says more than a
  // unit count. (Future >1 week on this helper is unusual — promotions
  // cap at days — but the date is still the honest answer.)
  // 96-F7 (R96 A6 #6): pinned to the Latin-digit extension like the
  // formatter above it.
  return new Date(dateStr).toLocaleDateString(AR_DATE_LOCALE, { month: "short", day: "numeric" });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 48) return formatRelativeTime(dateStr);
  // 96-F7 (R96 A6 #6): pinned to the Latin-digit extension (see
  // AR_DATE_LOCALE above).
  return d.toLocaleDateString(AR_DATE_LOCALE, { month: "short", day: "numeric" });
}

/**
 * 93-C6 / F-06-b (A5 C-2, round-93): convert a naive `datetime-local`
 * input value ("2026-09-07T23:59") into a true UTC ISO string.
 *
 * Why: `<input type="datetime-local">` values carry NO timezone. Sending
 * them raw makes the server (UTC — pinned by the container's TZ) interpret
 * the operator's LOCAL wall-clock as UTC — a coupon created in Libya (UTC+2/+3) with
 * "ينتهي 23:59" then stays redeemable until 01:59/02:59 next day, hours
 * after the operator believes it ended (the storefront countdown shows
 * the TRUE end, so customers keep buying under a "finished" discount).
 * `new Date(value)` parses the naive string in the BROWSER's zone, so
 * `.toISOString()` re-encodes the intended instant correctly.
 *
 * This is the shared helper extracted from the pattern promotions.tsx
 * already does correctly (`new Date(form.ends_at).toISOString()`).
 * coupons.tsx (93-C7's file) should swap its raw `expires_at` send for
 * `localDateTimeToUtcIso(form.expires_at)` — noted in the round-93
 * worklog for coordination.
 *
 * Returns `null` for empty input (caller decides whether "no expiry"
 * is legal) and `null` for unparseable values (caller validates).
 */
export function localDateTimeToUtcIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Clipboard copy with graceful degradation. navigator.clipboard can be
 * unavailable (insecure context, permission denied, Firefox strict mode)
 * — every previous copy site either swallowed the rejection silently or
 * left the "copied" state stuck. This helper:
 *   1. tries the async Clipboard API,
 *   2. falls back to a hidden textarea + document.execCommand("copy")
 *      for legacy/embedded browsers,
 *   3. resolves false on failure so callers can surface an error instead
 *      of failing silently.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
