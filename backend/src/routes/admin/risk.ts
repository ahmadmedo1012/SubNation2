/**
 * Admin risk routes (003-anomaly-detection, US1 + US2 P1 slice).
 *
 * What ships in this slice:
 *   GET  /api/admin/risk/events           — list (filter by level/type/window)
 *   GET  /api/admin/risk/events/:id       — single event detail (+ stamps shown_at)
 *   POST /api/admin/risk/events/:id/label — write a risk_labels row
 *   POST /api/admin/risk/events/bulk-label — apply one label to many events
 *
 * What's not in this slice (deferred until the panel is in admins' hands):
 *   - rules/config CRUD (T032-T035) — rules are seedable, config has a sensible default
 *   - dashboard metrics (T046)      — admins can browse the list view first
 *   - critical-event alerting (T042) — the writer service exists, threading TBD
 *
 * All endpoints are owner-scoped on the admin (the audit log captures who
 * labeled what); no per-admin filtering on the events themselves — the
 * review queue is collaborative.
 */

import {
  adminUsersTable,
  auditLogsTable,
  db,
  riskConfigTable,
  riskEventsTable,
  riskLabelsTable,
  riskRulesTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { parseDsl } from "../../lib/risk-dsl";
import { recordLabel } from "../../lib/risk-metrics";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import { invalidateRiskConfig } from "../../services/risk-config-cache.service";
import { invalidateRulesCache } from "../../services/risk-rules.service";
import { sendCriticalRiskAlert } from "../../services/risk-alerts.service";

const router = Router();

const VALID_LEVELS = new Set(["low", "medium", "high", "critical"]);
const VALID_LABELS = new Set(["confirmed_fraud", "false_positive", "escalated"]);
// A5-03 (round-94): `?eventType=` feeds the risk_event_type pg-enum
// column. `level` next to it was already validated via VALID_LEVELS, but
// eventType was the forgotten sibling — any string outside the enum
// reached Postgres as 22P02 (`invalid input value for enum
// "risk_event_type"`) → 500 INTERNAL_ERROR. Values mirror
// riskEventTypeEnum (shared/db/src/schema/risk.ts).
const VALID_EVENT_TYPES = new Set([
  "login_attempt",
  "login_success",
  "login_failure",
  "otp_request",
  "otp_verify",
  "topup_attempt",
  "topup_success",
  "order_create",
  "order_deliver",
  "coupon_apply",
  "referral_event",
  "admin_force_reauth",
]);
// ────────────────────────────────────────────────────────────────────────
// GET /events — paginated review queue
// ────────────────────────────────────────────────────────────────────────
router.get("/risk/events", requireAdmin, async (req, res) => {
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200,
  );

  const filters: SQL[] = [];

  const level = typeof req.query.level === "string" ? req.query.level : null;
  if (level && VALID_LEVELS.has(level)) {
    filters.push(eq(riskEventsTable.level, level as never));
  }

  const eventType = typeof req.query.eventType === "string" ? req.query.eventType : null;
  if (eventType) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      res.status(400).json(
        createErrorResponse("نوع حدث مخاطر غير صالح", ErrorCode.INVALID_DATA),
      );
      return;
    }
    filters.push(eq(riskEventsTable.eventType, eventType as never));
  }

  const fromIso = typeof req.query.from === "string" ? req.query.from : null;
  if (fromIso) {
    const d = new Date(fromIso);
    if (!Number.isNaN(d.getTime())) filters.push(gte(riskEventsTable.createdAt, d));
  }
  const toIso = typeof req.query.to === "string" ? req.query.to : null;
  if (toIso) {
    const d = new Date(toIso);
    if (!Number.isNaN(d.getTime())) filters.push(lte(riskEventsTable.createdAt, d));
  }

  const userId = Number.parseInt(String(req.query.userId ?? ""), 10);
  if (Number.isFinite(userId) && userId > 0) {
    filters.push(eq(riskEventsTable.userId, userId));
  }

  // Cursor: opaque "<isoCreatedAt>:<id>" descending.
  const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
  if (cursorRaw) {
    const sep = cursorRaw.lastIndexOf(":");
    const iso = sep > 0 ? cursorRaw.slice(0, sep) : "";
    const id = Number.parseInt(cursorRaw.slice(sep + 1), 10);
    const cursorDate = new Date(iso);
    if (!Number.isNaN(cursorDate.getTime()) && Number.isFinite(id)) {
      filters.push(
        or(
          lt(riskEventsTable.createdAt, cursorDate),
          and(eq(riskEventsTable.createdAt, cursorDate), lt(riskEventsTable.id, id))!,
        )!,
      );
    }
  }

  const rows = await db
    .select({
      id: riskEventsTable.id,
      userId: riskEventsTable.userId,
      eventType: riskEventsTable.eventType,
      score: riskEventsTable.score,
      level: riskEventsTable.level,
      confidence: riskEventsTable.confidence,
      ruleFired: riskEventsTable.ruleFired,
      actionTaken: riskEventsTable.actionTaken,
      ipAddress: riskEventsTable.ipAddress,
      createdAt: riskEventsTable.createdAt,
      shownAt: riskEventsTable.shownAt,
      userPhone: usersTable.phone,
      userEmail: usersTable.email,
    })
    .from(riskEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, riskEventsTable.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(riskEventsTable.createdAt), desc(riskEventsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}:${last.id}` : null;

  res.json({
    events: page.map((r) => ({
      id: r.id,
      user_id: r.userId,
      user_phone: r.userPhone,
      user_email: r.userEmail,
      event_type: r.eventType,
      score: r.score,
      level: r.level,
      confidence: Number(r.confidence),
      rule_fired: r.ruleFired,
      action_taken: r.actionTaken,
      ip_address: r.ipAddress,
      created_at: r.createdAt.toISOString(),
      shown_at: r.shownAt?.toISOString() ?? null,
    })),
    next_cursor: nextCursor,
  });
});

// ────────────────────────────────────────────────────────────────────────
// GET /events/:id — full investigation view; stamps shown_at on first read
// ────────────────────────────────────────────────────────────────────────
router.get("/risk/events/:id", requireAdmin, async (req, res) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(createErrorResponse("معرّف الحدث غير صالح", ErrorCode.INVALID_DATA));
    return;
  }

  const [row] = await db
    .select({
      event: riskEventsTable,
      userPhone: usersTable.phone,
      userEmail: usersTable.email,
    })
    .from(riskEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, riskEventsTable.userId))
    .where(eq(riskEventsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json(createErrorResponse("الحدث غير موجود", ErrorCode.NOT_FOUND));
    return;
  }

  // First-open stamps shown_at — powers SC-004 (triage time).
  if (!row.event.shownAt) {
    await db.update(riskEventsTable).set({ shownAt: new Date() }).where(eq(riskEventsTable.id, id));
  }

  // Existing labels for this event (most recent first).
  const labels = await db
    .select({
      id: riskLabelsTable.id,
      label: riskLabelsTable.label,
      labeledBy: riskLabelsTable.labeledBy,
      labeledAt: riskLabelsTable.labeledAt,
      notes: riskLabelsTable.notes,
      adminUsername: adminUsersTable.username,
    })
    .from(riskLabelsTable)
    .leftJoin(adminUsersTable, eq(adminUsersTable.id, riskLabelsTable.labeledBy))
    .where(eq(riskLabelsTable.riskEventId, id))
    .orderBy(desc(riskLabelsTable.labeledAt));

  res.json({
    event: {
      id: row.event.id,
      user_id: row.event.userId,
      user_phone: row.userPhone,
      user_email: row.userEmail,
      event_type: row.event.eventType,
      score: row.event.score,
      level: row.event.level,
      confidence: Number(row.event.confidence),
      rule_fired: row.event.ruleFired,
      statistical_signals: row.event.statisticalSignals,
      ml_score: row.event.mlScore == null ? null : Number(row.event.mlScore),
      top_features: row.event.topFeatures,
      action_taken: row.event.actionTaken,
      ip_address: row.event.ipAddress,
      user_agent: row.event.userAgent,
      created_at: row.event.createdAt.toISOString(),
      shown_at: (row.event.shownAt ?? new Date()).toISOString(),
    },
    labels: labels.map((l) => ({
      id: l.id,
      label: l.label,
      labeled_by: l.labeledBy,
      labeled_by_username: l.adminUsername,
      labeled_at: l.labeledAt.toISOString(),
      notes: l.notes,
    })),
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /events/:id/label — single-event label
// ────────────────────────────────────────────────────────────────────────
router.post("/risk/events/:id/label", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(createErrorResponse("معرّف الحدث غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const body = (req.body ?? {}) as { label?: string; notes?: string };
  const label = typeof body.label === "string" ? body.label : "";
  if (!VALID_LABELS.has(label)) {
    res.status(400).json(createErrorResponse("التصنيف غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null;

  const [exists] = await db
    .select({ id: riskEventsTable.id })
    .from(riskEventsTable)
    .where(eq(riskEventsTable.id, id))
    .limit(1);
  if (!exists) {
    res.status(404).json(createErrorResponse("الحدث غير موجود", ErrorCode.NOT_FOUND));
    return;
  }

  const [row] = await db
    .insert(riskLabelsTable)
    .values({
      riskEventId: id,
      label: label as never,
      labeledBy: adminReq.adminId,
      notes,
    })
    .returning({ id: riskLabelsTable.id });

  // Round-3 (8-a §2): this inline insert re-implemented lib/risk-labels
  // but silently DROPPED the recordLabel() metrics call — the
  // risk_labels_total{label} counter never incremented for admin labels.
  recordLabel(label);

  await writeAuditLog(req, "risk.label", "risk_event", id, {
    label,
    notes_len: notes?.length ?? 0,
  });

  res.json({ id: row?.id, success: true });
});

// ────────────────────────────────────────────────────────────────────────
// POST /events/bulk-label — apply one label to many events (cap 100)
// ────────────────────────────────────────────────────────────────────────
router.post("/risk/events/bulk-label", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const body = (req.body ?? {}) as { event_ids?: unknown; label?: string; notes?: string };
  const ids = Array.isArray(body.event_ids)
    ? body.event_ids.filter((v): v is number => typeof v === "number" && v > 0)
    : [];
  if (ids.length === 0) {
    res.status(400).json(createErrorResponse("event_ids مطلوب", ErrorCode.INVALID_DATA));
    return;
  }
  if (ids.length > 100) {
    res
      .status(400)
      .json(
        createErrorResponse("لا يمكن تصنيف أكثر من 100 حدث دفعة واحدة", ErrorCode.INVALID_DATA),
      );
    return;
  }
  const label = typeof body.label === "string" ? body.label : "";
  if (!VALID_LABELS.has(label)) {
    res.status(400).json(createErrorResponse("التصنيف غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null;

  // Filter to actually-existing event ids before writing labels — partial
  // success is preferable to a transaction-wide failure here.
  const existing = await db
    .select({ id: riskEventsTable.id })
    .from(riskEventsTable)
    .where(inArray(riskEventsTable.id, ids));
  const existingIds = new Set(existing.map((r) => r.id));
  const valid = ids.filter((i) => existingIds.has(i));
  if (valid.length === 0) {
    res
      .status(404)
      .json(createErrorResponse("لم يُعثر على أي حدث من الأحداث المطلوبة", ErrorCode.NOT_FOUND));
    return;
  }

  await db.insert(riskLabelsTable).values(
    valid.map((eventId) => ({
      riskEventId: eventId,
      label: label as never,
      labeledBy: adminReq.adminId,
      notes,
    })),
  );

  // Single audit row for the batch, not one per event — keeps audit_logs
  // legible.
  await db.insert(auditLogsTable).values({
    actorType: "admin",
    actorId: adminReq.adminId,
    action: "risk.bulk_label",
    targetType: "risk_event",
    targetId: null,
    metadata: JSON.stringify({ label, count: valid.length, ids: valid }),
  });

  res.json({
    applied: valid.length,
    skipped: ids.length - valid.length,
    label,
  });
});

// ────────────────────────────────────────────────────────────────────────
// GET /risk/rules — full rule catalog (T032)
// ────────────────────────────────────────────────────────────────────────
router.get("/risk/rules", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(riskRulesTable).orderBy(desc(riskRulesTable.updatedAt));
  res.json({
    rules: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      expression: r.expression,
      enabled: r.enabled,
      version: r.version,
      created_by: r.createdBy,
      created_at: r.createdAt.toISOString(),
      updated_by: r.updatedBy,
      updated_at: r.updatedAt.toISOString(),
    })),
  });
});

// ────────────────────────────────────────────────────────────────────────
// PUT /risk/rules/:id — toggle enabled or replace expression (T033)
// ────────────────────────────────────────────────────────────────────────
router.put("/risk/rules/:id", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(createErrorResponse("معرّف القاعدة غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const body = (req.body ?? {}) as {
    enabled?: boolean;
    expression?: unknown;
    description?: string;
  };

  const update: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.description === "string") {
    update.description = body.description.slice(0, 2000);
  }
  if (body.expression !== undefined) {
    const parsed = parseDsl(body.expression);
    if (!parsed.ok) {
      res
        .status(400)
        .json(
          createErrorResponse(`صيغة القاعدة غير صالحة: ${parsed.reason}`, ErrorCode.INVALID_DATA),
        );
      return;
    }
    update.expression = body.expression;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json(createErrorResponse("لا توجد حقول للتحديث", ErrorCode.INVALID_DATA));
    return;
  }
  update.updatedBy = adminReq.adminId;
  update.updatedAt = new Date();

  const [row] = await db
    .update(riskRulesTable)
    .set(update)
    .where(eq(riskRulesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json(createErrorResponse("القاعدة غير موجودة", ErrorCode.NOT_FOUND));
    return;
  }
  // Bump the version on every successful change (data-model.md §2).
  await db
    .update(riskRulesTable)
    .set({ version: (row.version ?? 1) + 1 })
    .where(eq(riskRulesTable.id, id));

  invalidateRulesCache();
  await writeAuditLog(req, "risk.rule_update", "risk_rule", id, {
    fields: Object.keys(update),
  });

  res.json({ id, success: true });
});

// ────────────────────────────────────────────────────────────────────────
// GET /risk/config — singleton thresholds + allowlist + auto-block (T034)
// ────────────────────────────────────────────────────────────────────────
router.get("/risk/config", requireAdmin, async (_req, res) => {
  const [row] = await db.select().from(riskConfigTable).limit(1);
  if (!row) {
    // Seed on first read (T034 — auto-seed singleton).
    const [seeded] = await db.insert(riskConfigTable).values({ id: 1 }).returning();
    res.json(formatConfig(seeded!));
    return;
  }
  res.json(formatConfig(row));
});

// ────────────────────────────────────────────────────────────────────────
// PUT /risk/config — admins tune thresholds without redeploy (T035)
// ────────────────────────────────────────────────────────────────────────
router.put("/risk/config", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const body = (req.body ?? {}) as {
    thresholds?: Partial<{ low: number; medium: number; high: number; critical: number }>;
    allowlist?: Partial<{ ips: string[]; devices: string[]; phones: string[] }>;
    autoBlockEnabled?: Partial<{ softBlock: boolean; hardBlock: boolean; alert: boolean }>;
    modelEnabled?: boolean;
    requireApprovalUserIds?: number[];
  };

  const [existing] = await db.select().from(riskConfigTable).limit(1);
  const current = existing ?? null;

  const thresholds = {
    low: body.thresholds?.low ?? (current?.thresholds as { low: number } | null)?.low ?? 0,
    medium:
      body.thresholds?.medium ?? (current?.thresholds as { medium: number } | null)?.medium ?? 30,
    high: body.thresholds?.high ?? (current?.thresholds as { high: number } | null)?.high ?? 60,
    critical:
      body.thresholds?.critical ??
      (current?.thresholds as { critical: number } | null)?.critical ??
      85,
  };
  if (
    !(
      thresholds.low < thresholds.medium &&
      thresholds.medium < thresholds.high &&
      thresholds.high < thresholds.critical
    )
  ) {
    res
      .status(400)
      .json(
        createErrorResponse(
          "thresholds يجب أن تكون منخفضة < متوسطة < عالية < حرجة",
          ErrorCode.INVALID_DATA,
        ),
      );
    return;
  }

  const currentAuto = (current?.autoBlockEnabled as {
    softBlock: boolean;
    hardBlock: boolean;
    alert: boolean;
  } | null) ?? { softBlock: true, hardBlock: false, alert: true };
  const autoBlockEnabled = {
    softBlock: body.autoBlockEnabled?.softBlock ?? currentAuto.softBlock,
    hardBlock: body.autoBlockEnabled?.hardBlock ?? currentAuto.hardBlock,
    alert: body.autoBlockEnabled?.alert ?? currentAuto.alert,
  };
  const modelEnabled = body.modelEnabled ?? current?.modelEnabled ?? false;
  // hardBlock requires modelEnabled — defense-in-depth from data-model §3.
  if (autoBlockEnabled.hardBlock && !modelEnabled) {
    res
      .status(400)
      .json(
        createErrorResponse(
          "تفعيل hardBlock يتطلب تفعيل النموذج (modelEnabled) أولاً",
          ErrorCode.INVALID_DATA,
        ),
      );
    return;
  }

  const currentAllow = (current?.allowlist as {
    ips: string[];
    devices: string[];
    phones: string[];
  } | null) ?? { ips: [], devices: [], phones: [] };
  const allowlist = {
    ips: Array.isArray(body.allowlist?.ips) ? body.allowlist!.ips : currentAllow.ips,
    devices: Array.isArray(body.allowlist?.devices)
      ? body.allowlist!.devices
      : currentAllow.devices,
    phones: Array.isArray(body.allowlist?.phones) ? body.allowlist!.phones : currentAllow.phones,
  };

  const requireApprovalUserIds = Array.isArray(body.requireApprovalUserIds)
    ? body.requireApprovalUserIds.filter((v): v is number => typeof v === "number" && v > 0)
    : ((current?.requireApprovalUserIds as number[] | null) ?? []);

  const updated = {
    thresholds,
    allowlist,
    autoBlockEnabled,
    modelEnabled,
    requireApprovalUserIds,
    updatedBy: adminReq.adminId,
    updatedAt: new Date(),
  };
  if (current) {
    await db.update(riskConfigTable).set(updated).where(eq(riskConfigTable.id, 1));
  } else {
    await db.insert(riskConfigTable).values({ id: 1, ...updated });
  }
  await invalidateRiskConfig();
  await writeAuditLog(req, "risk.config_update", "risk_config", 1, {
    thresholds,
    autoBlockEnabled,
    modelEnabled,
    allowlist_sizes: {
      ips: allowlist.ips.length,
      devices: allowlist.devices.length,
      phones: allowlist.phones.length,
    },
  });
  const [next] = await db.select().from(riskConfigTable).limit(1);
  res.json(formatConfig(next!));
});

function formatConfig(row: typeof riskConfigTable.$inferSelect) {
  return {
    id: row.id,
    thresholds: row.thresholds,
    allowlist: row.allowlist,
    auto_block_enabled: row.autoBlockEnabled,
    require_approval_user_ids: row.requireApprovalUserIds,
    model_enabled: row.modelEnabled,
    updated_by: row.updatedBy,
    updated_at: row.updatedAt.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// GET /risk/dashboard — top-line metrics for the review queue header (T046)
// ────────────────────────────────────────────────────────────────────────
router.get("/risk/dashboard", requireAdmin, async (req, res) => {
  const hours = Math.min(
    Math.max(Number.parseInt(String(req.query.hours ?? "24"), 10) || 24, 1),
    720,
  );

  // Round-3 (8-c §2.6): the dashboard's three aggregates (by-level,
  // unresolved backlog, top rules) were three sequential round trips —
  // they only share the lookback window, so they run concurrently now.
  const [byLevelResult, unresolvedResult, topRulesResult] = await Promise.all([
    db.execute(sql`
      SELECT level, COUNT(*)::int AS n
      FROM risk_events
      WHERE created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
      GROUP BY level
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM risk_events e
      WHERE e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
        AND NOT EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)
    `),
    db.execute(sql`
      SELECT rule, COUNT(*)::int AS n
      FROM risk_events e, UNNEST(e.rule_fired) AS rule
      WHERE e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
      GROUP BY rule
      ORDER BY n DESC
      LIMIT 5
    `),
  ]);
  type LevelRow = { level: string; n: number };
  const lR = byLevelResult as unknown as { rows?: LevelRow[] } | LevelRow[];
  const levelRows = Array.isArray(lR) ? lR : (lR.rows ?? []);
  const byLevel: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const r of levelRows) byLevel[r.level] = Number(r.n);
  const total = Object.values(byLevel).reduce((a, b) => a + b, 0);

  // Unresolved (no risk_labels row yet) — admins use this to gauge backlog.
  type CountRow = { n: number };
  const uR = unresolvedResult as unknown as { rows?: CountRow[] } | CountRow[];
  const unresolved = Number((Array.isArray(uR) ? uR[0]?.n : uR.rows?.[0]?.n) ?? 0);

  // Top fired rules — flatten the rule_fired text[] column.
  type RuleRow = { rule: string; n: number };
  const rR = topRulesResult as unknown as { rows?: RuleRow[] } | RuleRow[];
  const ruleRows = Array.isArray(rR) ? rR : (rR.rows ?? []);
  const topRules = ruleRows.map((r) => ({ rule: r.rule, count: Number(r.n) }));

  // Pipeline state — enabled? degraded?
  const enabled = process.env.RISK_PIPELINE_ENABLED === "true";

  res.json({
    window_hours: hours,
    total,
    by_level: byLevel,
    unresolved,
    top_rules: topRules,
    pipeline: {
      enabled,
    },
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /risk/synth — synthetic event for verifying the wiring (T044)
// ────────────────────────────────────────────────────────────────────────
//
// Dev/staging only. Inserts a synthetic risk_events row at the chosen level,
// optionally triggering the critical-alert path. Lets operators confirm
// the UI, alerting, and label flow without waiting for real fraud traffic.
router.post("/risk/synth", requireAdmin, async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res
      .status(403)
      .json(createErrorResponse("الأداة الاصطناعية متاحة في بيئات التطوير فقط", ErrorCode.FORBIDDEN));
    return;
  }
  const adminReq = req as AdminAuthenticatedRequest;
  const body = (req.body ?? {}) as { level?: string; event_type?: string; user_id?: number };
  const level = typeof body.level === "string" && VALID_LEVELS.has(body.level) ? body.level : "critical";
  const eventType = typeof body.event_type === "string" ? body.event_type : "topup_attempt";
  const score = level === "critical" ? 95 : level === "high" ? 70 : level === "medium" ? 40 : 10;

  const [row] = await db
    .insert(riskEventsTable)
    .values({
      userId: typeof body.user_id === "number" && body.user_id > 0 ? body.user_id : null,
      eventType: eventType as never,
      score,
      level: level as never,
      confidence: "0.800",
      ruleFired: ["synthetic_admin_test"],
      statisticalSignals: {},
      mlScore: null,
      topFeatures: null,
      actionTaken: level === "critical" ? "alert" : "log",
      ipAddress: req.ip ?? null,
      userAgent: ((req.headers["user-agent"] as string | undefined) ?? "").slice(0, 256) || null,
    })
    .returning({ id: riskEventsTable.id });
  if (!row) {
    res.status(500).json(createErrorResponse("فشل إنشاء الحدث الاصطناعي", ErrorCode.INTERNAL_ERROR));
    return;
  }

  await writeAuditLog(req, "risk.synth", "risk_event", row.id, { level, score, event_type: eventType });

  // For critical events, fire the alert path so the admin can see the
  // Discord/Telegram dispatch (or its failure) without needing real traffic.
  if (level === "critical") {
    void sendCriticalRiskAlert({
      riskEventId: row.id,
      userId: typeof body.user_id === "number" && body.user_id > 0 ? body.user_id : null,
      eventType,
      score,
      level: "critical",
      topFeatures: null,
    }).catch(() => {});
  }

  res.json({
    id: row.id,
    level,
    score,
    investigation_url: `/admin/risk/events/${row.id}`,
    triggered_by: adminReq.adminId,
  });
});

export const adminRiskRouter = router;
