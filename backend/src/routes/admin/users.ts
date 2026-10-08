import { db, ordersTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { escapeLikeTerm, intParam, pageParam, queryString } from "../../lib/http";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { idempotency } from "../../middlewares/idempotency";
import { AdjustmentError, AdjustmentService } from "../../services/adjustment.service";
import { findIdempotencyClaimed, scopeIdempotencyKey } from "../../lib/idempotency";
import { hasPermission, PERMISSION_SCOPES } from "../../lib/permissions";
import { insertPointsLedgerEntry } from "../../lib/points-ledger";

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern —
// the admin users list carries buyer PII (phone numbers, wallet
// balances, loyalty); an intermediary must never serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/users", requireAdmin, async (req, res) => {
  const { search } = req.query;

  // 93-C8 (A8 F-2): `page` was documented in the OpenAPI contract but
  // silently ignored — every request returned the identical first 100
  // rows, so a paginating consumer looped on page 1 forever. Mirrors
  // admin/orders.ts: clamp limit 1..200 (default 100), page >= 1,
  // offset-based. A request without params is byte-for-byte the old
  // behavior (page 1, limit 100), so the admin UI is unaffected.
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  // R123 (E3 item 6): shared pageParam() — the R122 MAX_PAGE ceiling
  // joins the users directory (same rationale as admin/orders.ts).
  const page = pageParam(req);

  const users =
    search && typeof search === "string"
      ? await db
          .select()
          .from(usersTable)
          // AUD103-3-F4 (r103): escape LIKE wildcards so a "%"/"_" in the
          // search box can't act as a pattern wildcard (bare "%" matched
          // every row).
          .where(like(usersTable.phone, `%${escapeLikeTerm(search)}%`))
          .orderBy(desc(usersTable.createdAt))
          .limit(limit)
          .offset((page - 1) * limit)
      : await db
          .select()
          .from(usersTable)
          .orderBy(desc(usersTable.createdAt))
          .limit(limit)
          .offset((page - 1) * limit);

  // Completed-order counts scoped to the page's user ids. The previous
  // unfiltered GROUP BY scanned the entire orders table on every dashboard
  // load just to display counts for ≤100 users.
  const orderCounts = await db
    .select({ userId: ordersTable.userId, count: count() })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "completed"),
        inArray(
          ordersTable.userId,
          users.map((u) => u.id),
        ),
      ),
    )
    .groupBy(ordersTable.userId);
  const orderMap = new Map(orderCounts.map((r) => [r.userId, Number(r.count)]));

  return res.json(
    users.map((u) => ({
      id: u.id,
      phone: u.phone,
      // Display name (from Firebase / Telegram / Google) for admin
      // search + visual identification when phone is a placeholder
      // (e.g. tg_<id> for Telegram-first accounts).
      display_name: u.displayName ?? null,
      email: u.email ?? null,
      photo_url: u.photoUrl ?? null,
      // Self-reported auth provider — values: "firebase_phone" |
      // "firebase_google" | "firebase" | "telegram" | "legacy_password"
      auth_provider: u.authProvider ?? "legacy_password",
      // Boolean flags — let the frontend render Provider badges
      // without parsing auth_provider strings.
      has_google: !!u.googleId,
      has_telegram: !!u.telegramId,
      has_firebase: !!u.firebaseUid,
      // Derived from the stored authProvider tag — there's no
      // dedicated column for WhatsApp identity (the phone field
      // itself is the identity, since WhatsApp users have a real
      // 9-digit Libyan local form rather than a placeholder).
      has_whatsapp: u.authProvider === "whatsapp_phone",
      last_auth_at: u.lastAuthAt?.toISOString() ?? null,
      wallet_balance: parseFloat(String(u.walletBalance)),
      loyalty_points: u.loyaltyPoints,
      loyalty_tier: u.loyaltyTier,
      lifetime_spend: parseFloat(String(u.lifetimeSpend)),
      order_count: orderMap.get(u.id) ?? 0,
      referral_code: u.referralCode ?? null,
      created_at: u.createdAt?.toISOString(),
    })),
  );
});

