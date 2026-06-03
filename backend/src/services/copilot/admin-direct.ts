/**
 * Direct-execute tools for the AI Admin Copilot — super-admin mode.
 * (010-ai-admin-copilot, follow-up: "give the copilot full powers, no
 * confirmations, fuzzy name matching, multi-dialect")
 *
 * These tools EXECUTE immediately — no preview → confirm dance. Used only
 * when the requesting admin holds the `all` scope (super-admin). Every
 * mutation still writes audit_logs + copilot_actions in one transaction
 * (Constitution §V, FR-AUDIT-001) so the trail is intact.
 *
 * Wallet/balance/refund operations are NOT in this file. The copilot does
 * not write to the wallet ledger directly under any flag — it always hands
 * off to the existing wallet service to preserve atomic ledger semantics
 * (Constitution Principle I — Financial Integrity, NON-NEGOTIABLE).
 */

import {
  auditLogsTable,
  copilotActionsTable,
  db,
  inventoryTable,
  productsTable,
} from "@workspace/db";
import { and, count, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import type { Tool } from "./llm-client";
import type { CopilotTool } from "./tools/read";

/* ======================================================================
   resolve_product — fuzzy match by name OR exact match by id
   ====================================================================== */

const resolveProductSpec: Tool = {
  type: "function",
  function: {
    name: "resolve_product",
    description:
      "Find one or more products by name (any language, any spelling) or by " +
      "exact numeric id. Use this BEFORE any other product tool whenever the " +
      "admin refers to a product by name. Returns up to 5 matches sorted by " +
      "similarity score; ALWAYS pick the top match unless the score is below " +
      "0.3 — then ask the admin to disambiguate.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Product name, partial name, or numeric id. Examples: 'نتفلكس', 'netflix', 'سبوتيفاي premium', '5'.",
        },
      },
      additionalProperties: false,
    },
  },
};

