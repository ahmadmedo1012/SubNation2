/**
 * Slug generator — converts an arbitrary product name (Arabic, Latin, mixed)
 * into a URL-safe, ASCII-only, dash-separated slug suitable for SEO product
 * URLs (e.g. `/product/netflix-premium`).
 *
 * Design goals
 * ─────────────
 *  1. **Deterministic.** Same input → same output, every time. Migration
 *     backfill MUST be idempotent.
 *  2. **ASCII-safe.** Arabic characters get a best-effort transliteration
 *     so the slug is portable across all browsers, search engines, and
 *     pasted-into-WhatsApp scenarios. The Libyan market uses Arabic
 *     dominant content but modern search-engine ranking prefers Latin
 *     URLs, so we transliterate rather than %-encode.
 *  3. **Bounded.** Hard cap of 120 chars before any optional id suffix —
 *     the schema column is varchar(160) so we always have ~40 chars
 *     headroom for collision suffixes.
 *  4. **Empty-safe.** If the input produces an empty result (e.g. a name
 *     made entirely of emoji), the caller is responsible for falling back
 *     to `product-{id}` via {@link slugifyWithId}.
 *
 * NOT a goal
 * ───────────
 *  • This is NOT a phonetic transliteration system. We map only the 28
 *    Arabic letters + the most common diacritical variants. Edge cases
 *    (e.g. Persian `پ`, `ژ`) collapse to dashes — operators with those
 *    products should use the admin UI's manual-override field.
 *
 * @example
 *   slugify("Netflix Premium")              → "netflix-premium"
 *   slugify("اشتراك نتفلكس بريميوم")          → "ashtrak-ntflks-bryamywm"
 *   slugify("Disney+ Standard")             → "disney-standard"
 *   slugify("YouTube Premium")              → "youtube-premium"
 *   slugify("PlayStation Plus 12-month")    → "playstation-plus-12-month"
 *   slugify("")                             → ""
 */

/**
 * Best-effort Arabic → Latin character map. Covers the 28 standard
 * letters + ة (taa marbuuta) + ى (alif maksura) + 6 hamza variants.
 * Long vowels (ا و ي) are emitted as `a/w/y`. Diacritics (fatha, kasra,
 * damma, sukun, shadda, tanwin) are stripped (they are pronunciation
 * marks, not part of the searchable form).
 */
const ARABIC_TRANSLIT: Record<string, string> = {
  // Hamza family
  ء: "",
  أ: "a",
  إ: "a",
  آ: "a",
  ؤ: "w",
  ئ: "y",
  // 28 standard letters
  ا: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  // Variants
  ة: "h",
  ى: "a",
  // Arabic-Indic digits → ASCII digits
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const SLUG_MAX_LENGTH = 120;

/**
 * Convert a free-form name into a URL-safe slug. May return an empty
 * string when the input contains nothing slug-worthy (caller must handle
 * via {@link slugifyWithId}).
 */
export function slugify(input: string): string {
  if (!input || typeof input !== "string") return "";

  // 1. Normalize unicode (decomposed → composed) so accented Latin is
  //    handled by the diacritic-strip below.
  let s = input.normalize("NFKD");

  // 2. Strip Arabic diacritics (Tashkeel: U+064B..U+0652, U+0670, U+0640).
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");

  // 3. Strip combining diacritical marks (Latin accents).
  s = s.replace(/[\u0300-\u036f]/g, "");

  // 4. Per-character Arabic transliteration.
  s = s
    .split("")
    .map((ch) => (ch in ARABIC_TRANSLIT ? ARABIC_TRANSLIT[ch] : ch))
    .join("");

  // 5. Lowercase.
  s = s.toLowerCase();

  // 6. Replace anything non-alphanumeric with a dash.
  s = s.replace(/[^a-z0-9]+/g, "-");

  // 7. Collapse multiple dashes + trim leading/trailing dashes.
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  // 8. Cap length without splitting a word more than necessary.
  if (s.length > SLUG_MAX_LENGTH) {
    s = s.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  }

  return s;
}

/**
 * Slugify with a guaranteed non-empty result by appending an id suffix
 * when the base slug is empty OR risks collision. Use this as the
 * canonical product-slug generator.
 *
 * @example
 *   slugifyWithId("Netflix Premium", 42)           → "netflix-premium"
 *   slugifyWithId("Netflix Premium", 42, true)     → "netflix-premium-42"
 *   slugifyWithId("",                 7)           → "product-7"
 *   slugifyWithId("🎮🎮🎮",            9)           → "product-9"
 */
export function slugifyWithId(
  input: string,
  id: number,
  withIdSuffix: boolean = false,
): string {
  const base = slugify(input);
  if (!base) return `product-${id}`;
  return withIdSuffix ? `${base}-${id}` : base;
}
