/**
 * Operational read tools (010-ai-admin-copilot follow-up).
 *
 * Two high-leverage tools that replace 3-5 admin_request calls each:
 *
 *   system_overview() — single call returns counts and headline numbers
 *     across the whole platform: products, inventory, orders today/week,
 *     wallet activity, pending top-ups, open tickets, recent admin
 *     activity. Use FIRST for "how is the site doing" questions instead
 *     of guessing endpoints.
 *
 *   query_data(entity, filters) — list-with-filters for orders, topups,
 *     users, tickets, admin_users, audit_logs. Stable response shape,
 *     proper pagination, server-bounded limits so the model can't blow
 *     its context window.
 *
 * Both tools are READ-ONLY; they never mutate. Permission is checked at
 * the route layer (super-admin only for now). Africa/Tripoli timezone
 * applied wherever "today/week" semantics are needed.
 */

import {
  adminUsersTable,
  auditLogsTable,
  db,
  inventoryTable,
  ordersTable,
  productsTable,
  supportTicketsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "@workspace/db";
import { and, count, desc, eq, gte, ilike, or, sql, sum } from "drizzle-orm";
import type { Tool } from "../llm-client";
import type { CopilotTool } from "./read";

const TZ = "Africa/Tripoli";

function startOfTodayTripoli(): Date {
  // Get current Tripoli local date as YYYY-MM-DD then construct UTC midnight.
  // Drizzle/PG accept ISO strings; PG handles the timestamptz conversion.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(now); // e.g. 2026-06-03
  // Tripoli is UTC+2 year-round (no DST).
  return new Date(`${ymd}T00:00:00+02:00`);
}

function startOfWeekTripoli(): Date {
  const today = startOfTodayTripoli();
  const offset = today.getDay(); // 0=Sun..6=Sat
  // Week starts Saturday in Libya — common admin convention.
  const daysBack = (offset + 1) % 7;
  return new Date(today.getTime() - daysBack * 24 * 3600 * 1000);
}

/* ======================================================================
   system_overview
   ====================================================================== */

const systemOverviewSpec: Tool = {
  type: "function",
  function: {
    name: "system_overview",
    description:
      "Single-call snapshot of the whole platform's current state: " +
      "product counts (active/draft/archived), available inventory rows, " +
      "low-stock count, pending top-ups, today's orders and revenue, " +
      "this week's orders and revenue, total open tickets, recent admin " +
      "activity. ALWAYS call this FIRST for any 'how is the site doing' " +
      "or general state question — it answers in one call what would " +
      "otherwise take 5+ admin_request calls. Numbers are in Africa/Tripoli " +
      "timezone (UTC+2). Currency is LYD.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

export const systemOverview: CopilotTool = {
  requiredScope: "all",
  spec: systemOverviewSpec,
  handler: async () => {
    const todayStart = startOfTodayTripoli();
    const weekStart = startOfWeekTripoli();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);

    const [
      productCounts,
      stockAvailable,
      lowStock,
      pendingTopups,
      ordersToday,
      ordersWeek,
      revenueToday,
      revenueWeek,
      openTickets,
      adminCount,
      recentAuditCount,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE is_active = true AND is_archived = false)::int AS active,
          COUNT(*) FILTER (WHERE is_active = false AND is_archived = false)::int AS draft,
          COUNT(*) FILTER (WHERE is_archived = true)::int AS archived,
          COUNT(*)::int AS total
        FROM products
      `),
      db.select({ c: count() }).from(inventoryTable).where(eq(inventoryTable.isSold, false)),
      db.execute(sql`
        SELECT COUNT(*)::int AS c
        FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id AND i.is_sold = false
          WHERE p.is_active = true AND p.is_archived = false
          GROUP BY p.id
          HAVING COUNT(i.id) < 5
        ) sub
      `),
      db
        .select({ c: count() })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.status, "pending")),
      db.select({ c: count() }).from(ordersTable).where(gte(ordersTable.createdAt, todayStart)),
      db.select({ c: count() }).from(ordersTable).where(gte(ordersTable.createdAt, weekStart)),
      db
        .select({ s: sum(ordersTable.amount) })
        .from(ordersTable)
        .where(and(gte(ordersTable.createdAt, todayStart), eq(ordersTable.status, "completed"))),
      db
        .select({ s: sum(ordersTable.amount) })
        .from(ordersTable)
        .where(and(gte(ordersTable.createdAt, weekStart), eq(ordersTable.status, "completed"))),
      db
        .select({ c: count() })
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.status, "open")),
      db.select({ c: count() }).from(adminUsersTable).where(eq(adminUsersTable.isActive, true)),
      db.select({ c: count() }).from(auditLogsTable).where(gte(auditLogsTable.createdAt, dayAgo)),
    ]);

    const productRow =
      (
        productCounts as unknown as {
          rows?: Array<{ active: number; draft: number; archived: number; total: number }>;
        }
      ).rows?.[0] ??
      (
        productCounts as unknown as Array<{
          active: number;
          draft: number;
          archived: number;
          total: number;
        }>
      )[0];
    const lowStockRow =
      (lowStock as unknown as { rows?: Array<{ c: number }> }).rows?.[0] ??
      (lowStock as unknown as Array<{ c: number }>)[0];

    return {
      timezone: TZ,
      generated_at: new Date().toISOString(),
      products: productRow ?? { active: 0, draft: 0, archived: 0, total: 0 },
      inventory: {
        available_rows: Number(stockAvailable[0]?.c ?? 0),
        products_with_low_stock: Number(lowStockRow?.c ?? 0),
      },
      wallet_topups: {
        pending: Number(pendingTopups[0]?.c ?? 0),
      },
      orders: {
        today_count: Number(ordersToday[0]?.c ?? 0),
        week_count: Number(ordersWeek[0]?.c ?? 0),
        today_revenue_lyd: Number(revenueToday[0]?.s ?? 0),
        week_revenue_lyd: Number(revenueWeek[0]?.s ?? 0),
      },
      tickets: {
        open: Number(openTickets[0]?.c ?? 0),
      },
      admins: {
        active: Number(adminCount[0]?.c ?? 0),
      },
      recent_audit_events_24h: Number(recentAuditCount[0]?.c ?? 0),
    };
  },
};

/* ======================================================================
   query_data
   ====================================================================== */

const queryDataSpec: Tool = {
  type: "function",
  function: {
    name: "query_data",
    description:
      "List entities with structured filters. Stable response shape, " +
      "server-bounded pagination, no token-window risk. Use this instead " +
      "of admin_request for read-only listings.\n\n" +
      "Entities and the filters they accept:\n" +
      "  orders:    status, since_iso, until_iso, user_id, limit (≤50)\n" +
      "  topups:    status, since_iso, until_iso, user_id, limit (≤50)\n" +
      "  users:     q (name/phone/email), since_iso, limit (≤50)\n" +
      "  tickets:   status, user_id, limit (≤50)\n" +
      "  admins:    is_active, limit (≤50)\n" +
      "  audit_logs:actor_id, action, since_iso, limit (≤100)\n\n" +
      "Default limit is 20 if omitted. since_iso/until_iso are ISO 8601 " +
      "timestamps; the server interprets them in Africa/Tripoli where " +
      "ambiguous.",
    parameters: {
      type: "object",
      required: ["entity"],
      properties: {
        entity: {
          type: "string",
          enum: ["orders", "topups", "users", "tickets", "admins", "audit_logs"],
        },
        status: { type: "string" },
        since_iso: { type: "string", format: "date-time" },
        until_iso: { type: "string", format: "date-time" },
        user_id: { type: "integer" },
        actor_id: { type: "integer" },
        action: { type: "string" },
        is_active: { type: "boolean" },
        q: { type: "string", description: "Free-text search (users only)." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
};

interface QueryInput {
  entity: string;
  status?: string;
  since_iso?: string;
  until_iso?: string;
  user_id?: number;
  actor_id?: number;
  action?: string;
  is_active?: boolean;
  q?: string;
  limit?: number;
}

export const queryData: CopilotTool = {
  requiredScope: "all",
  spec: queryDataSpec,
  handler: async (raw) => {
    const input = raw as unknown as QueryInput;
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
    const since =
      input.since_iso && !Number.isNaN(Date.parse(input.since_iso))
        ? new Date(input.since_iso)
        : null;
    const until =
      input.until_iso && !Number.isNaN(Date.parse(input.until_iso))
        ? new Date(input.until_iso)
        : null;

    switch (input.entity) {
      case "orders": {
        const conds = [];
        if (input.status) conds.push(eq(ordersTable.status, input.status as never));
        if (since) conds.push(gte(ordersTable.createdAt, since));
        if (until) conds.push(sql`${ordersTable.createdAt} < ${until}`);
        if (typeof input.user_id === "number") conds.push(eq(ordersTable.userId, input.user_id));
        const rows = await db
          .select()
          .from(ordersTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(ordersTable.createdAt))
          .limit(Math.min(limit, 50));
        return { entity: "orders", count: rows.length, rows };
      }
      case "topups": {
        const conds = [];
        if (input.status) conds.push(eq(walletTopupsTable.status, input.status as never));
        if (since) conds.push(gte(walletTopupsTable.createdAt, since));
        if (until) conds.push(sql`${walletTopupsTable.createdAt} < ${until}`);
        if (typeof input.user_id === "number")
          conds.push(eq(walletTopupsTable.userId, input.user_id));
        const rows = await db
          .select()
          .from(walletTopupsTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(walletTopupsTable.createdAt))
          .limit(Math.min(limit, 50));
        return { entity: "topups", count: rows.length, rows };
      }
      case "users": {
        const conds = [];
        if (since) conds.push(gte(usersTable.createdAt, since));
        if (input.q && input.q.trim()) {
          const q = `%${input.q.trim()}%`;
          conds.push(
            or(
              ilike(usersTable.displayName, q),
              ilike(usersTable.phone, q),
              ilike(usersTable.email, q),
            ),
          );
        }
        const rows = await db
          .select({
            id: usersTable.id,
            phone: usersTable.phone,
            email: usersTable.email,
            displayName: usersTable.displayName,
            walletBalance: usersTable.walletBalance,
            loyaltyTier: usersTable.loyaltyTier,
            createdAt: usersTable.createdAt,
          })
          .from(usersTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(usersTable.createdAt))
          .limit(Math.min(limit, 50));
        return { entity: "users", count: rows.length, rows };
      }
      case "tickets": {
        const conds = [];
        if (input.status) conds.push(eq(supportTicketsTable.status, input.status as never));
        if (typeof input.user_id === "number")
          conds.push(eq(supportTicketsTable.userId, input.user_id));
        const rows = await db
          .select()
          .from(supportTicketsTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(supportTicketsTable.createdAt))
          .limit(Math.min(limit, 50));
        return { entity: "tickets", count: rows.length, rows };
      }
      case "admins": {
        const conds = [];
        if (typeof input.is_active === "boolean")
          conds.push(eq(adminUsersTable.isActive, input.is_active));
        const rows = await db
          .select({
            id: adminUsersTable.id,
            username: adminUsersTable.username,
            displayName: adminUsersTable.displayName,
            role: adminUsersTable.role,
            permissions: adminUsersTable.permissions,
            isActive: adminUsersTable.isActive,
            createdAt: adminUsersTable.createdAt,
          })
          .from(adminUsersTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(adminUsersTable.id)
          .limit(Math.min(limit, 50));
        return { entity: "admins", count: rows.length, rows };
      }
      case "audit_logs": {
        const conds = [];
        if (typeof input.actor_id === "number")
          conds.push(eq(auditLogsTable.actorId, input.actor_id));
        if (input.action) conds.push(eq(auditLogsTable.action, input.action));
        if (since) conds.push(gte(auditLogsTable.createdAt, since));
        const rows = await db
          .select()
          .from(auditLogsTable)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(auditLogsTable.createdAt))
          .limit(Math.min(limit, 100));
        return { entity: "audit_logs", count: rows.length, rows };
      }
      default:
        return { error: `unknown entity: ${input.entity}` };
    }
  },
};

/* ======================================================================
   wallet_ledger_summary — read-only ledger health for one user
   ====================================================================== */

const walletLedgerSummarySpec: Tool = {
  type: "function",
  function: {
    name: "wallet_ledger_summary",
    description:
      "Read-only summary of one user's wallet ledger: balance, total " +
      "topped up, total spent, refunds, last 10 entries. Use this when " +
      "the admin asks about a specific user's wallet history.",
    parameters: {
      type: "object",
      required: ["user_id"],
      properties: { user_id: { type: "integer" } },
      additionalProperties: false,
    },
  },
};

export const walletLedgerSummary: CopilotTool = {
  requiredScope: "all",
  spec: walletLedgerSummarySpec,
  handler: async (raw) => {
    const input = raw as { user_id?: number };
    const userId = Number(input.user_id);
    if (!Number.isFinite(userId) || userId <= 0) return { error: "invalid user_id" };

    const [user, totals, recent] = await Promise.all([
      db
        .select({
          id: usersTable.id,
          phone: usersTable.phone,
          displayName: usersTable.displayName,
          walletBalance: usersTable.walletBalance,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1),
      db.execute(sql`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'topup'),    0)::numeric AS total_topup,
          COALESCE(SUM(amount) FILTER (WHERE type = 'purchase'), 0)::numeric AS total_purchase,
          COALESCE(SUM(amount) FILTER (WHERE type = 'refund'),   0)::numeric AS total_refund,
          COUNT(*)::int AS entries
        FROM wallet_ledger
        WHERE user_id = ${userId}
      `),
      db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId))
        .orderBy(desc(walletLedgerTable.createdAt))
        .limit(10),
    ]);

    const totalsRow =
      (totals as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (totals as unknown as Array<Record<string, unknown>>)[0];

    return {
      user: user[0] ?? null,
      totals: totalsRow ?? null,
      recent_entries: recent,
    };
  },
};

/* ======================================================================
   Catalog
   ====================================================================== */

export const OPERATIONAL_TOOLS: CopilotTool[] = [systemOverview, queryData, walletLedgerSummary];

export function operationalToolsForScopes(scopes: string[]): CopilotTool[] {
  if (!scopes.includes("all")) return [];
  return OPERATIONAL_TOOLS;
}

export type OperationalToolName = "system_overview" | "query_data" | "wallet_ledger_summary";

export function isOperationalToolName(name: string): name is OperationalToolName {
  return name === "system_overview" || name === "query_data" || name === "wallet_ledger_summary";
}
