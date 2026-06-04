/**
 * Read-only tool implementations for the AI Admin Copilot Phase 1 (US1, T044-T047).
 *
 * Each export is a pair: `{ spec }` — the LLM-facing schema in OpenAI
 * function-call shape (the open Chat-Completions standard adopted by
 * NVIDIA NIM and OpenRouter) — and `{ handler }` — the function the
 * route invokes when the model calls the tool.
 *
 * Tools fetch live data from authoritative sources only. They do NOT
 * write, draft, or propose changes — that's reserved for Phase 2+.
 */

import { db, productsTable, inventoryTable } from "@workspace/db";
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { findAnomalies } from "../anomalies";
import type { Tool } from "../llm-client";

export interface CopilotTool {
  spec: Tool;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  /** Required admin permission scope to use this tool. `null` = any admin. */
  requiredScope: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// search_products
// ────────────────────────────────────────────────────────────────────────
export const searchProducts: CopilotTool = {
  requiredScope: "inventory",
  spec: {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the product catalog by free text, category, or status. " +
        "Returns up to 20 product summaries (id, name, slug, price, category, status).",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Free-text against name + description." },
          category: { type: "string" },
          status: { type: "string", enum: ["active", "draft", "archived"] },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const q = typeof input.q === "string" ? input.q : undefined;
    const category = typeof input.category === "string" ? input.category : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);

    const conditions = [];
    if (q) {
      conditions.push(
        or(ilike(productsTable.name, `%${q}%`), ilike(productsTable.description, `%${q}%`)),
      );
    }
    if (category) conditions.push(eq(productsTable.category, category));
    if (status === "archived") conditions.push(eq(productsTable.isArchived, true));
    else if (status === "draft")
      conditions.push(and(eq(productsTable.isActive, false), eq(productsTable.isArchived, false)));
    else if (status === "active")
      conditions.push(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

    const rows = await db
      .select({
        id: productsTable.id,
        slug: productsTable.slug,
        name: productsTable.name,
        price: productsTable.price,
        category: productsTable.category,
        isActive: productsTable.isActive,
        isArchived: productsTable.isArchived,
      })
      .from(productsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(productsTable.name))
      .limit(limit);

    return {
      products: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        price: r.price,
        category: r.category,
        status: r.isArchived ? "archived" : r.isActive ? "active" : "draft",
      })),
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// get_product
// ────────────────────────────────────────────────────────────────────────
export const getProduct: CopilotTool = {
  requiredScope: "inventory",
  spec: {
    type: "function",
    function: {
      name: "get_product",
      description:
        "Fetch full detail for one product by ID, including description, FAQ, " +
        "usage terms, image, price, and cost price.",
      parameters: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" } },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const id = Number(input.id);
    if (!Number.isFinite(id) || id <= 0) return { error: "invalid id" };
    const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
    if (!row) return { error: "not found" };
    const [stockRow] = await db
      .select({ count: count() })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false)));
    return {
      product: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        descriptionLong: row.descriptionLong,
        faq: row.faq,
        usageTerms: row.usageTerms,
        imageUrl: row.imageUrl,
        price: row.price,
        costPrice: row.costPrice,
        category: row.category,
        status: row.isArchived ? "archived" : row.isActive ? "active" : "draft",
        stockAvailable: Number(stockRow?.count ?? 0),
      },
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// list_low_stock
// ────────────────────────────────────────────────────────────────────────
export const listLowStock: CopilotTool = {
  requiredScope: "inventory",
  spec: {
    type: "function",
    function: {
      name: "list_low_stock",
      description:
        "List active products whose available stock (unsold inventory rows) is below the threshold.",
      parameters: {
        type: "object",
        required: ["threshold"],
        properties: {
          threshold: { type: "integer", minimum: 0 },
          category: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const threshold = Math.max(0, Number(input.threshold ?? 5));
    const category = typeof input.category === "string" ? input.category : undefined;
    const rows = await db.execute(sql`
      SELECT p.id, p.name, p.slug, p.category,
             COALESCE(SUM(CASE WHEN i.is_sold = false THEN 1 ELSE 0 END), 0)::int AS stock
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.is_archived = false AND p.is_active = true
        ${category ? sql`AND p.category = ${category}` : sql``}
      GROUP BY p.id
      HAVING COALESCE(SUM(CASE WHEN i.is_sold = false THEN 1 ELSE 0 END), 0) < ${threshold}
      ORDER BY stock ASC, p.name ASC
      LIMIT 50
    `);
    type Row = {
      id: number;
      name: string;
      slug: string | null;
      category: string | null;
      stock: number;
    };
    const r = rows as unknown as { rows?: Row[] } | Row[];
    const list = Array.isArray(r) ? r : (r.rows ?? []);
    return { products: list, threshold };
  },
};

// ────────────────────────────────────────────────────────────────────────
// summarize_recent_changes
// ────────────────────────────────────────────────────────────────────────
export const summarizeRecentChanges: CopilotTool = {
  requiredScope: "admins",
  spec: {
    type: "function",
    function: {
      name: "summarize_recent_changes",
      description:
        "Read recent admin audit-log entries since a given ISO timestamp. Returns up to 50.",
      parameters: {
        type: "object",
        required: ["since_iso"],
        properties: {
          since_iso: { type: "string", format: "date-time" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const sinceIso = String(
      input.since_iso ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    );
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 100);
    const rows = await db.execute(sql`
      SELECT id, actor_type, actor_id, action, target_type, target_id, created_at
      FROM audit_logs
      WHERE created_at >= ${sinceIso}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    type Row = Record<string, unknown>;
    const r = rows as unknown as { rows?: Row[] } | Row[];
    const entries = Array.isArray(r) ? r : (r.rows ?? []);
    return { entries };
  },
};

// ────────────────────────────────────────────────────────────────────────
// query_risk_events — surfaces 003-anomaly-detection's risk_events table
// ────────────────────────────────────────────────────────────────────────
export const queryRiskEvents: CopilotTool = {
  requiredScope: "users",
  spec: {
    type: "function",
    function: {
      name: "query_risk_events",
      description:
        "Query the anomaly-detection risk_events table. Use to answer questions like " +
        "'any high-risk events today?' or 'how many unresolved critical events?'. " +
        "Returns counts by level + a sample of the most recent rows. Cite IDs verbatim.",
      parameters: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["low", "medium", "high", "critical", "any"],
            description: "Filter by risk level. Default 'any'.",
          },
          hours: {
            type: "integer",
            minimum: 1,
            maximum: 720,
            description: "Lookback window in hours. Default 24.",
          },
          unresolved_only: {
            type: "boolean",
            description: "If true, restrict to events with no risk_labels row yet. Default false.",
          },
          sample_limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Max sample rows to return (default 10).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const level =
      typeof input.level === "string" && input.level !== "any" ? input.level : null;
    const hours = Math.max(1, Math.min(720, Number(input.hours ?? 24)));
    const unresolvedOnly = input.unresolved_only === true;
    const sampleLimit = Math.max(1, Math.min(50, Number(input.sample_limit ?? 10)));

    const levelSql = level ? sql`AND e.level = ${level}::risk_level` : sql``;
    const unresolvedSql = unresolvedOnly
      ? sql`AND NOT EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)`
      : sql``;

    // Counts grouped by level — aggregate first, sample second.
    const countsResult = await db.execute(sql`
      SELECT e.level, COUNT(*)::int AS n
      FROM risk_events e
      WHERE e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
        ${levelSql}
        ${unresolvedSql}
      GROUP BY e.level
    `);
    const sampleResult = await db.execute(sql`
      SELECT e.id, e.user_id, e.event_type, e.score, e.level,
             e.action_taken, e.ip_address, e.created_at, e.shown_at
      FROM risk_events e
      WHERE e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
        ${levelSql}
        ${unresolvedSql}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${sampleLimit}
    `);

    type CountRow = { level: string; n: number };
    type SampleRow = {
      id: number;
      user_id: number | null;
      event_type: string;
      score: number;
      level: string;
      action_taken: string;
      ip_address: string | null;
      created_at: Date | string;
      shown_at: Date | string | null;
    };
    const cR = countsResult as unknown as { rows?: CountRow[] } | CountRow[];
    const sR = sampleResult as unknown as { rows?: SampleRow[] } | SampleRow[];
    const counts = Array.isArray(cR) ? cR : (cR.rows ?? []);
    const sample = Array.isArray(sR) ? sR : (sR.rows ?? []);

    const total = counts.reduce((sum, c) => sum + Number(c.n), 0);
    const byLevel: Record<string, number> = {};
    for (const c of counts) byLevel[c.level] = Number(c.n);

    return {
      window_hours: hours,
      level_filter: level ?? "any",
      unresolved_only: unresolvedOnly,
      total,
      by_level: byLevel,
      sample: sample.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        event_type: r.event_type,
        score: r.score,
        level: r.level,
        action_taken: r.action_taken,
        ip_address: r.ip_address,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        shown_at:
          r.shown_at == null
            ? null
            : r.shown_at instanceof Date
              ? r.shown_at.toISOString()
              : r.shown_at,
        investigation_url: `/admin/risk/events/${r.id}`,
      })),
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// find_anomalies
// ────────────────────────────────────────────────────────────────────────
export const findAnomaliesTool: CopilotTool = {
  requiredScope: "inventory",
  spec: {
    type: "function",
    function: {
      name: "find_anomalies",
      description:
        "Run a fixed-catalog anomaly heuristic and return raw findings. " +
        "Cite IDs from this output verbatim — do NOT fabricate entries. " +
        "Kinds: loss_making_price, refund_cluster, stock_spike, discount_ratio, all.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["loss_making_price", "refund_cluster", "stock_spike", "discount_ratio", "all"],
            description: "Which heuristic to run (default 'all').",
          },
          hours: {
            type: "integer",
            minimum: 1,
            maximum: 720,
            description: "Lookback window for time-windowed kinds (refund_cluster). Default 24.",
          },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Max rows. Default 20." },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (input) => {
    const kind = typeof input.kind === "string" ? (input.kind as never) : "all";
    const hours =
      typeof input.hours === "number" || typeof input.hours === "string"
        ? Number(input.hours)
        : undefined;
    const limit =
      typeof input.limit === "number" || typeof input.limit === "string"
        ? Number(input.limit)
        : undefined;
    const findings = await findAnomalies({
      kind,
      hours: Number.isFinite(hours) ? (hours as number) : undefined,
      limit: Number.isFinite(limit) ? (limit as number) : undefined,
    });
    return { kind, findings };
  },
};

export const READ_TOOLS: CopilotTool[] = [
  searchProducts,
  getProduct,
  listLowStock,
  summarizeRecentChanges,
  findAnomaliesTool,
  queryRiskEvents,
];

/**
 * Filter the read-tool catalog by an admin's permission scopes. The model
 * only sees tools the admin has scope for — defense in depth, since the
 * route also enforces requireCopilotPermission at the gate.
 */
export function readToolsForScopes(scopes: string[]): CopilotTool[] {
  if (scopes.includes("all")) return READ_TOOLS;
  return READ_TOOLS.filter((t) => t.requiredScope === null || scopes.includes(t.requiredScope));
}

/** Run a tool by name; returns the handler result or an error envelope. */
export async function runReadTool(
  name: string,
  input: Record<string, unknown>,
  scopes: string[],
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const tool = READ_TOOLS.find((t) => t.spec.function.name === name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  if (
    tool.requiredScope !== null &&
    !scopes.includes("all") &&
    !scopes.includes(tool.requiredScope)
  ) {
    return { ok: false, error: `out_of_scope: tool ${name} requires ${tool.requiredScope}` };
  }
  try {
    const data = await tool.handler(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