export const resolveProduct: CopilotTool = {
  requiredScope: "inventory",
  spec: resolveProductSpec,
  handler: async (input) => {
    const q = String(input.query ?? "").trim();
    if (!q) return { error: "empty query" };

    // Exact id match short-circuit.
    const asNum = Number(q);
    if (Number.isFinite(asNum) && asNum > 0 && /^\d+$/.test(q)) {
      const [row] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, asNum))
        .limit(1);
      if (row) {
        return {
          matches: [
            {
              id: row.id,
              name: row.name,
              slug: row.slug,
              category: row.category,
              price: row.price,
              status: row.isArchived ? "archived" : row.isActive ? "active" : "draft",
              similarity: 1.0,
              match_type: "exact_id",
            },
          ],
        };
      }
    }

    // pg_trgm similarity. Low threshold so dialect/typo matches surface;
    // the LLM picks the best one. Order by similarity DESC then name ASC
    // so identical scores break tie predictably.
    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        slug,
        category,
        price,
        is_active,
        is_archived,
        similarity(name, ${q}) AS sim
      FROM products
      WHERE similarity(name, ${q}) >= 0.15
         OR name ILIKE ${"%" + q + "%"}
      ORDER BY sim DESC NULLS LAST, name ASC
      LIMIT 5
    `);
    type Row = {
      id: number;
      name: string;
      slug: string | null;
      category: string | null;
      price: string;
      is_active: boolean;
      is_archived: boolean;
      sim: number | null;
    };
    const r = rows as unknown as { rows?: Row[] } | Row[];
    const list = Array.isArray(r) ? r : (r.rows ?? []);
    return {
      matches: list.map((m) => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        category: m.category,
        price: m.price,
        status: m.is_archived ? "archived" : m.is_active ? "active" : "draft",
        similarity: Number(m.sim ?? 0).toFixed(3),
        match_type: "fuzzy",
      })),
    };
  },
};

/* ======================================================================
   update_product — unified write. Direct-execute for super-admin.
   ====================================================================== */

const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "descriptionLong",
  "faq",
  "usageTerms",
  "imageUrl",
  "category",
  "price",
  "costPrice",
  "isActive",
  "isArchived",
]);

const updateProductSpec: Tool = {
  type: "function",
  function: {
    name: "update_product",
    description:
      "Apply a direct update to one product. Executes IMMEDIATELY — there " +
      "is no separate confirmation step. Supports content fields (name, " +
      "description, descriptionLong, faq, usageTerms, imageUrl, category) " +
      "AND pricing fields (price, costPrice) AND status flags (isActive, " +
      "isArchived). For stock changes, use update_stock instead. " +
      "ALWAYS call resolve_product first if you only know the product by name.",
    parameters: {
      type: "object",
      required: ["id", "fields"],
      properties: {
        id: { type: "integer" },
        fields: {
          type: "object",
          additionalProperties: true,
          minProperties: 1,
          description: "Fields to update. At least one required.",
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
            imageUrl: { type: "string", maxLength: 1000 },
            category: { type: "string", maxLength: 100 },
            price: { type: "string", description: "Numeric string with 2 decimals, e.g. \"49.99\"." },
            costPrice: { type: "string", description: "Numeric string with 2 decimals." },
            isActive: { type: "boolean" },
            isArchived: { type: "boolean" },
          },
        },
      },
      additionalProperties: false,
    },
  },
};

interface ExecuteContext {
  adminId: number;
  intentText: string;
  modelId: string;
  correlationId: string;
}

export async function executeUpdateProduct(
  input: Record<string, unknown>,
  ctx: ExecuteContext,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "invalid id" };
  const fields = (input.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== "object" || fields === null) {
    return { ok: false, error: "fields must be an object" };
  }

  const fieldNames = Object.keys(fields);
  const hallucinated = fieldNames.filter((f) => !ALLOWED_FIELDS.has(f));
  if (hallucinated.length > 0) {
    return {
      ok: false,
      error: `unsupported fields: ${hallucinated.join(", ")}. Allowed: ${[...ALLOWED_FIELDS].join(", ")}`,
    };
  }
  if (fieldNames.length === 0) {
    return { ok: false, error: "at least one field required" };
  }

  // Coerce numeric strings.
  if ("price" in fields && typeof fields.price !== "string") {
    fields.price = String(fields.price);
  }
  if ("costPrice" in fields && typeof fields.costPrice !== "string") {
    fields.costPrice = String(fields.costPrice);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id))
        .limit(1);
      if (!before) throw new Error(`product #${id} not found`);

      const [after] = await tx
        .update(productsTable)
        .set(fields as Record<string, unknown>)
        .where(eq(productsTable.id, id))
        .returning();
      if (!after) throw new Error("update returned no row");

      // Diff for the response and audit. Skip no-op fields.
      const diff: Array<{ field: string; before: unknown; after: unknown }> = [];
      for (const k of fieldNames) {
        const b = (before as unknown as Record<string, unknown>)[k];
        const a = fields[k];
        const same =
          b === a ||
          (typeof b === "object" &&
            typeof a === "object" &&
            JSON.stringify(b ?? null) === JSON.stringify(a ?? null));
        if (!same) diff.push({ field: k, before: b ?? null, after: a ?? null });
      }

      const [actionRow] = await tx
        .insert(copilotActionsTable)
        .values({
          adminId: ctx.adminId,
          intentText: ctx.intentText,
          toolName: "update_product",
          actionClass: "direct_update",
          riskTier: "low",
          outcome: "success",
          beforeState: before as never,
          afterState: after as never,
          executedAt: new Date(),
          modelId: ctx.modelId,
          correlationId: ctx.correlationId,
        })
        .returning({ id: copilotActionsTable.id });
      if (!actionRow) throw new Error("audit insert returned no row");

      await tx.insert(auditLogsTable).values({
        actorType: "admin",
        actorId: ctx.adminId,
        action: "copilot.direct_update",
        targetType: "copilot_action",
        targetId: actionRow.id,
        metadata: JSON.stringify({ productId: id, fields: fieldNames, diff }),
      });

      return { actionId: actionRow.id, productId: id, productName: after.name, diff };
    });
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, productId: id }, "copilot direct update_product failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const updateProduct: CopilotTool = {
  requiredScope: "inventory",
  spec: updateProductSpec,
  handler: async () => ({ error: "must be invoked via the route's direct-execute path" }),
};

/* ======================================================================
   update_stock — direct stock adjustment via inventory rows
   ====================================================================== */

