import { CheckCircle, Clock, XCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { statusLabel } from "@/lib/utils";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the topup flow's shared metadata (network catalog, presets, the LyPay
// bank coordinates, tier accent maps) + its tiny presentational atoms
// (StepDot / InfoRow / the topup status icon-label pair) and the pure
// amount sanitizer / URL-method reader. The page and every wallet
// extract import from here — one source for the topup vocabulary; the
// move only changes its address, zero behavior change.

export const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
};

export const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50, 100],
  madar: [1, 5, 10, 20, 50, 100],
};

export const NETWORKS = [
  {
    value: "libyana",
    label: "ليبيانا",
    // R94-A1 #5 (P2, WCAG AA): green-300/blue-300 on white cards
    // measured 1.40:1 / 2.30:1 in the light theme — the selected network
    // name was near-invisible. The shared --status-* tokens are
    // theme-aware; the bg tint stays brand-hued (non-text decoration —
    // the AA text carries the state).
    // R124-I1 (A3 P2, WCAG 1.4.11): the selected border is the visible
    // state boundary and must clear 3:1 in BOTH themes. The raw
    // green-500/45 / blue-500/45 borders measured 2.55:1 / 1.96:1 on the
    // dark chip (light worse) — the theme-aware --status-* pair at the
    // Input recipe's calibrated /75 alpha (input.tsx A4-F12) measures
    // ≈5.2:1 dark / ≈3.5:1 light (success) and ≈3.5:1 in both (info).
    color: "text-status-success",
    border: "border-status-success/75",
    bg: "bg-green-500/10",
  },
  {
    value: "madar",
    label: "مدار",
    color: "text-status-info",
    border: "border-status-info/75",
    bg: "bg-blue-500/10",
  },
];

export type Method = "mobile_transfer" | "lypay";

/**
 * A9-3 (R126-L6): the topup method tab seeds from ?method= and mirrors
 * back (the home/admin ?tab= idiom — replaceState, no history spam), so
 * a lypay user who reloads mid-form keeps the method choice (the
 * amount/reference fields are per-session anyway) and «أرسل عبر lypay»
 * is deep-linkable into a WhatsApp support conversation. Whitelisted —
 * a bogus value falls to the default tab.
 */
const METHOD_VALUES = new Set<Method>(["mobile_transfer", "lypay"]);

export function readInitialMethodFromUrl(): { method: Method; fromUrl: boolean } {
  if (typeof window === "undefined") return { method: "mobile_transfer", fromUrl: false };
  const raw = new URLSearchParams(window.location.search).get("method");
  const fromUrl = raw != null && METHOD_VALUES.has(raw as Method);
  return {
    method: fromUrl ? (raw as Method) : "mobile_transfer",
    fromUrl,
  };
}

export function networkLabel(net?: string | null) {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar") return "مدار";
  return net ?? "";
}

export function topupStatusIcon(status: string) {
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-status-success" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-status-error" />;
  return <Clock className="w-4 h-4 text-status-warning pulse-dot" />;
}

/**
 * R124-I1 (A1 P3): a pending TOPUP is «قيد المراجعة» — an admin review
 * action, exactly as the pending banner, the form chip and
 * TopupWaitingModal («قيد المراجعة من الإدارة») already say. The shared
 * statusLabel() maps pending to «قيد الانتظار» for ORDER/referral
 * waiting states (correct there), which left one screen saying two
 * words for one topup state. The topup rows and the mobile latest-topup
 * pin resolve through here so the concept keeps one word on this page.
 */
export function topupStatusLabel(status: string): string {
  return status === "pending" ? "قيد المراجعة" : statusLabel(status);
}

/**
 * 96-F6 (R96 A2 P1-6): amount-field sanitizer for the type="text" +
 * inputMode="decimal" inputs below. An Arabic-locale virtual keyboard can
 * deliver Arabic-Indic (٠-٩) or Persian (۰-۹) digits and locale decimal
 * separators (٫ / ,); paste can deliver letters and multiple dots. Only
 * digits and ONE decimal point survive — mirrors the sender-phone digit
 * sanitizer in step 4. R116-S2 (P2): the whole-dinar rounding stays in
 * onBlur + handleSubmit (unchanged contract, new integer domain).
 */
export function sanitizeAmountInput(raw: string): string {
  let s = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    // Locale decimal separators (Arabic ٫, Latin comma) → dot
    .replace(/[٫,]/g, ".");
  s = s.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    // Collapse to a single decimal point (keep the first).
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

/**
 * A numbered step marker for the topup flows.
 *
 * R125-I7 (A7 B-7, the R124-A1 F2 collapse): every call site used to
 * pass a hardcoded `active` — all five dots rendered as "current",
 * the inactive branch was dead code, and the prop claimed a
 * where-am-I signal the form never derived (onboarding's twin dots
 * DO derive theirs). The dots are now honestly what they always
 * rendered: a flat numbered legend (1 الشبكة، 2 المبلغ…) — no
 * progress semantics, no dead branch, identical visuals. The
 * primary-filled numbered circle is the legend's marker style.
 */
export function StepDot({
  n,
  label,
  htmlFor,
}: {
  n: number;
  label: string;
  /**
   * 96-F6 (R96 A6 #2 P1): when set, the step text renders as a <label>
   * bound to the field it names — the PaymentReferenceField recipe in
   * this family (93-C5 / F-03, A4 P3 #37). Only field steps pass it; the
   * informational steps keep the plain span. Bonus: tapping the step
   * label focuses/activates the bound field (bigger hit area).
   */
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold">
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold shrink-0 shadow-sm bg-primary text-white shadow-primary/30">
        {n}
      </div>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs font-bold cursor-pointer">
          {label}
        </Label>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-muted-foreground mb-0.5 font-semibold">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

// R123-E4a (P3-d): the balance card's tier accents. The TEXT tone is the
// shared tierColor() (lib/utils) — these two maps only carry the
// bg/border variants tierColor doesn't express, keyed ONCE so the two
// inline conditional ladders below (dot + badge) can't drift apart
// again (they had already drifted from tierColor's palette).
// R128 (A1-F3): the whole family rides the theme-aware --tier-* tokens.
export const TIER_DOT_BG: Record<string, string> = {
  bronze: "bg-tier-bronze",
  silver: "bg-tier-silver",
  gold: "bg-tier-gold",
  platinum: "bg-tier-platinum",
};
export const TIER_BADGE_BORDER: Record<string, string> = {
  bronze: "border-tier-bronze/25",
  silver: "border-tier-silver/25",
  gold: "border-tier-gold/25",
  platinum: "border-tier-platinum/25",
};
