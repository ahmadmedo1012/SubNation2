/**
 * LYD money display — the M17 invariant's ONE formatting idiom, ported
 * verbatim from the web (frontend/src/lib/utils.ts):
 * en-US grouping + two decimals + «د.ل» suffix (trailing, with space),
 * Latin digits always (never ar-LY Intl), NaN/null → «— د.ل», sign-blind
 * zero. Never `toFixed` for display.
 */
const CURRENCY_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "— د.ل";
  if (amount === 0) return "0.00 د.ل";
  return `${CURRENCY_NUMBER_FORMATTER.format(amount)} د.ل`;
}

/** Plain grouped number (counts, points) — Latin digits like the web. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Latin-digit pinned locale for dates/relative time (the web pins
 * ar-LY-u-nu-latn so Arabic text keeps Western digits).
 */
export const DATE_LOCALE = "ar-LY-u-nu-latn";

/** Arabic six-way plural forms (port of the web's formatCount helper). */
const AR_PLURAL = new Intl.PluralRules("ar");

type ArabicForm = {
  zero: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
};

export function arabicCount(count: number, forms: ArabicForm): string {
  const n = Math.abs(count);
  let word: string;
  switch (AR_PLURAL.select(n)) {
    case "zero":
      word = forms.zero;
      break;
    case "one":
      word = forms.one;
      break;
    case "two":
      word = forms.two;
      break;
    case "few":
      word = forms.few;
      break;
    case "many":
      word = forms.many;
      break;
    default:
      word = forms.other;
  }
  return `${formatNumber(count)} ${word}`;
}
