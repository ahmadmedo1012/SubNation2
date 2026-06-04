/**
 * Enrichment validator (012-arabic-catalog-enrichment, T008).
 *
 * Pure functions. The Arabic-ratio threshold + length bounds are
 * documented in research §R-4. Failures are surfaced as
 * `{ ok: false, errors: [...] }` and stored in
 * `enrichment_drafts.validation_errors` so prompt-template regressions
 * are auditable.
 */

export type FieldName = "description" | "description_long" | "faq";

export interface ValidationOk {
  ok: true;
}

export interface ValidationError {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationOk | ValidationError;

const ARABIC_RATIO_THRESHOLD = 0.7;

/** True when the codepoint is in the Arabic Unicode block (U+0600–U+06FF) or supplements. */
function isArabicChar(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) || // Arabic
    (cp >= 0x0750 && cp <= 0x077f) || // Arabic Supplement
    (cp >= 0x08a0 && cp <= 0x08ff) || // Arabic Extended-A
    (cp >= 0xfb50 && cp <= 0xfdff) || // Arabic Presentation Forms-A
    (cp >= 0xfe70 && cp <= 0xfeff) // Arabic Presentation Forms-B
  );
}

/**
 * Ratio of Arabic characters over total non-whitespace characters.
 * Returns 0 for an empty string. Used by the validator to enforce
 * "predominantly Arabic" (FR-DRAFT-007).
 */
export function arabicRatio(text: string): number {
  if (!text) return 0;
  let arabic = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    const cp = ch.codePointAt(0);
    if (cp != null && isArabicChar(cp)) arabic++;
  }
  if (total === 0) return 0;
  return arabic / total;
}

function checkArabic(text: string, errors: string[]): void {
  const ratio = arabicRatio(text);
  if (ratio < ARABIC_RATIO_THRESHOLD) {
    errors.push(
      `arabic_ratio ${ratio.toFixed(2)} below threshold ${ARABIC_RATIO_THRESHOLD}`,
    );
  }
}

export function validateDescription(text: string): ValidationResult {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 50) errors.push(`length ${trimmed.length} < 50`);
  if (trimmed.length > 1000) errors.push(`length ${trimmed.length} > 1000`);
  checkArabic(trimmed, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateDescriptionLong(text: string): ValidationResult {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 300) errors.push(`length ${trimmed.length} < 300`);
  if (trimmed.length > 8000) errors.push(`length ${trimmed.length} > 8000`);
  checkArabic(trimmed, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function validateFaq(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return { ok: false, errors: ["faq must be an array"] };
  }
  if (value.length < 1) errors.push("faq must have at least one entry");
  if (value.length > 10) errors.push(`faq has ${value.length} entries, max 10`);
  for (let i = 0; i < value.length; i++) {
    const e = value[i] as Partial<FaqEntry>;
    if (!e || typeof e.question !== "string" || typeof e.answer !== "string") {
      errors.push(`faq[${i}] missing question/answer string fields`);
      continue;
    }
    const q = e.question.trim();
    const a = e.answer.trim();
    if (q.length < 5) errors.push(`faq[${i}].question length ${q.length} < 5`);
    if (q.length > 300) errors.push(`faq[${i}].question length ${q.length} > 300`);
    if (a.length < 5) errors.push(`faq[${i}].answer length ${a.length} < 5`);
    if (a.length > 500) errors.push(`faq[${i}].answer length ${a.length} > 500`);
    checkArabic(`${q} ${a}`, errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validate a draft for the requested field. For FAQ the caller passes
 * the parsed JSON; for description fields the caller passes the
 * trimmed text.
 */
export function validateDraft(
  field: FieldName,
  value: string | FaqEntry[],
): ValidationResult {
  if (field === "description") return validateDescription(value as string);
  if (field === "description_long") return validateDescriptionLong(value as string);
  return validateFaq(value);
}
