/**
 * Topup payment-method metadata — the native port of the web's
 * frontend/src/components/wallet/topup-meta.tsx (+ the MAX_PENDING cap
 * from topup-preferences.ts and the Libyan phone guards from
 * lib/validation.ts): the network catalog, preset amounts, the LyPay
 * bank coordinates (byte-identical Arabic presentation), the
 * Arabic-keypad amount sanitizer, and the channel/status label helpers.
 *
 * Pure data + pure functions (zero React) so the wallet screen, its
 * transfer-code generator and any future surface share ONE source for
 * the topup vocabulary — the same role topup-meta.tsx plays on the web.
 */

/** The two topup channels the backend's CreateTopupBody accepts. */
export type TopupMethod = "mobile_transfer" | "lypay";

/** The review-queue cap the pending gate enforces (backend parity). */
export const MAX_PENDING = 3;

/** LyPay bank coordinates — verbatim from the web's LYPAY_INFO. */
export const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
} as const;

/** Mobile-transfer networks (Libyan telecoms). */
export const NETWORKS = [
  { value: "libyana", label: "ليبيانا" },
  { value: "madar", label: "مدار" },
] as const;

/** Preset chips per network (whole LYD) — the web's NETWORK_PRESETS. */
export const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50, 100],
  madar: [1, 5, 10, 20, 50, 100],
};

/** LyPay preset chips (the web's lypay branch: [25, 50, 100, 200]). */
export const LYPAY_PRESETS = [25, 50, 100, 200];

/** Presets for the active method. */
export function methodPresets(method: TopupMethod, network: string): number[] {
  return method === "mobile_transfer" ? (NETWORK_PRESETS[network] ?? []) : LYPAY_PRESETS;
}

/** Network display label («ليبيانا» / «مدار»). */
export function networkLabel(net?: string | null): string {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar") return "مدار";
  return net ?? "";
}

/**
 * The topup row's CHANNEL label, derived from payment_method (lypay rows
 * carry payment_network=null — the method is the honest source, the
 * web's R157-IMPL-B #1 rule).
 */
export function topupChannelLabel(
  paymentMethod?: string | null,
  paymentNetwork?: string | null,
): string | null {
  if (paymentMethod === "lypay") return "LyPay";
  if (paymentMethod === "mobile_transfer") return networkLabel(paymentNetwork) || "تحويل موبايل";
  return null;
}

/**
 * Amount-field sanitizer (the web's sanitizeAmountInput verbatim):
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits + locale decimal
 * separators (٫ ,) are normalized; only digits and ONE decimal point
 * survive. Whole-dinar rounding stays at blur/submit.
 */
export function sanitizeAmountInput(raw: string): string {
  let s = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٫,]/g, ".");
  s = s.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    // Collapse to a single decimal point (keep the first).
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

const LIBYAN_PREFIXES = ["091", "092", "093", "094"] as const;

/** Valid Libyan mobile phone (091/092/093/094 + 10 digits). */
export function isValidLibyanPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 9 ? `0${digits}` : digits;
  return normalized.length === 10 && LIBYAN_PREFIXES.some((p) => normalized.startsWith(p));
}

/** Live-validation error for the sender-phone field (web's wording). */
export function libyanPhoneError(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "رقم الهاتف يجب أن يتكون من 10 أرقام";
  if (digits.length > 10) return "رقم الهاتف طويل جداً";
  if (!LIBYAN_PREFIXES.some((p) => digits.startsWith(p))) {
    return "يجب أن يبدأ الرقم بـ 091 أو 092 أو 093 أو 094";
  }
  return null;
}
