import { authActivityTable, db } from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

router.get("/auth-activity", requireAdmin, async (req, res) => {
  const { action, startDate, endDate, success } = req.query;

  const conditions = [];
  if (action && action !== "all") {
    conditions.push(eq(authActivityTable.action, action as string));
  }
  if (startDate) {
    conditions.push(gte(authActivityTable.createdAt, new Date(startDate as string)));
  }
  if (endDate) {
    conditions.push(lte(authActivityTable.createdAt, new Date(endDate as string)));
  }
  if (success && success !== "all") {
    conditions.push(eq(authActivityTable.success, success === "true"));
  }

  const activities = await db
    .select()
    .from(authActivityTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(authActivityTable.createdAt))
    .limit(100);

  return res.json({ activities });
});

router.get("/auth-stats", requireAdmin, async (req, res) => {
  const stats = await db
    .select({
      action: authActivityTable.action,
      success: authActivityTable.success,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(authActivityTable)
    .groupBy(authActivityTable.action, authActivityTable.success);

  return res.json({ stats });
});

router.get("/auth-stats/summary", requireAdmin, async (req, res) => {
  const totalResult = await db
    .select({
      count: sql<number>`count(*)`.as("count"),
    })
    .from(authActivityTable);

  const successResult = await db
    .select({
      count: sql<number>`count(*)`.as("count"),
    })
    .from(authActivityTable)
    .where(eq(authActivityTable.success, true));

  const failureResult = await db
    .select({
      count: sql<number>`count(*)`.as("count"),
    })
    .from(authActivityTable)
    .where(eq(authActivityTable.success, false));

  const last24h = await db
    .select({
      count: sql<number>`count(*)`.as("count"),
    })
    .from(authActivityTable)
    .where(gte(authActivityTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));

  return res.json({
    total: totalResult[0]?.count ?? 0,
    success: successResult[0]?.count ?? 0,
    failure: failureResult[0]?.count ?? 0,
    last24h: last24h[0]?.count ?? 0,
  });
});

export { router as adminSecurityRouter };
