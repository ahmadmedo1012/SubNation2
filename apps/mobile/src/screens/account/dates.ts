import { DATE_LOCALE, arabicCount } from "@/lib/money";
import type { Colors } from "@/theme";

/**
 * Time / tier presentation helpers for the account-surface screens
 * (orders + account families). Ports the web's lib/utils.ts date trio
 * (formatDate / formatRelativeTime / formatDateShort) on the SAME
 * Latin-digit pinned locale (DATE_LOCALE = ar-LY-u-nu-latn) so Arabic
 * text keeps Western numerals everywhere.
 *
 * Every Intl construction is guarded: Hermes ships Intl, but not every
 * runtime carries the ar-LY locale data for every formatter — the manual
 * Arabic fallbacks below keep the output correct (and Latin-digit) when a
 * constructor or a format call throws.
 */

// ── Relative time ───────────────────────────────────────────────────────────

let relativeFormatter: Intl.RelativeTimeFormat | null | undefined;

function getRelativeFormatter(): Intl.RelativeTimeFormat | null {
  if (relativeFormatter === undefined) {
    try {
      relativeFormatter = new Intl.RelativeTimeFormat(DATE_LOCALE, { numeric: "auto" });
    } catch {
      relativeFormatter = null;
    }
  }
  return relativeFormatter;
}

/** Arabic unit forms for the manual relative-time fallback. */
const MINUTE_FORMS = {
  zero: "دقائق",
  one: "دقيقة",
  two: "دقيقتين",
  few: "دقائق",
  many: "دقيقة",
  other: "دقيقة",
};
const HOUR_FORMS = {
  zero: "ساعات",
  one: "ساعة",
  two: "ساعتين",
  few: "ساعات",
  many: "ساعة",
  other: "ساعة",
};
const DAY_FORMS = {
  zero: "أيام",
  one: "يوم",
  two: "يومين",
  few: "أيام",
  many: "يوماً",
  other: "يوم",
};

function fallbackUnit(value: number, forms: typeof MINUTE_FORMS): string {
  return arabicCount(Math.abs(value), forms);
}

/**
 * «الآن» / «قبل دقيقتين» / «قبل 5 دقائق» / «خلال 3 ساعات» …
 * Buckets mirror the web exactly: under a minute ago reads «الآن», past
 * buckets floor, future buckets ceil, past a week the calendar date says
 * more than a unit count.
 */
export function formatRelativeTime(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  if (!Number.isFinite(target)) return "الآن";
  const diffMs = target - Date.now();
  const future = diffMs > 0;
  const pastMs = Math.abs(diffMs);
  if (!future && pastMs < 60_000) return "الآن";

  const formatter = getRelativeFormatter();
  const fmt = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    forms: typeof MINUTE_FORMS,
  ): string => {
    const signed = future ? value : -value;
    if (formatter) {
      try {
        return formatter.format(signed, unit);
      } catch {
        // fall through to the manual form
      }
    }
    return future ? `خلال ${fallbackUnit(value, forms)}` : `قبل ${fallbackUnit(value, forms)}`;
  };

  const mins = future ? Math.ceil(pastMs / 60_000) : Math.floor(pastMs / 60_000);
  if (mins < 60) return fmt(mins, "minute", MINUTE_FORMS);
  const hours = future ? Math.ceil(pastMs / 3_600_000) : Math.floor(pastMs / 3_600_000);
  if (hours < 24) return fmt(hours, "hour", HOUR_FORMS);
  const days = future ? Math.ceil(pastMs / 86_400_000) : Math.floor(pastMs / 86_400_000);
  if (days < 7) return fmt(days, "day", DAY_FORMS);
  return formatShortDate(dateStr);
}

// ── Calendar dates ──────────────────────────────────────────────────────────

/** Gregorian month names — the manual fallback's only vocabulary. */
const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function manualFullDate(date: Date): string {
  const month = AR_MONTHS[date.getMonth()] ?? "";
  return `${date.getDate()} ${month} ${date.getFullYear()} · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function manualShortDate(date: Date): string {
  const month = AR_MONTHS[date.getMonth()] ?? "";
  return `${date.getDate()} ${month}`;
}

/**
 * Full date + time («5 نوفمبر 2026 · 14:03») — the delivered_at stamp and
 * the support thread titles. Mirrors the web's formatDate options.
 */
export function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return manualFullDate(date);
  }
}

/** Month-day short date («5 نوفمبر») — the ledger / sessions stamps. */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE, { month: "short", day: "numeric" }).format(date);
  } catch {
    return manualShortDate(date);
  }
}

/**
 * Row-level timestamp: relative inside 48 h, then the short calendar date
 * (the web's formatDateShort — the orders list contract).
 */
export function formatRowDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  if (Math.abs(hours) < 48) return formatRelativeTime(dateStr);
  return formatShortDate(dateStr);
}

// ── Loyalty tiers ───────────────────────────────────────────────────────────

/** Arabic tier labels (the web's tierLabel map). */
export function tierLabel(tier: string): string {
  switch (tier) {
    case "bronze":
      return "برونزي";
    case "silver":
      return "فضي";
    case "gold":
      return "ذهبي";
    case "platinum":
      return "بلاتيني";
    default:
      return tier;
  }
}

/** Tier → theme color key (the theme carries the tier accent tokens). */
export function tierColorKey(tier: string): keyof Colors {
  switch (tier) {
    case "bronze":
      return "tierBronze";
    case "silver":
      return "tierSilver";
    case "gold":
      return "tierGold";
    case "platinum":
      return "tierPlatinum";
    default:
      return "onSurface";
  }
}

// ── Support taxonomy ────────────────────────────────────────────────────────

/** Ticket category → Arabic label (the web's support-meta CATEGORIES). */
export function supportCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "billing":
      return "الدفع والفواتير";
    case "order":
      return "الطلبات";
    case "technical":
      return "مشكلة تقنية";
    case "account":
      return "الحساب";
    default:
      return "أخرى";
  }
}
