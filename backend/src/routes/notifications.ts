import { Router } from "express";
import { z } from "zod";
import { db, notificationsTable, pushTokensTable } from "@workspace/db";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { intParam, limitParam, pageParam, queryString } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped notifications
// surface — read state must never be served stale by an intermediary.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// A9-F2 (R128-IMP-5 / B1 item 8): the pagination clamps — the audit-logs
// route's exact idiom (R127-L5): pageParam/limitParam shared helpers
// (NaN/garbage → defaults, deep-offset MAX_PAGE ceiling, limit capped).
const BELL_PAGE_LIMIT = 40;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/** The row DTO shared by both branches (snake_case contract — the bell
 * parses these keys verbatim; the paged page rides the same rows). */
function toNotificationDto(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    is_read: n.isRead,
    created_at: n.createdAt.toISOString(),
  };
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // A9-F2 (R128-IMP-5): additive ?page= pagination for the /notifications
  // page — the audit-logs envelope idiom (rows, total, page, limit,
  // hasMore; offset + page length < total) with the same createdAt-DESC +
  // id-DESC tiebreaker so offset pages never shuffle same-timestamp rows.
  //
  // COMPATIBILITY (B1 item 8: "keep the paramless shape byte-compatible
  // for the bell"): NotificationBell fetches this route PARAMLESS and
  // guards `Array.isArray(data)` — an unconditional envelope would blank
  // every bell. The paged envelope is therefore OPT-IN by naming the
  // param; a bare `?page=` (empty value) degenerates to the bell shape
  // (clamping it to page 1 would be identical data in the other shape).
  if (queryString(req, "page") === "") {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      // id DESC: the stable tiebreaker (same-ms rows order by insertion,
      // reverse) — observable only as determinism, never as a shape change.
      .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
      .limit(BELL_PAGE_LIMIT);

    return res.json(rows.map(toNotificationDto));
  }

  const page = pageParam(req);
  const limit = limitParam(req, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
  const offset = (page - 1) * limit;

  // One page + the honest total (the audit-logs Promise.all pair).
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId)),
  ]);

  const total = Number(totals[0]?.count ?? 0);

  return res.json({
    notifications: rows.map(toNotificationDto),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  });
});

router.post("/read-all", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, userId));
  return res.json({ success: true });
});

router.post("/:id/read", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));
  // Silent no-op → 404 (audit §5): marking a non-existent or non-owned
  // notification read used to return `{success:true}` — the client could
  // never distinguish success from a stale list / wrong id.
  const marked = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning({ id: notificationsTable.id });
  if (marked.length === 0)
    return res.status(404).json(createErrorResponse("الإشعار غير موجود", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

// ── R191 (backend mobile contracts): Expo push-token registration ─────────────
//
// Customer surface (requireUser) riding the notifications router — mounted
// at /api/notifications/push-tokens by routes/index.ts. The POST is a
// UPSERT on the token's natural key: a device that re-registers after
// re-login TRANSFERS ownership (user_id is overwritten), and a revoked
// token (logout) un-revokes. The DELETE is a soft revoke (revoked_at =
// now) — the row stays for audit; only the OWNER may revoke (honest 404
// otherwise, the audit-§5 ownership discipline). CSRF: these are
// state-changing POST/DELETE under /api — the app-level Origin gate
// (createCsrfGate) covers them exactly like every other /api mutation.

// The token format Expo's SDK issues: ExponentPushToken[<opaque>] — the
// prefix is the validation gate (≤255 mirrors the column).
const registerPushTokenSchema = z.object({
  expo_push_token: z.string().max(255).startsWith("ExponentPushToken["),
  platform: z.enum(["android", "ios"]),
  device_label: z.string().trim().max(255).optional(),
});

router.post("/push-tokens", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const parse = registerPushTokenSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return res
      .status(400)
      .json(createErrorResponse("رمز الإشعار غير صالح", ErrorCode.INVALID_DATA));
  }
  const { expo_push_token, platform, device_label } = parse.data;

  await db
    .insert(pushTokensTable)
    .values({
      userId,
      expoPushToken: expo_push_token,
      platform,
      deviceLabel: device_label ?? null,
    })
    .onConflictDoUpdate({
      target: pushTokensTable.expoPushToken,
      set: {
        // Ownership transfer on re-login + platform/label refresh +
        // un-revoke (revoked_at = NULL) + the activity heartbeat.
        userId,
        platform,
        deviceLabel: device_label ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        revokedAt: null,
      },
    });

  return res.json({ success: true });
});

const deletePushTokenSchema = z.object({
  expo_push_token: z.string().max(255).startsWith("ExponentPushToken["),
});

router.delete("/push-tokens", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const parse = deletePushTokenSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return res
      .status(400)
      .json(createErrorResponse("رمز الإشعار غير صالح", ErrorCode.INVALID_DATA));
  }
  // Ownership-scoped soft revoke — a foreign token id is an honest 404
  // (audit §5 discipline), never a silent success.
  const revoked = await db
    .update(pushTokensTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pushTokensTable.expoPushToken, parse.data.expo_push_token),
        eq(pushTokensTable.userId, userId),
      ),
    )
    .returning({ id: pushTokensTable.id });
  if (revoked.length === 0)
    return res.status(404).json(createErrorResponse("الرمز غير موجود", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

// The sessions/device screen's list — ACTIVE registrations only
// (revoked rows are audit history, not a device list).
router.get("/push-tokens", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const rows = await db
    .select({
      id: pushTokensTable.id,
      platform: pushTokensTable.platform,
      deviceLabel: pushTokensTable.deviceLabel,
      lastSeenAt: pushTokensTable.lastSeenAt,
    })
    .from(pushTokensTable)
    .where(and(eq(pushTokensTable.userId, userId), isNull(pushTokensTable.revokedAt)))
    .orderBy(desc(pushTokensTable.lastSeenAt))
    .limit(200);

  return res.json({
    push_tokens: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      device_label: r.deviceLabel,
      last_seen_at: r.lastSeenAt.toISOString(),
    })),
  });
});

export { router as notificationsRouter };