const updateStockSpec: Tool = {
  type: "function",
  function: {
    name: "update_stock",
    description:
      "Adjust the available stock of a product by adding/removing inventory " +
      "rows. Use { delta: +N } to add N empty inventory rows. Use { delta: -N } " +
      "to delete the N most-recent unsold rows. Executes IMMEDIATELY.",
    parameters: {
      type: "object",
      required: ["product_id", "delta"],
      properties: {
        product_id: { type: "integer" },
        delta: { type: "integer", minimum: -1000, maximum: 1000 },
      },
      additionalProperties: false,
    },
  },
};

export async function executeUpdateStock(
  input: Record<string, unknown>,
  ctx: ExecuteContext,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const productId = Number(input.product_id);
  const delta = Number(input.delta);
  if (!Number.isFinite(productId) || productId <= 0) return { ok: false, error: "invalid product_id" };
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "delta must be non-zero integer" };
  if (Math.abs(delta) > 1000) return { ok: false, error: "delta out of range" };

  try {
    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: productsTable.id, name: productsTable.name })
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!product) throw new Error(`product #${productId} not found`);

      const [beforeStock] = await tx
        .select({ c: count() })
        .from(inventoryTable)
        .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)));
      const before = Number(beforeStock?.c ?? 0);

      let added = 0;
      let removed = 0;
      if (delta > 0) {
        const rowsToInsert = Array.from({ length: delta }).map(() => ({
          productId,
          isSold: false,
        }));
        await tx.insert(inventoryTable).values(rowsToInsert);
        added = delta;
      } else {
        const want = Math.min(-delta, before);
        if (want > 0) {
          const idsRes = await tx.execute(sql`
            SELECT id FROM inventory
            WHERE product_id = ${productId} AND is_sold = false
            ORDER BY created_at DESC
            LIMIT ${want}
          `);
          const idsR = idsRes as unknown as { rows?: Array<{ id: number }> } | Array<{ id: number }>;
          const idList = Array.isArray(idsR) ? idsR : (idsR.rows ?? []);
          if (idList.length > 0) {
            await tx.execute(sql`
              DELETE FROM inventory WHERE id = ANY(${idList.map((r) => r.id)})
            `);
            removed = idList.length;
          }
        }
      }

      const after = before + added - removed;

      const [actionRow] = await tx
        .insert(copilotActionsTable)
        .values({
          adminId: ctx.adminId,
          intentText: ctx.intentText,
          toolName: "update_stock",
          actionClass: "direct_stock",
          riskTier: "low",
          outcome: "success",
          beforeState: { available_stock: before } as never,
          afterState: { available_stock: after } as never,
          executedAt: new Date(),
          modelId: ctx.modelId,
          correlationId: ctx.correlationId,
        })
        .returning({ id: copilotActionsTable.id });
      if (!actionRow) throw new Error("audit insert returned no row");

      await tx.insert(auditLogsTable).values({
        actorType: "admin",
        actorId: ctx.adminId,
        action: "copilot.direct_stock",
        targetType: "copilot_action",
        targetId: actionRow.id,
        metadata: JSON.stringify({ productId, delta, before, after }),
      });

      return {
        actionId: actionRow.id,
        productId,
        productName: product.name,
        before_stock: before,
        after_stock: after,
        added,
        removed,
      };
    });
    return { ok: true, data: result };
  } catch (err) {
    logger.error({ err, productId }, "copilot direct update_stock failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const updateStock: CopilotTool = {
  requiredScope: "inventory",
  spec: updateStockSpec,
  handler: async () => ({ error: "must be invoked via the route's direct-execute path" }),
};

/* ======================================================================
   Catalog
   ====================================================================== */

export const DIRECT_TOOLS: CopilotTool[] = [resolveProduct, updateProduct, updateStock];

export function directToolsForScopes(scopes: string[]): CopilotTool[] {
  // Only super-admin gets direct-execute. Anyone else must use the
  // preview/confirm flow on /draft + /previews/:id/confirm.
  if (!scopes.includes("all")) return [];
  return DIRECT_TOOLS;
}

export type DirectToolName = "resolve_product" | "update_product" | "update_stock";

export function isDirectExecuteToolName(name: string): name is DirectToolName {
  return name === "resolve_product" || name === "update_product" || name === "update_stock";
}
