/**
 * R188-3 (D-F2/D-F10/D-F11): Arabic count phrases for backend alert copy —
 * the job/Telegram strings the R188 linguistics audit found frozen on a
 * single noun form. Arabic renders 1 and 2 as bare word forms («وحدة
 * واحدة»، «وحدتان») and 3+ with the Western numeral; `few` covers 3-10
 * and `many` 11+ (CLDR few/many — 100+ takes the same singular form for
 * these nouns). Frontend twin: frontend/src/lib/utils.ts
 * formatCount/arabicCountWord.
 */

/** Per-category phrases: one/two are the full numeral-free renderings,
 * few/many are bare nouns the count is prefixed to. */
export type ArabicCountForms = { one: string; two: string; few: string; many: string };

export function arabicCountPhrase(n: number, forms: ArabicCountForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return `${n} ${n <= 10 ? forms.few : forms.many}`;
}

/** The low-stock «وحدة» forms, shared by the drawer alert (stockWatcher)
 * and the operator Telegram card (notifyLowStock) so the same message
 * never drifts between the two surfaces. */
export const LOW_STOCK_UNIT_FORMS: ArabicCountForms = {
  one: "وحدة واحدة",
  two: "وحدتان",
  few: "وحدات",
  many: "وحدة",
};

/** The «مرة» (times-used) forms, shared by the operator Telegram card
 * (notifyCouponMaxedOut) and the coupon_maxed admin alert (checkout
 * post-commit) — one definition for both surfaces of the same event. */
export const TIMES_USED_FORMS: ArabicCountForms = {
  one: "مرة واحدة",
  two: "مرتين",
  few: "مرات",
  many: "مرة",
};
