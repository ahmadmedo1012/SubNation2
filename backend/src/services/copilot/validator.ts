/**
 * Validator (010-ai-admin-copilot, T033).
 *
 * Validates a proposed action against the target entity's actual state
 * BEFORE we persist a preview. Validation rejections never create a
 * `copilot_previews` row — they return a stable refusal code.
 *
 * Refusal codes (must match the values surfaced in the OpenAPI
 * RefusalResponse schema):
 *   COPILOT_HALLUCINATED_FIELD   — argument names a non-existent field
 *   COPILOT_RULE_VIOLATION       — business rule (price < cost, stock < 0)
 *   COPILOT_BULK_OVER_CAP        — bulk filter matched more than 500 rows
 *   COPILOT_AMBIGUOUS_INTENT     — numeric ambiguity (10% vs $10)
 *   COPILOT_OUT_OF_SCOPE         — admin lacks required scope
 *   COPILOT_MISSING_CONTEXT      — required field absent (e.g. wallet user_id)
 *   COPILOT_NOT_FOUND            — target entity does not exist
 *   COPILOT_INVALID_VALUE        — value out of accepted range/format
 */

export interface RefusalReason {
  code: string;
  message: string;
  affected_id?: number;
}

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationError {
  ok: false;
  status: 409 | 422 | 403 | 404;
  code: string;
  message: string;
  reasons?: RefusalReason[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationError;

export const REFUSAL_CODES = {
  HALLUCINATED_FIELD: "COPILOT_HALLUCINATED_FIELD",
  RULE_VIOLATION: "COPILOT_RULE_VIOLATION",
  BULK_OVER_CAP: "COPILOT_BULK_OVER_CAP",
  AMBIGUOUS_INTENT: "COPILOT_AMBIGUOUS_INTENT",
  OUT_OF_SCOPE: "COPILOT_OUT_OF_SCOPE",
  MISSING_CONTEXT: "COPILOT_MISSING_CONTEXT",
  NOT_FOUND: "COPILOT_NOT_FOUND",
  INVALID_VALUE: "COPILOT_INVALID_VALUE",
} as const;

/** Entity field whitelist for catalog content edits (FR-DATA-002 low-risk). */
export const CATALOG_LOW_RISK_FIELDS = new Set([
  "name",
  "description",
  "descriptionLong",
  "faq",
  "usageTerms",
  "imageUrl",
  "category",
]);

export function refusal(
  status: 409 | 422 | 403 | 404,
  code: string,
  message: string,
  reasons?: RefusalReason[],
): ValidationError {
  return { ok: false, status, code, message, reasons };
}
