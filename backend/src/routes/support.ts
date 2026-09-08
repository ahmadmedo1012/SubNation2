import { db, supportTicketsTable, ticketRepliesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { intParam } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

// SEC-92-07 (round-92): cap on user-authored ticket/reply message bodies.
// Ticket creation caps title (≤ 255) and rate (5/h) but the MESSAGE body
// was unbounded — the only ceiling was the global 1 MB JSON limit, so a
// scripted user could park ~1 MB text rows into ticket_replies at
// userLimiter cadence (multi-GB/day storage growth on a starter-tier
// Neon + degraded admin ticket views). 4000 chars matches the copilot
// intent-text bound (routes/admin/copilot/ask.ts) — far above any human
// support message, small enough to make storage-DoS expensive.
const MAX_TICKET_MESSAGE_CHARS = 4000;

// A5-04 (round-94): ticket/reply bodies were read raw (`title?.trim()`,
// `message?.trim()`) — a non-string value crashed `.trim()` → TypeError →
// 500 (the M2 class fixed for coupon bodies long ago; these user-facing
// routes were missed). One shared schema caps the same limits the inline
// checks used to enforce AFTER the type crash point.
const TicketMessageBody = z.object({
  message: z.string().trim().min(1).max(MAX_TICKET_MESSAGE_CHARS),
});

const CreateTicketBody = z.object({
  title: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(MAX_TICKET_MESSAGE_CHARS),
  category: z.enum(["billing", "technical", "order", "account", "other"]).optional(),
});

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, userId))
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(200);

  if (tickets.length === 0) return res.json([]);

  // Fetch the most recent reply per ticket in a single query (no N+1).
  const ticketIds = tickets.map((t) => t.id);
  const latestReplies = await db.execute<{
    ticket_id: number;
    author_type: string;
    message: string;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (ticket_id)
      ticket_id, author_type, message, created_at
    FROM ${ticketRepliesTable}
    WHERE ticket_id IN (${sql.join(ticketIds, sql`, `)})
    ORDER BY ticket_id, created_at DESC
  `);

  const replyMap = new Map<number, { author_type: string; message: string; created_at: Date }>();
  for (const r of latestReplies.rows ?? []) {
    replyMap.set(r.ticket_id, {
      author_type: r.author_type,
      message: r.message,
      created_at: r.created_at,
    });
  }

  const result = tickets.map((t) => {
    const reply = replyMap.get(t.id);
    return {
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      created_at: t.createdAt.toISOString(),
      last_reply: reply
        ? {
            author_type: reply.author_type,
            message: reply.message.slice(0, 80),
            created_at: new Date(reply.created_at).toISOString(),
          }
        : null,
    };
  });

  return res.json(result);
});

// V3-C5a: ticket-creation spam guard — the global userLimiter (1200/min)
// was the only ceiling on this route; 5 tickets/hour/user is far above
// any human cadence. Keyed by userId (requireUser has already run), so
// the express-rate-limit IPv6 keyGenerator validation does not apply.
const ticketCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `ticket:${(req as AuthenticatedRequest).userId}`,
  message: {
    error:
      "لقد أنشأت عدداً كافياً من التذاكر في هذه الساعة. انتظر قليلاً أو أضف رداً على تذكرة قائمة.",
    code: "RATE_LIMITED",
  },
});

router.post("/", requireUser, ticketCreateLimiter, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // A5-04: schema gate — non-string title/message previously crashed
  // `.trim()` → 500. Field-specific Arabic messages preserved.
  const parse = CreateTicketBody.safeParse(req.body ?? {});
  if (!parse.success) {
    const issue = parse.error.issues[0];
    const message =
      issue?.path?.[0] === "title"
        ? issue.code === "too_big"
          ? "العنوان طويل جداً"
          : "العنوان مطلوب"
        : issue?.path?.[0] === "message"
          ? issue.code === "too_big"
            ? "الرسالة طويلة جداً (الحد 4000 حرف)"
            : "العنوان والرسالة مطلوبان"
          : "بيانات غير صالحة";
    return res.status(400).json(createErrorResponse(message, ErrorCode.INVALID_DATA));
  }
  const { title, message, category } = parse.data;

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({
      userId,
      title,
      category: category ?? "other",
      status: "open",
    })
    .returning();

  await db.insert(ticketRepliesTable).values({
    ticketId: ticket.id,
    authorType: "user",
    message,
  });

  return res.status(201).json({
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    created_at: ticket.createdAt.toISOString(),
  });
});

router.get("/:id", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket)
    return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    status: ticket.status,
    created_at: ticket.createdAt.toISOString(),
    replies: replies.map((r) => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

// SEC-92-07: per-user reply limiter, mirroring ticketCreateLimiter above.
// 30 replies/hour/user is two orders of magnitude above any honest
// conversation cadence while capping the storage-DoS amplifier (each
// reply is a ticket_replies row + a status update). Keyed by userId
// (requireUser has already run), so the express-rate-limit IPv6
// keyGenerator validation does not apply.
const ticketReplyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `ticket-reply:${(req as AuthenticatedRequest).userId}`,
  message: {
    error: "لقد أرسلت عدداً كافياً من الردود في هذه الساعة. انتظر قليلاً قبل المحاولة مجدداً.",
    code: "RATE_LIMITED",
  },
});

router.post("/:id/reply", requireUser, ticketReplyLimiter, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket)
    return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));
  if (ticket.status === "closed")
    return res.status(400).json(createErrorResponse("التذكرة مغلقة", ErrorCode.INVALID_DATA));

  const { message } = req.body ?? {};
  // A5-04: schema gate — non-string message previously crashed `.trim()`
  // → 500 on a rate-limited route (the failure also consumed a limiter
  // tick). Field-specific messages preserved.
  const messageParse = TicketMessageBody.safeParse({ message });
  if (!messageParse.success) {
    const tooBig = messageParse.error.issues[0]?.code === "too_big";
    return res
      .status(400)
      .json(
        createErrorResponse(
          tooBig ? "الرسالة طويلة جداً (الحد 4000 حرف)" : "الرسالة مطلوبة",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const trimmed = messageParse.data.message;

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({
      ticketId: id,
      authorType: "user",
      message: trimmed,
    })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  return res.status(201).json({
    id: reply.id,
    author_type: reply.authorType,
    message: reply.message,
    created_at: reply.createdAt.toISOString(),
  });
});

export { router as supportRouter };
