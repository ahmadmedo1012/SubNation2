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
      "(name, description, descriptionLong, faq, usageTerms, imageUrl, " +
      "category, seoTitle, seoDescription). DOES NOT EXECUTE — the human " +
      "must approve the resulting preview.",
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
            "Partial product fields to update. Allowed: name, description, descriptionLong, faq, usageTerms, imageUrl, category, seoTitle, seoDescription.",
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
            // R122 (A7-P2 + A4-P2-3): the SEO overrides — camelCase like
            // every CATALOG_LOW_RISK_FIELDS entry, capped at the DB columns.
            seoTitle: { type: "string", maxLength: 200 },
            seoDescription: { type: "string", maxLength: 320 },
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
// draft_price_change (high risk) — products.price
// ────────────────────────────────────────────────────────────────────────

const draftPriceChangeSpec: Tool = {
  type: "function",
  function: {
    name: "draft_price_change",
    description:
      "Propose a new selling price for ONE product. HIGH RISK — requires " +
      "double confirmation. The system surfaces a margin warning when the " +
      "new price drops below the recorded cost price.",
    parameters: {
      type: "object",
      required: ["id", "new_price"],
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        new_price: {
          type: "number",
          // r4 red-team F-1: 0.00 prices are poison downstream — the
          // checkout INVALID_PRICE gate fail-closes on them (every
          // purchase 500s) and a 100% "free" price is not a legitimate
          // state for this marketplace. Upper bound mirrors the zod
          // perimeter (audit M1): 1,000,000 LYD.
          minimum: 0.01,
          maximum: 1_000_000,
          description: "New selling price in the platform currency.",
        },
      },
    },
  },
};

async function draftPriceChangeHandler(
  input: Record<string, unknown>,
): Promise<ValidationResult<DraftPlan>> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "Missing or invalid product id.");
  }
  const newPrice = Number(input.new_price);
  // r4 red-team F-1: same bounds as the admin zod perimeter — reject 0
  // and negative prices (checkout INVALID_PRICE fail-closes on them)
  // and anything above the 1M LYD catalog ceiling.
  if (!Number.isFinite(newPrice) || newPrice < 0.01 || newPrice > 1_000_000) {
    return refusal(
      409,
      REFUSAL_CODES.INVALID_VALUE,
      "new_price must be a number between 0.01 and 1000000.",
    );
  }
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!row) return refusal(404, REFUSAL_CODES.NOT_FOUND, `Product #${id} not found.`);

  const beforePrice = Number(row.price);
  if (Math.abs(beforePrice - newPrice) < 0.005) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "No-op: price unchanged.");
  }

  const warnings: DraftPlan["validationWarnings"] = [];
  const cost = row.costPrice == null ? null : Number(row.costPrice);
  if (cost != null && newPrice < cost) {
    warnings.push({
      severity: "warn",
      code: "below_cost",
      message: `Proposed price ${newPrice.toFixed(2)} is below cost price ${cost.toFixed(2)}.`,
      affected_id: id,
    });
  }

  const newPriceFixed = newPrice.toFixed(2);
  return {
    ok: true,
    value: {
      toolName: "draft_price_change",
      actionClass: "price_change",
      riskTier: "high",
      affectedEntityType: "product",
      affectedIds: [id],
      changes: [{ field: "price", before: row.price, after: newPriceFixed }],
      intentSummary: `Change price of #${id} (${row.name}) from ${row.price} to ${newPriceFixed}.`,
      sideEffects: ["Customer-facing price changes are visible immediately."],
      validationWarnings: warnings,
      irreversible: false,
      recordVersions: { [String(id)]: (row.updatedAt ?? row.createdAt).toISOString() },
    },
  };
}

export const draftPriceChange: CopilotTool = {
  requiredScope: "inventory",
  spec: draftPriceChangeSpec,
  handler: async () => ({ error: "draft tools must be invoked via runDraftTool" }),
};

// ────────────────────────────────────────────────────────────────────────
// draft_cost_change (high risk) — products.cost_price
// ────────────────────────────────────────────────────────────────────────

const draftCostChangeSpec: Tool = {
  type: "function",
  function: {
    name: "draft_cost_change",
    description:
      "Propose a new procurement cost price for ONE product. HIGH RISK — " +
      "feeds margin and pricing calculators; double confirmation required.",
    parameters: {
      type: "object",
      required: ["id", "new_cost"],
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        new_cost: { type: "number", minimum: 0.01, maximum: 1_000_000 },
      },
    },
  },
};

