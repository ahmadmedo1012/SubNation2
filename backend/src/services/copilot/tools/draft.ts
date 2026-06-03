/**
 * Draft tools for the AI Admin Copilot (010-ai-admin-copilot, US2).
 *
 * Each draft tool's handler does NOT create a preview directly. It
 * returns a structured action plan; the route layer calls
 * `createPreview()` once it has run the validator and assembled the
 * record_versions snapshot.
 *
 * In Phase 1 these tools are absent from the LLM's catalog. They are
 * added on `POST /draft` (Phase 2+) and gated by phase flags.
 */

import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Tool } from "../llm-client";
import type { CopilotTool } from "./read";
import {
  CATALOG_LOW_RISK_FIELDS,
  REFUSAL_CODES,
  refusal,
  type ValidationResult,
} from "../validator";
import type { RiskTier } from "../preview-store";

// ────────────────────────────────────────────────────────────────────────
// Types shared by drafts
// ────────────────────────────────────────────────────────────────────────

export interface DraftPlan {
  toolName: string;
  actionClass: string;
  riskTier: RiskTier;
  affectedEntityType: "product" | "inventory" | "admin_user";
  affectedIds: number[];
  /** Field-level before/after for the preview payload. */
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  /** Plain-language summary the model returned, or one we synthesize. */
  intentSummary: string;
  sideEffects: string[];
  validationWarnings: Array<{
    severity: "warn" | "error";
    code: string;
    message: string;
    affected_id?: number | null;
  }>;
  irreversible: boolean;
  recordVersions: Record<string, string>;
}

// ────────────────────────────────────────────────────────────────────────
// draft_catalog_edit (low risk) — title/description/FAQ/category/...
// ────────────────────────────────────────────────────────────────────────

const draftCatalogEditSpec: Tool = {
  type: "function",
  function: {
    name: "draft_catalog_edit",
    description:
      "Propose a low-risk edit to a single product's content fields " +
      "(name, description, descriptionLong, faq, usageTerms, imageUrl, category). " +
      "DOES NOT EXECUTE — the human must approve the resulting preview.",
    parameters: {
      type: "object",
      required: ["id", "fields"],
      additionalProperties: false,
      properties: {
        id: { type: "integer", description: "Product ID to edit." },
        fields: {
          type: "object",
          additionalProperties: true,
          minProperties: 1,
          description:
            "Partial product fields to update. Allowed: name, description, descriptionLong, faq, usageTerms, imageUrl, category.",
          properties: {
            name: { type: "string", maxLength: 255 },
            description: { type: "string", maxLength: 5000 },
            descriptionLong: { type: "string", maxLength: 50000 },
            faq: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                required: ["question", "answer"],
                properties: {
                  question: { type: "string", maxLength: 500 },
                  answer: { type: "string", maxLength: 5000 },
                },
              },
            },
            usageTerms: { type: "string", maxLength: 10000 },
            imageUrl: { type: "string", format: "uri", maxLength: 1000 },
            category: { type: "string", maxLength: 100 },
          },
        },
      },
    },
  },
};

async function draftCatalogEditHandler(
  input: Record<string, unknown>,
): Promise<ValidationResult<DraftPlan>> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "Missing or invalid product id.");
  }
  const fields = (input.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "fields must be an object.");
  }
  const fieldNames = Object.keys(fields);
  if (fieldNames.length === 0) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "At least one field must be set.");
  }
  const hallucinated = fieldNames.filter((f) => !CATALOG_LOW_RISK_FIELDS.has(f));
  if (hallucinated.length > 0) {
    return refusal(
      409,
      REFUSAL_CODES.HALLUCINATED_FIELD,
      `These fields are not editable via low-risk catalog edit: ${hallucinated.join(", ")}. ` +
        `Allowed: ${[...CATALOG_LOW_RISK_FIELDS].join(", ")}.`,
    );
  }

  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!row) {
    return refusal(404, REFUSAL_CODES.NOT_FOUND, `Product #${id} not found.`);
  }

  // Build before/after, skipping no-op fields.
  const before = row as unknown as Record<string, unknown>;
  const changes: DraftPlan["changes"] = [];
  for (const k of fieldNames) {
    const after = fields[k];
    const beforeVal = before[k];
    const same =
      beforeVal === after ||
      (typeof beforeVal === "object" &&
        typeof after === "object" &&
        JSON.stringify(beforeVal ?? null) === JSON.stringify(after ?? null));
    if (!same) changes.push({ field: k, before: beforeVal ?? null, after: after ?? null });
  }
  if (changes.length === 0) {
    return refusal(
      409,
      REFUSAL_CODES.INVALID_VALUE,
      "No-op: every field already has the proposed value.",
    );
  }

  return {
    ok: true,
    value: {
      toolName: "draft_catalog_edit",
      actionClass: "catalog_edit",
      riskTier: "low",
      affectedEntityType: "product",
      affectedIds: [id],
      changes,
      intentSummary: `Update ${changes.length} field(s) on product #${id} (${row.name}).`,
      sideEffects: changes.some((c) => c.field === "category" || c.field === "imageUrl")
        ? ["This change is customer-visible immediately."]
        : [],
      validationWarnings: [],
      irreversible: false,
      recordVersions: { [String(id)]: (row.updatedAt ?? row.createdAt).toISOString() },
    },
  };
}

export const draftCatalogEdit: CopilotTool = {
  requiredScope: "inventory",
  spec: draftCatalogEditSpec,
  // The route uses runDraftTool() instead of this handler directly so it
  // can capture the structured DraftPlan. The model-facing wrapper here
  // just lets the catalog be enumerated by readToolsForScopes() pattern.
  handler: async () => ({ error: "draft tools must be invoked via runDraftTool" }),
};

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

export const DRAFT_TOOLS: CopilotTool[] = [draftCatalogEdit];

export function draftToolsForScopes(scopes: string[]): CopilotTool[] {
  if (scopes.includes("all")) return DRAFT_TOOLS;
  return DRAFT_TOOLS.filter((t) => t.requiredScope === null || scopes.includes(t.requiredScope));
}

/**
 * Resolve a draft tool call → a validated DraftPlan or a refusal.
 * Permission scope is checked here too (defense in depth: the route also
 * filters the catalog passed to the model).
 */
export async function runDraftTool(
  name: string,
  input: Record<string, unknown>,
  scopes: string[],
): Promise<ValidationResult<DraftPlan>> {
  if (name !== "draft_catalog_edit") {
    return refusal(409, REFUSAL_CODES.HALLUCINATED_FIELD, `Unknown draft tool: ${name}`);
  }
  if (!scopes.includes("all") && !scopes.includes("inventory")) {
    return refusal(403, REFUSAL_CODES.OUT_OF_SCOPE, "This tool requires the `inventory` scope.");
  }
  return draftCatalogEditHandler(input);
}
