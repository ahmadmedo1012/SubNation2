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

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ar-LY", {
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

export function tierColor(tier: string): string {
  const colors: Record<string, string> = {
    bronze: "text-amber-600",
    silver: "text-slate-400",
    gold: "text-yellow-400",
    platinum: "text-cyan-400",
  };
  return colors[tier] ?? "text-muted-foreground";
}

export function categoryLabel(cat: string | null | undefined): string {
  const labels: Record<string, string> = {
    streaming: "بث مباشر",
    music: "موسيقى",
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
    refunded: "مسترجع",
    approved: "موافق عليه",
    rejected: "مرفوض",
  };
  return labels[status] ?? status;
}

export function statusColor(status: string): string {
  // Class tuples ride the shared --status-* tokens (defined in
  // index.css and exposed to Tailwind via @theme as `status-success`,
  // etc.). Both light and dark themes get tonally-correct colors with
  // no per-call branching — the tokens already define light-mode
  // values that meet AA contrast on white surfaces.
  const colors: Record<string, string> = {
    pending: "text-status-warning bg-status-warning/10 border-status-warning/22",
    processing: "text-status-info bg-status-info/10 border-status-info/22",
    completed: "text-status-success bg-status-success/10 border-status-success/22",
    delivered: "text-status-success bg-status-success/10 border-status-success/22",
    approved: "text-status-success bg-status-success/10 border-status-success/22",
    failed: "text-status-error bg-status-error/10 border-status-error/22",
    rejected: "text-status-error bg-status-error/10 border-status-error/22",
    refunded: "text-status-info bg-status-info/10 border-status-info/22",
  };
  return colors[status] ?? "text-muted-foreground";
}

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} ${mins === 1 ? "دقيقة" : "د"}`;
  if (hours < 24) return `منذ ${hours} ${hours === 1 ? "ساعة" : "س"}`;
  if (days === 1) return "أمس";
  if (days < 7) return `منذ ${days} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-LY", { month: "short", day: "numeric" });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 48) return formatRelativeTime(dateStr);
  return d.toLocaleDateString("ar-LY", { month: "short", day: "numeric" });
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
