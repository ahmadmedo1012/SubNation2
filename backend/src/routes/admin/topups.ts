import { db, usersTable, walletTopupsTable } from "@workspace/db";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { intParam, queryString } from "../../lib/http";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { mapServiceErrorToCode } from "../../lib/service-error";
import { idempotency } from "../../middlewares/idempotency";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import { ServiceError, TopupService } from "../../services/topup.service";

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern —
// the admin topups queue carries sender phones / payment references;
// an intermediary must never serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// A5-03 (round-94): `?status=` feeds a pg-enum column. Drizzle passes the
// value as a bind parameter, so any string outside the enum reached
// Postgres as `invalid input value for enum "topup_status"` (22P02) →
// 500 INTERNAL_ERROR for a perfectly-formed-per-contract request. The
// filter is schema-validated up front now: bad value → 400 INVALID_DATA.
// Values mirror topupStatusEnum (shared/db/src/schema/wallet_topups.ts).
const TopupStatusFilter = z
  .enum(["pending", "approved", "rejected"])
  .optional();

// M3 — admin_note was read raw from the body: an object/array value
// reached Postgres as "[object Object]" → 500 on a money-approval
// route. One shared schema for both approve and reject.
const TopupActionBody = z
  .object({
    admin_note: z.string().trim().max(500).nullish(),
  })
  .strict();

function parseTopupActionBody(req: { body?: unknown }): string | null {
  const parse = TopupActionBody.safeParse(req.body ?? {});
  if (!parse.success) return null;
  return parse.data.admin_note ?? null;
}

router.get("/topups", requireAdmin, async (req, res) => {
  // A5-03: schema-validate the status filter BEFORE it reaches the
  // pg-enum column (see TopupStatusFilter above).
  const statusParse = TopupStatusFilter.safeParse(
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  if (!statusParse.success) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "حالة شحن غير صالحة (المسموح: pending, approved, rejected)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const conditions =
    statusParse.data !== undefined
      ? [eq(walletTopupsTable.status, statusParse.data)]
      : [];

  // A2 (round-94): ?page=&limit= — the same clamp pattern as the admin
  // orders list. Previously the route always returned the newest 100
  // rows: the money queue's oldest pending requests (beyond #100) were
  // unreachable and the badge counted ALL pending while the table showed
  // a truncated slice. Response body stays a bare array (frontend shape).
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);

  const topups = await db
    .select({
      topup: walletTopupsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
    })
    .from(walletTopupsTable)
    .leftJoin(usersTable, eq(walletTopupsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(walletTopupsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return res.json(
    topups.map((r) => ({
      id: r.topup.id,
      user_id: r.topup.userId,
      user_phone: r.userPhone ?? "",
      user_display_name: r.userDisplayName ?? null,
      user_email: r.userEmail ?? null,
      user_auth_provider: r.userAuthProvider ?? null,
      user_has_google: !!r.userGoogleId,
      user_has_telegram: !!r.userTelegramId,
      user_has_firebase: !!r.userFirebaseUid,
      user_has_whatsapp: r.userAuthProvider === "whatsapp_phone",
      amount: parseFloat(String(r.topup.amount)),
      payment_method: r.topup.paymentMethod ?? "mobile_transfer",
      payment_network: r.topup.paymentNetwork ?? null,
      sender_phone: r.topup.senderPhone ?? null,
      sender_account: r.topup.senderAccount ?? null,
      payment_reference: r.topup.paymentReference ?? null,
      status: r.topup.status,
      admin_note: r.topup.adminNote ?? null,
      // A4-04 (R116): reviewer attribution — surfaced on the card so an
      // incident review reads "who approved this" off the queue itself.
      reviewed_by: r.topup.reviewedBy ?? null,
      reviewed_at: r.topup.reviewedAt?.toISOString() ?? null,
      created_at: r.topup.createdAt?.toISOString(),
    })),
  );
});

router.post(
  "/topups/:id/approve",
  requireAdmin,
  // F-008 (security audit 004) extended in branch 006: the topup
  // approval path is one of the admin's primary money-moving actions
  // and gets the same idempotency dedup as wallet adjustment / refund.
  // The frontend admin UI sends an Idempotency-Key header per click;
  // a network retry / accidental double-click replays the cached
  // response instead of double-crediting.
  idempotency({ routeKey: "admin.topups.approve" }),
  async (req, res) => {
    const id = intParam(req, "id");
    if (id === null)
      return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

    const adminNote = parseTopupActionBody(req);
    if (adminNote === null)
      return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));

    try {
      // A4-04 (R116): the acting admin's username rides the service call —
      // TopupService persists it on the row with reviewed_at.
      const actingUsername = (req as AdminAuthenticatedRequest).adminUsername ?? null;
      const result = await TopupService.approve(id, adminNote, actingUsername);
      void writeAuditLog(req, "topup.approve", "topup", id, {
        admin_note: adminNote,
        reviewed_by: actingUsername,
      });
      return res.json(result);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res
          .status(err.statusCode)
          .json(createErrorResponse(err.message, mapServiceErrorToCode(err)));
      }
      throw err;
    }
  },
);

router.post(
  "/topups/:id/reject",
  requireAdmin,
  // F-008 — symmetrical idempotency on reject. A "rejected twice"
  // outcome is harmless to the wallet (no credit), but the audit
  // trail and admin-stats notifications would fire twice without
  // dedup, and the second attempt would fail with a 409 from the
  // status guard inside TopupService — both noise.
  idempotency({ routeKey: "admin.topups.reject" }),
  async (req, res) => {
    const id = intParam(req, "id");
    if (id === null)
      return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

    const adminNote = parseTopupActionBody(req);
    if (adminNote === null)
      return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));

    try {
      const actingUsername = (req as AdminAuthenticatedRequest).adminUsername ?? null;
      const result = await TopupService.reject(id, adminNote, actingUsername);
      void writeAuditLog(req, "topup.reject", "topup", id, {
        admin_note: adminNote,
        reviewed_by: actingUsername,
      });
      return res.json(result);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res
          .status(err.statusCode)
          .json(createErrorResponse(err.message, mapServiceErrorToCode(err)));
      }
      throw err;
    }
  },
);

export { router as adminTopupsRouter };
