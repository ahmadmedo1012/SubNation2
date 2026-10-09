import { adminUsersTable, auditLogsTable, db } from "@workspace/db";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { Router } from "express";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { limitParam, pageParam, queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";

/**
 * R127-L5 (B15-1) — the admin audit-trail READER.
 *
 * `audit_logs` is written by 6+ writers on every consequential admin
 * action (topup approve/reject, order refunds, wallet edits, risk
 * labels, ticket replies, copilot actions …), but before this route
 * NO admin endpoint ever read the table back — the accountability
 * data was captured server-side and then hidden from the only people
 * it exists for (B15-1: "who approved/refunded/overwrote this?" needed
 * DB access to answer). The security page's «إجراءات المسؤولين» tab
 * renders this endpoint.
 *
 * Scope: mounted under requirePermission("admins") in admin/index.ts —
 * the same gate as the security family it joins (auth-activity /
 * auth-stats). The rows carry actor/action/target/ip; that is the
 * point of the feature — target ids and the acting admin's username
 * are exactly what an incident review needs.
 */

const router = Router();

// 98-F3 / AUD103-4-F13 parity: the audit surface carries IPs (+ user
// agents upstream); an intermediary must never serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// R125-I6 (A8 B-5) / R120-B6 (A6-F1): the shared clamp helpers — the
// same page/limit contract as the alerts inbox (default 50, cap 200,
// MAX_PAGE ceiling on deep offsets).
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * A5-14-strict parse for the `actor`/`target` filters: both are admin/
 * row ids, and a sloppy Number() would coerce "12abc"→12 and "-5"→-5
 * into wasted queries. Garbage answers 400 INVALID_DATA (the same
 * strictness class as auth-activity's 400-on-unparseable-dates, A5-09).
 */
function positiveIntFilter(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value ? parsed : null;
}

router.get("/", requireAdmin, async (req, res) => {
  // ── action (exact-match free varchar — auth-activity's A5-09 single-
  //    string guard: array-valued params are ignored, "all"/empty mean
  //    no filter).
  const action = queryString(req, "action").trim();
  // ── actor / target (admin id / row id — strict positive ints, 400 on
  //    garbage).
  const actorRaw = queryString(req, "actor").trim();
  const targetRaw = queryString(req, "target").trim();
  // ── startDate / endDate (auth-activity's exact idiom: parse, NaN →
  //    400 INVALID_DATA — an Invalid Date used to throw RangeError
  //    inside drizzle's toISOString and 500).
  const startDateRaw = queryString(req, "startDate");
  const endDateRaw = queryString(req, "endDate");

  let actorId: number | null = null;
  if (actorRaw && actorRaw !== "all") {
    actorId = positiveIntFilter(actorRaw);
    if (actorId === null) {
      return res
        .status(400)
        .json(createErrorResponse("معرّف المسؤول غير صالح", ErrorCode.INVALID_DATA));
    }
  }
  let targetId: number | null = null;
  if (targetRaw && targetRaw !== "all") {
    targetId = positiveIntFilter(targetRaw);
    if (targetId === null) {
      return res
        .status(400)
        .json(createErrorResponse("معرّف الهدف غير صالح", ErrorCode.INVALID_DATA));
    }
  }
  let startDate: Date | null = null;
  if (startDateRaw) {
    startDate = new Date(startDateRaw);
    if (Number.isNaN(startDate.getTime())) {
      return res
        .status(400)
        .json(createErrorResponse("تاريخ البداية غير صالح", ErrorCode.INVALID_DATA));
    }
  }
  let endDate: Date | null = null;
  if (endDateRaw) {
    endDate = new Date(endDateRaw);
    if (Number.isNaN(endDate.getTime())) {
      return res
        .status(400)
        .json(createErrorResponse("تاريخ النهاية غير صالح", ErrorCode.INVALID_DATA));
    }
  }

  const conditions: SQL[] = [];
  if (action && action !== "all") {
    conditions.push(eq(auditLogsTable.action, action));
  }
  if (actorId !== null) {
    conditions.push(eq(auditLogsTable.actorId, actorId));
  }
  if (targetId !== null) {
    conditions.push(eq(auditLogsTable.targetId, targetId));
  }
  if (startDate) {
    conditions.push(gte(auditLogsTable.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(auditLogsTable.createdAt, endDate));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const page = pageParam(req);
  const limit = limitParam(req, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = (page - 1) * limit;

  // One page + the honest total (the alerts-envelope pair: rows,
  // total, page, limit, hasMore — offset + page length < total).
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: auditLogsTable.id,
        actorId: auditLogsTable.actorId,
        actorType: auditLogsTable.actorType,
        action: auditLogsTable.action,
        targetType: auditLogsTable.targetType,
        targetId: auditLogsTable.targetId,
        metadata: auditLogsTable.metadata,
        ip: auditLogsTable.ip,
        createdAt: auditLogsTable.createdAt,
        // B15-1's operator question is "WHO did this" — join the
        // acting admin's username so the tab reads بواسطة @ops_manager,
        // the same attribution shape topups (reviewed_by) and risk
        // labels (labeled_by_username) already ship.
        actorUsername: adminUsersTable.username,
      })
      .from(auditLogsTable)
      .leftJoin(adminUsersTable, eq(auditLogsTable.actorId, adminUsersTable.id))
      .where(where)
      // created_at desc (B15-1); id desc is the stable tiebreaker so
      // offset pages never shuffle same-timestamp rows.
      .orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(auditLogsTable)
      .where(where),
  ]);

  const total = Number(totals[0]?.count ?? 0);

  return res.json({
    logs: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorType: r.actorType,
      actorUsername: r.actorUsername ?? null,
      action: r.action,
      targetType: r.targetType ?? null,
      targetId: r.targetId ?? null,
      metadata: r.metadata ?? null,
      ip: r.ip ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  });
});

export { router as adminAuditLogsRouter };
