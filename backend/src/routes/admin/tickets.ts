import { db, supportTicketsTable, ticketRepliesTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { intParam, queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { createNotification } from "../../notify";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern —
// admin ticket threads are user support PII; an intermediary must
// never serve them from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// A5-03 (round-94): `?status=` feeds the ticket_status pg-enum column —
// an out-of-enum value reached Postgres as 22P02 → 500. Values mirror
// ticketStatusEnum (shared/db/src/schema/support_tickets.ts).
const TicketStatusFilter = z.enum(["open", "in_progress", "closed"]).optional();

// A5-04 (round-94): the admin reply body was read raw (`message?.trim()`)
// — a non-string message crashed .trim() → 500 (the same M2 class fixed
// for coupon bodies long ago; this route was missed). Same 4000-char cap
// as the user-facing reply route (support.ts).
const AdminReplyBody = z
  .object({
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

router.get("/tickets", requireAdmin, async (req, res) => {
  const statusParse = TicketStatusFilter.safeParse(
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  if (!statusParse.success) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "حالة تذكرة غير صالحة (المسموح: open, in_progress, closed)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const conditions =
    statusParse.data !== undefined
      ? [eq(supportTicketsTable.status, statusParse.data)]
      : [];

  // A2 (round-94): ?page=&limit= — same clamp pattern as the admin orders
  // list. Previously fixed at the newest 100 rows; older tickets were
  // unreachable while the counter counted them. Body stays an array.
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);

  const tickets = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(limit)
    .offset((page - 1) * limit);

  // H18 (deep-audit 2026-09-06): this was 2N+1 queries — 100 tickets
  // meant 201 round trips to a 15-connection shared pool (reply-count +
  // latest-reply per ticket). Two batch queries below (GROUP BY count +
  // DISTINCT ON latest) do the same work in 2 round trips total.
  const ticketIds = tickets.map((row) => row.ticket.id);

  // V1-M5 (red-team 2026-09-06): an empty result set must not reach the
  // sql.join below — `IN ()` is a Postgres syntax error and turned every
  // zero-match status filter (and every fresh deploy) into a 500.
  if (ticketIds.length === 0) {
    return res.json([]);
  }

  const replyCounts = await db
    .select({ ticketId: ticketRepliesTable.ticketId, replyCount: count() })
    .from(ticketRepliesTable)
    .where(sql`${ticketRepliesTable.ticketId} IN (${sql.join(ticketIds, sql`, `)})`)
    .groupBy(ticketRepliesTable.ticketId);
  const replyCountMap = new Map<number, number>(
    replyCounts.map((r) => [r.ticketId, Number(r.replyCount)]),
  );

  const latestReplies = await db.execute<{
    ticket_id: number;
    author_type: string;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (ticket_id)
      ticket_id, author_type, created_at
    FROM ${ticketRepliesTable}
    WHERE ticket_id IN (${sql.join(ticketIds, sql`, `)})
    ORDER BY ticket_id, created_at DESC
  `);
  const lastReplyMap = new Map<
    number,
    { authorType: string; createdAt: Date }
  >();
  for (const r of latestReplies.rows ?? []) {
    lastReplyMap.set(r.ticket_id, {
      authorType: r.author_type,
      createdAt: new Date(r.created_at),
    });
  }

  const withCounts = tickets.map((row) => {
    const ticket = row.ticket;
    const cnt = replyCountMap.get(ticket.id) ?? 0;
    const lastReply = lastReplyMap.get(ticket.id);
    return {
      id: ticket.id,
      user_phone: row.userPhone ?? "",
      user_display_name: row.userDisplayName ?? null,
      user_email: row.userEmail ?? null,
      user_auth_provider: row.userAuthProvider ?? null,
      user_has_google: !!row.userGoogleId,
      user_has_telegram: !!row.userTelegramId,
      user_has_firebase: !!row.userFirebaseUid,
      user_has_whatsapp: row.userAuthProvider === "whatsapp_phone",
      title: ticket.title,
      category: ticket.category,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
      reply_count: cnt,
      last_reply_at: lastReply?.createdAt?.toISOString() ?? null,
      has_unread_admin: lastReply?.authorType === "user",
    };
  });

  return res.json(withCounts);
});

router.get("/tickets/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [row] = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: row.ticket.id,
    user_phone: row.userPhone ?? "",
    user_display_name: row.userDisplayName ?? null,
    user_email: row.userEmail ?? null,
    user_auth_provider: row.userAuthProvider ?? null,
    user_has_google: !!row.userGoogleId,
    user_has_telegram: !!row.userTelegramId,
    user_has_firebase: !!row.userFirebaseUid,
    user_has_whatsapp: row.userAuthProvider === "whatsapp_phone",
    title: row.ticket.title,
    category: row.ticket.category,
    status: row.ticket.status,
    created_at: row.ticket.createdAt.toISOString(),
    replies: replies.map((r) => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

router.post("/tickets/:id/reply", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // A5-04: schema-validated body — non-string message previously hit
  // `message?.trim()` TypeError → 500.
  const parse = AdminReplyBody.safeParse(req.body ?? {});
  if (!parse.success)
    return res.status(400).json(createErrorResponse("الرسالة مطلوبة (نص حتى 4000 حرف)", ErrorCode.INVALID_DATA));
  const { message } = parse.data;

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, id))
    .limit(1);
  if (!ticket) return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({
      ticketId: id,
      authorType: "admin",
      message: message.trim(),
    })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  await createNotification(
    ticket.userId,
    "support",
    "رد جديد على تذكرتك",
    message.slice(0, 100),
    `/support`,
  );

  return res.status(201).json({
    id: reply.id,
    author_type: reply.authorType,
    message: reply.message,
    created_at: reply.createdAt.toISOString(),
  });
});

router.patch("/tickets/:id/status", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const { status } = req.body ?? {};
  if (!["open", "in_progress", "closed"].includes(status))
    return res.status(400).json(createErrorResponse("حالة غير صالحة", ErrorCode.INVALID_DATA));

  // Silent no-op → 404 (audit §5): PATCHing a non-existent ticket used
  // to return `{success:true}` — the admin UI silently "closed" nothing.
  const updated = await db
    .update(supportTicketsTable)
    .set({ status })
    .where(eq(supportTicketsTable.id, id))
    .returning({ id: supportTicketsTable.id });
  if (updated.length === 0)
    return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

export { router as adminTicketsRouter };