async function draftCostChangeHandler(
  input: Record<string, unknown>,
): Promise<ValidationResult<DraftPlan>> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "Missing or invalid product id.");
  }
  const newCost = Number(input.new_cost);
  // r4 red-team F-1: mirror the zod perimeter bounds (0.01..1M LYD).
  if (!Number.isFinite(newCost) || newCost < 0.01 || newCost > 1_000_000) {
    return refusal(
      409,
      REFUSAL_CODES.INVALID_VALUE,
      "new_cost must be a number between 0.01 and 1000000.",
    );
  }
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!row) return refusal(404, REFUSAL_CODES.NOT_FOUND, `Product #${id} not found.`);

  const before = row.costPrice == null ? null : Number(row.costPrice);
  if (before != null && Math.abs(before - newCost) < 0.005) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "No-op: cost price unchanged.");
  }

  const warnings: DraftPlan["validationWarnings"] = [];
  const sellPrice = Number(row.price);
  if (Number.isFinite(sellPrice) && sellPrice < newCost) {
    warnings.push({
      severity: "warn",
      code: "above_sell_price",
      message: `New cost ${newCost.toFixed(2)} exceeds current sell price ${sellPrice.toFixed(2)}.`,
      affected_id: id,
    });
  }

  const newCostFixed = newCost.toFixed(2);
  return {
    ok: true,
    value: {
      toolName: "draft_cost_change",
      actionClass: "cost_change",
      riskTier: "high",
      affectedEntityType: "product",
      affectedIds: [id],
      changes: [{ field: "costPrice", before: row.costPrice, after: newCostFixed }],
      intentSummary: `Change cost price of #${id} (${row.name}) from ${row.costPrice ?? "null"} to ${newCostFixed}.`,
      sideEffects: ["Internal only — customers do not see cost price."],
      validationWarnings: warnings,
      irreversible: false,
      recordVersions: { [String(id)]: (row.updatedAt ?? row.createdAt).toISOString() },
    },
  };
}

export const draftCostChange: CopilotTool = {
  requiredScope: "inventory",
  spec: draftCostChangeSpec,
  handler: async () => ({ error: "draft tools must be invoked via runDraftTool" }),
};

// ────────────────────────────────────────────────────────────────────────
// draft_status_change (high risk) — publish / archive / unpublish
// ────────────────────────────────────────────────────────────────────────

const draftStatusChangeSpec: Tool = {
  type: "function",
  function: {
    name: "draft_status_change",
    description:
      "Propose a status change for ONE product (publish / unpublish / archive / unarchive). " +
      "HIGH RISK — affects customer visibility immediately on execute.",
    parameters: {
      type: "object",
      required: ["id", "target_status"],
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        target_status: { type: "string", enum: ["active", "draft", "archived"] },
      },
    },
  },
};

async function draftStatusChangeHandler(
  input: Record<string, unknown>,
): Promise<ValidationResult<DraftPlan>> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, "Missing or invalid product id.");
  }
  const target = String(input.target_status ?? "");
  if (!["active", "draft", "archived"].includes(target)) {
    return refusal(
      409,
      REFUSAL_CODES.INVALID_VALUE,
      "target_status must be one of: active, draft, archived.",
    );
  }
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!row) return refusal(404, REFUSAL_CODES.NOT_FOUND, `Product #${id} not found.`);

  const currentStatus = row.isArchived ? "archived" : row.isActive ? "active" : "draft";
  if (currentStatus === target) {
    return refusal(409, REFUSAL_CODES.INVALID_VALUE, `No-op: product already in '${target}'.`);
  }
  const nextIsActive = target === "active";
  const nextIsArchived = target === "archived";
  const sideEffects: string[] = [];
  if (target === "archived") {
    sideEffects.push("Hides the product from the customer catalog.");
  } else if (target === "active" && currentStatus !== "active") {
    sideEffects.push("Makes the product visible to customers immediately.");
  } else if (target === "draft") {
    sideEffects.push("Removes the product from the customer catalog (keeps it editable).");
  }

  return {
    ok: true,
    value: {
      toolName: "draft_status_change",
      actionClass: "status_change",
      riskTier: "high",
      affectedEntityType: "product",
      affectedIds: [id],
      changes: [
        { field: "isActive", before: row.isActive, after: nextIsActive },
        { field: "isArchived", before: row.isArchived, after: nextIsArchived },
      ],
      intentSummary: `Change status of #${id} (${row.name}) from '${currentStatus}' to '${target}'.`,
      sideEffects,
      validationWarnings: [],
      irreversible: false,
      recordVersions: { [String(id)]: (row.updatedAt ?? row.createdAt).toISOString() },
    },
  };
}

export const draftStatusChange: CopilotTool = {
  requiredScope: "inventory",
  spec: draftStatusChangeSpec,
  handler: async () => ({ error: "draft tools must be invoked via runDraftTool" }),
};

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

export const DRAFT_TOOLS: CopilotTool[] = [
  draftCatalogEdit,
  draftPriceChange,
  draftCostChange,
  draftStatusChange,
];

export function draftToolsForScopes(scopes: string[]): CopilotTool[] {
  if (scopes.includes("all")) return DRAFT_TOOLS;
  return DRAFT_TOOLS.filter((t) => t.requiredScope === null || scopes.includes(t.requiredScope));
}

const DRAFT_HANDLERS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ValidationResult<DraftPlan>>
> = {
  draft_catalog_edit: draftCatalogEditHandler,
  draft_price_change: draftPriceChangeHandler,
  draft_cost_change: draftCostChangeHandler,
  draft_status_change: draftStatusChangeHandler,
};

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
  const handler = DRAFT_HANDLERS[name];
  if (!handler) {
    return refusal(409, REFUSAL_CODES.HALLUCINATED_FIELD, `Unknown draft tool: ${name}`);
  }
  const tool = DRAFT_TOOLS.find((t) => t.spec.function.name === name);
  if (!tool) {
    return refusal(409, REFUSAL_CODES.HALLUCINATED_FIELD, `Unregistered draft tool: ${name}`);
  }
  if (!scopes.includes("all") && tool.requiredScope && !scopes.includes(tool.requiredScope)) {
    return refusal(
      403,
      REFUSAL_CODES.OUT_OF_SCOPE,
      `This tool requires the \`${tool.requiredScope}\` scope.`,
    );
  }
  return handler(input);
}