/**
 * Admin user-edit endpoint.
 *
 * S-01 (security audit 004) — Findings F-004 + F-008 closure.
 *
 *   - Wallet mutations (`wallet_adjustment`, `wallet_balance`) route
 *     through `AdjustmentService`, which wraps each change in a
 *     transaction with optimistic-lock concurrency safety AND writes a
 *     `wallet_ledger` row of type=`adjustment`. Constitution Principle I
 *     compliance — every monetary change is reconstructable from the
 *     ledger.
 *   - The whole route is mounted behind the idempotency middleware so a
 *     network retry / admin double-click does NOT double-credit
 *     (closes F-008). The `Idempotency-Key` header is currently
 *     advisory; absence logs a warning, the call proceeds. Will be
 *     tightened to required after the admin UI ships the header.
 *   - Loyalty fields (`loyalty_points`, `loyalty_tier`) keep their
 *     legacy direct-update path — they are not financial integrity
 *     concerns and have no ledger — BUT the points write is now a
 *     guarded (optimistic-lock) UPDATE (93-A1 S6 / 93-A2, round-93):
 *     see the M5/S6 block inside the handler.
 */
router.patch(
  "/users/:id",
  requireAdmin,
  idempotency({ routeKey: "admin.users.patch" }),
  async (req, res) => {
    const id = intParam(req, "id");
    if (id === null)
      return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

    const adminId = (req as { adminId?: number }).adminId;
    if (typeof adminId !== "number") {
      // requireAdmin guarantees this is set; defensive only.
      return res
        .status(401)
        .json(createErrorResponse("جلسة المسؤول مطلوبة", ErrorCode.UNAUTHORIZED));
    }

    const { wallet_balance, wallet_adjustment, loyalty_points, loyalty_tier, note } =
      req.body ?? {};

    // ── Loyalty path — R115: attributed, transactional, finance-gated ──
    //
    // History: an absolute `SET loyalty_points = X` (93-A1 S6 added the
    // CAS), then still a bare autocommit UPDATE with no durable record —
    // audit rows logged the field NAME only, and a wallet-branch failure
    // after it left the mutation unattributed (R115-A1 P1). Now:
    //   - the mutation + its points_ledger admin_set row commit in ONE tx
    //   - the audit row carries before/after VALUES (not just the field)
    //   - a reason (note) is mandatory — same rule as wallet edits
    //   - the `finance` scope is required — points are LYD-convertible
    //     money (100:1), the same B1-3 rationale as the wallet branch
    //   - loyalty_tier is NO LONGER EDITABLE: tiers derive strictly from
    //     net qualifying spend (R115 Part 11) — checkout/refund write
    //     computeTier(lifetimeSpend) and would silently clobber any
    //     manual value, the exact "unexplained tier/spend mismatch" the
    //     final policy forbids.

    if (loyalty_tier !== undefined) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "مستوى الولاء مشتق تلقائياً من الإنفاق الصافي ولا يُعدّل يدوياً — عدّل الإنفاق أو راجع سياسة المستويات",
            ErrorCode.INVALID_DATA,
          ),
        );
    }

    // M5 — loyalty_points was bounded only by `>= 0`: a compromised or
    // fat-fingered admin could set 1e15 points, which the user then
    // converts into 1e13 LYD of wallet credit via /loyalty/convert-points.
    // Cap at 10M points (= 100k LYD at the 100 pts/LYD rate) — still
    // orders of magnitude above any legitimate balance, but no longer
    // a nation-state money-printer. Ints only: fractional points would
    // corrupt the convert-points math.
    const MAX_ADMIN_SET_LOYALTY_POINTS = 10_000_000;
    let loyaltyApplied: { before: number; after: number } | null = null;
    if (loyalty_points !== undefined) {
      if (!(
        typeof loyalty_points === "number" &&
        Number.isInteger(loyalty_points) &&
        loyalty_points >= 0 &&
        loyalty_points <= MAX_ADMIN_SET_LOYALTY_POINTS
      )) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "نقاط الولاء يجب أن تكون عدداً صحيحاً بين 0 و 10,000,000",
              ErrorCode.INVALID_DATA,
            ),
          );
      }
      // R115: points are convertible money — same finance gate as the
      // wallet branch below (a users-scoped admin could previously mint
      // them; R115-A1 P2).
      const actingPermsLoyalty = (req as AdminAuthenticatedRequest).adminPermissions ?? [];
      if (!hasPermission(actingPermsLoyalty, PERMISSION_SCOPES.FINANCE)) {
        return res
          .status(403)
          .json(
            createErrorResponse(
              "تعديل نقاط الولاء يتطلب صلاحية «المعاملات المالية» (finance)",
              ErrorCode.FORBIDDEN,
            ),
          );
      }
      // R115: mandatory reason — the audit trail must explain WHY the
      // balance changed (wallet-branch parity, A8-09).
      if (typeof note !== "string" || note.trim().length < 3) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "سبب التعديل (note) مطلوب لتعديل نقاط الولاء — 3 أحرف على الأقل",
              ErrorCode.INVALID_DATA,
            ),
          );
      }

      const [currentRow] = await db
        .select({ loyaltyPoints: usersTable.loyaltyPoints })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      if (!currentRow) {
        return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
      }

      const before = currentRow.loyaltyPoints;
      const delta = loyalty_points - before;
      if (delta !== 0) {
        try {
          await db.transaction(async (tx) => {
            // S6/93-A2 CAS discipline preserved: guard on the pre-read
            // value so a concurrent award/refund forces a 409 retry
            // instead of being silently erased.
            const flipped = await tx
              .update(usersTable)
              .set({ loyaltyPoints: loyalty_points })
              .where(and(eq(usersTable.id, id), eq(usersTable.loyaltyPoints, before)))
              .returning({ id: usersTable.id });
            if (flipped.length === 0) {
              throw new Error("LOYALTY_CONCURRENT_MODIFICATION");
            }
            // R115 (Part 8): the durable record — same tx as the mutation.
            await insertPointsLedgerEntry(
              {
                userId: id,
                type: "admin_set",
                pointsDelta: delta,
                pointsBefore: before,
                pointsAfter: loyalty_points,
                actorAdminId: adminId,
                reason: note.trim().slice(0, 500),
              },
              tx as unknown as typeof db,
            );
          });
          loyaltyApplied = { before, after: loyalty_points };
        } catch (err) {
          if (err instanceof Error && err.message === "LOYALTY_CONCURRENT_MODIFICATION") {
            return res
              .status(409)
              .json(
                createErrorResponse(
                  "نقاط الولاء تغيّرت أثناء التعديل (عملية متزامنة) — حدّث الصفحة وأعد المحاولة",
                  ErrorCode.CONFLICT,
                  { reason: "loyalty_concurrent_modification" },
                ),
              );
          }
          throw err;
        }
      }
    }

    // ── Wallet path: AdjustmentService (atomic, ledger-backed) ────────
    let walletResult: { walletBalance: number } | null = null;
    if (typeof wallet_adjustment === "number" || typeof wallet_balance === "number") {
      // B1-3 (R111, round-111 B1 audit): the router mount gates this route
      // on the `users` scope, but a wallet mutation is a MONEY write —
      // setting an arbitrary wallet_balance prints balances (up to the
      // 99,999,999.99 LYD service cap) and wallet_adjustment moves LYD 1:1.
      // Those need the `finance` scope exactly like every other money
      // surface (topup approve/reject are requirePermission("finance") at
      // the parent mount). Verified safe against the live DB before
      // shipping: every live admin (sole active: ahmadmedo) holds ["all"],
      // so no existing principal loses access; only FUTURE scoped admins
      // are bound to the tighter rule (users + finance for wallet edits,
      // the same combo the users page needs for loyalty edits + finance
      // viewing anyway). 403 (not 401): the caller IS authenticated, just
      // under-scoped — requirePermission's envelope.
      const actingPerms = (req as AdminAuthenticatedRequest).adminPermissions ?? [];
      if (!hasPermission(actingPerms, PERMISSION_SCOPES.FINANCE)) {
        return res
          .status(403)
          .json(
            createErrorResponse(
              "تعديل رصيد المحفظة يتطلب صلاحية «المعاملات المالية» (finance)",
              ErrorCode.FORBIDDEN,
            ),
          );
      }
      // A8-09 (round-94): a wallet mutation with no operator note means
      // the audit trail (F-004) records "Admin adjustment" — useless in
      // an incident review, and the ONLY control on self-dealing via a
      // personal storefront account was that after-the-fact trail. A
      // mandatory human note gives the trail content and adds friction
      // against casual self-dealing. (AdjustmentService still enforces
      // the signed-ledger + caps + compare-and-set invariants.)
      if (typeof note !== "string" || note.trim().length < 3) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "سبب التعديل (note) مطلوب لكل تعديل على المحفظة — 3 أحرف على الأقل",
              ErrorCode.INVALID_DATA,
            ),
          );
      }
      try {
        // R108 (FH-A7 P1): durable pre-check — the key is admin-scoped
        // (u{adminId}:…) so it can never collide with a user-scoped key.
        // A same-key retry after a lost response short-circuits to 409
        // here; the in-tx claim (adjustment.service) closes the race
        // window between this check and the commit.
        const scopedAdjKey = scopeIdempotencyKey(adminId, req.header("Idempotency-Key"));
        if (scopedAdjKey && (await findIdempotencyClaimed(scopedAdjKey))) {
          return res
            .status(409)
            .json(
              createErrorResponse(
                "تم تطبيق هذا التعديل مسبقاً بنفس مفتاح الحفظ",
                ErrorCode.CONFLICT,
              ),
            );
        }
        if (typeof wallet_adjustment === "number") {
          walletResult = await AdjustmentService.adjust(id, wallet_adjustment, {
            adminId,
            note: note.trim().slice(0, 500),
            idempotencyKey: scopedAdjKey,
          });
        } else if (typeof wallet_balance === "number") {
          walletResult = await AdjustmentService.setBalance(id, wallet_balance, {
            adminId,
            note: note.trim().slice(0, 500),
            idempotencyKey: scopedAdjKey,
          });
        }
      } catch (err) {
        if (err instanceof AdjustmentError) {
          return res
            .status(err.statusCode)
            .json(createErrorResponse(err.message, mapAdjustmentErrorToCode(err.code)));
        }
        throw err;
      }
    }

    if (!walletResult && !loyaltyApplied) {
      return res.status(400).json(createErrorResponse("لا توجد تعديلات", ErrorCode.INVALID_DATA));
    }

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!updated) {
      // The wallet path would have caught this earlier; reachable only
      // if the row was deleted between the AdjustmentService commit and
      // this read.
      return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
    }

    void writeAuditLog(req, "user.update", "user", id, {
      fields_changed: [
        ...(walletResult ? ["walletBalance"] : []),
        ...(loyaltyApplied ? ["loyaltyPoints"] : []),
      ],
      // F-004 — record the actual values on the audit row so the trail
      // is reconstructable without joining the ledgers. R115: the loyalty
      // values ride here too (previously only the field NAME was logged —
      // R115-A1 P1); the authoritative record is the same-tx points_ledger
      // admin_set row, this is the secondary operator-facing trail.
      ...(walletResult ? { wallet_balance_after: walletResult.walletBalance } : {}),
      ...(loyaltyApplied
        ? {
            loyalty_points_before: loyaltyApplied.before,
            loyalty_points_after: loyaltyApplied.after,
          }
        : {}),
    });

    return res.json({
      id: updated.id,
      phone: updated.phone,
      wallet_balance: parseFloat(String(updated.walletBalance)),
      loyalty_points: updated.loyaltyPoints,
      loyalty_tier: updated.loyaltyTier,
    });
  },
);

function mapAdjustmentErrorToCode(code: string): ErrorCode {
  switch (code) {
    case "USER_NOT_FOUND":
      return ErrorCode.NOT_FOUND;
    case "NEGATIVE_BALANCE":
    case "ZERO_DELTA":
      // 400-class service rejections (the AdjustmentService already
      // answers these with status 400) — the body code matches.
      return ErrorCode.INVALID_DATA;
    case "CONCURRENCY_ERROR":
      // 93-C8 (A8 F-7): ErrorCode.CONFLICT exists and is what every
      // sibling 409 mapper returns — the frontend keys the retry hint
      // off the body code (errors.ts: CONFLICT → "أعد المحاولة"), so
      // the optimistic-lock race must not arrive labeled INVALID_DATA
      // ("بيانات غير صالحة") telling the admin their input was wrong.
      return ErrorCode.CONFLICT;
    case "INVALID_AMOUNT":
      // H6 — 1e999/NaN adjustment rejected at the service boundary.
      return ErrorCode.INVALID_AMOUNT;
    default:
      return ErrorCode.INVALID_DATA;
  }
}

export { router as adminUsersRouter };
