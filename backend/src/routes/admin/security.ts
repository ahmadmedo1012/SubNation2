import { authActivityTable, db } from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

router.get("/auth-activity", requireAdmin, async (req, res) => {
  const { action, startDate, endDate, success } = req.query;

  // A5-09 (round-94): the date filters fed `new Date(startDate as string)`
  // straight into drizzle — `?startDate=abc` produced `Invalid Date`, and
  // drizzle's toISOString() then threw RangeError → 500 (verified). Same
  // guard as admin/risk.ts from/to: parse, NaN → 400 INVALID_DATA.
  let startDateParsed: Date | null = null;
  if (typeof startDate === "string" && startDate) {
    startDateParsed = new Date(startDate);
    if (Number.isNaN(startDateParsed.getTime())) {
      return res
        .status(400)
        .json(createErrorResponse("تاريخ البداية غير صالح", ErrorCode.INVALID_DATA));
    }
  }
  let endDateParsed: Date | null = null;
  if (typeof endDate === "string" && endDate) {
    endDateParsed = new Date(endDate);
    if (Number.isNaN(endDateParsed.getTime())) {
      return res
        .status(400)
        .json(createErrorResponse("تاريخ النهاية غير صالح", ErrorCode.INVALID_DATA));
    }
  }

  const conditions = [];
  // A5-09: only treat action as a filter when it is a single string —
  // `?action=a&action=b` (array) previously coerced to a comma-joined
  // string that matched nothing (silent empty result).
  if (typeof action === "string" && action && action !== "all") {
    conditions.push(eq(authActivityTable.action, action));
  }
  if (startDateParsed) {
    conditions.push(gte(authActivityTable.createdAt, startDateParsed));
  }
  if (endDateParsed) {
    conditions.push(lte(authActivityTable.createdAt, endDateParsed));
  }
  if (typeof success === "string" && success && success !== "all") {
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
