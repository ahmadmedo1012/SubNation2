import { Router } from "express";
import { db, usersTable, referralEventsTable, pointsLedgerTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { pageParam } from "../lib/http";
import { idempotency } from "../middlewares/idempotency";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { insertLedgerEntry } from "../lib/ledger";
// G-6 (R142): formatLyd — the R128 B8-D3 en-US grouping canon (M17);
// the convert success message was the one LYD display still on raw
// toFixed(2) («1500.00 د.ل» instead of «1,500.00 د.ل»).
import { formatLyd, roundLyd } from "../lib/money";
import {
  claimIdempotencyKey,
  findIdempotencyClaimed,
  isIdempotencyKeyViolation,
  scopeIdempotencyKey,
} from "../lib/idempotency";
// R134 (A7-F4): the shared body-hash definition. R158 (B-F2): the
// durable-reuse 409 envelope comes from the ONE factory — byte-identical
// to the previous literals.
import { canonicalBodyHash, idempotencyReuseBody } from "../lib/idempotency-body-hash";
import {
  POINTS_PER_LYD,
  POINTS_PER_REFERRAL,
  TIER_THRESHOLDS,
  isConvertibleBundle,
  nextTier,
} from "../lib/loyalty-policy";
import { insertPointsLedgerEntry } from "../lib/points-ledger";

/** Internal control-flow error for transactional conflicts. */
class ConflictError extends Error {}

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern
// (orders.ts / wallet.ts / cart.ts / notifications.ts) — loyalty
// balances, tiers and referral rows are per-user money state; an
// intermediary must never serve them from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Single source of truth lives in lib/loyalty-policy (R115: tiers +
// earn/redeem/referral/welcome policy + formulas — including nextTier,
// used by the GET below).
void 0;

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // PERF #7 (R136): the user read and the referral aggregate were two
  // SERIAL round trips; both are keyed on userId with no dependency
  // between them, so they now share one Promise.all wave (the
  // routes/wallet.ts:78 / routes/auth.ts:368 fold idiom). B6-03 (R116)
  // hygiene, routes/wallet.ts:124-131 precedent: the user read projects
  // ONLY the columns the response renders — a bare select() pulled every
  // users column over the wire for nothing. The 401 check keeps its
  // position (the counts were merely computed concurrently, discarded on
  // the missing-user path — the response is byte-identical).
  const [[user], [referralCounts]] = await Promise.all([
    db
      .select({
        loyaltyPoints: usersTable.loyaltyPoints,
        loyaltyTier: usersTable.loyaltyTier,
        lifetimeSpend: usersTable.lifetimeSpend,
        referralCode: usersTable.referralCode,
        referredBy: usersTable.referredBy,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        credited: sql<number>`(count(*) filter (where ${referralEventsTable.status} = 'credited'))::int`,
        pending: sql<number>`(count(*) filter (where ${referralEventsTable.status} = 'pending'))::int`,
      })
      .from(referralEventsTable)
      .where(eq(referralEventsTable.referrerId, userId)),
  ]);
  if (!user)
    // AUD103-4-F2 (r103): one failure class, one shape — 401
    // ACCOUNT_NOT_FOUND like /api/auth/me and /api/wallet (was 404
    // NOT_FOUND, a misleading shape for a session-bearing request).
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  // R122 (A3-P2-1): the totals were computed over a `.limit(200)` page — a
  // heavy referrer saw referrals_total=200 forever and referrals_credited /
  // referrals_pending were clamped to the newest 200 rows. One exact
  // aggregate (COUNT + FILTER per status) replaces the capped row fetch;
  // the numbers are now true for any history size.
  const referralsTotal = referralCounts?.total ?? 0;
  const creditedCount = referralCounts?.credited ?? 0;
  const pendingCount = referralCounts?.pending ?? 0;

  const nextTierInfo = nextTier(parseFloat(String(user.lifetimeSpend)));

  return res.json({
    points: user.loyaltyPoints,
    tier: user.loyaltyTier,
    lifetime_spend: parseFloat(String(user.lifetimeSpend)),
    referral_code: user.referralCode ?? "",
    referral_link: `${process.env.APP_URL ?? ""}/register?ref=${user.referralCode ?? ""}`,
    referred_by: user.referredBy,
    referrals_total: referralsTotal,
    referrals_credited: creditedCount,
    referrals_pending: pendingCount,
    points_value_lyd: (user.loyaltyPoints / POINTS_PER_LYD).toFixed(2),
    next_tier: nextTierInfo,
    tier_thresholds: TIER_THRESHOLDS,
    points_rate: { points_per_referral: POINTS_PER_REFERRAL, points_per_lyd: POINTS_PER_LYD },
  });
});

router.post(
  "/convert-points",
  requireUser,
  // 99-M4 (R99-A2 P2 — money): points are convertible currency
  // (100 pts = 1 LYD via the wallet ledger) — the LAST client-money write
  // with no idempotency layer. A lost HTTP response after the DB commit
  // followed by a manual retry executed a SECOND conversion (the in-tx
  // balance check cannot see a committed-but-unresponded conversion on a
  // NEW request). The middleware replays the cached response for a
  // same-key retry; the frontend (99-M4) now sends a stable per-intent
  // key. Key-absent requests still pass through (phase-1 tolerant).
  idempotency({ routeKey: "loyalty.convert" }),
  async (req, res) => {
    const { userId } = req as AuthenticatedRequest;

    // r4 money-integrity: strict input validation for a money-adjacent
    // write. The old `parseInt(points)` laundered hostile shapes into
    // valid numbers — ["100"] (array) → 100, "0x64" (hex) → 100,
    // "1e2" → 1, 100.9 → 100 (silent truncation). Not directly
    // over-spendable (the in-tx balance check held), but the request
    // contract must be exact: a finite number OR a decimal string of
    // an integer, nothing else.
    const { points } = req.body ?? {};
    let pointsToConvert: number;
    if (typeof points === "number") {
      if (!Number.isInteger(points)) {
        return res
          .status(400)
          .json(createErrorResponse("عدد النقاط يجب أن يكون عدداً صحيحاً", ErrorCode.INVALID_DATA));
      }
      pointsToConvert = points;
    } else if (typeof points === "string" && /^\d{1,9}$/.test(points.trim())) {
      pointsToConvert = Number(points.trim());
    } else {
      return res
        .status(400)
        .json(createErrorResponse("عدد النقاط غير صالح", ErrorCode.INVALID_DATA));
    }

    if (!pointsToConvert || pointsToConvert < POINTS_PER_LYD) {
      return res
        .status(400)
        .json(
          createErrorResponse(`الحد الأدنى للتحويل ${POINTS_PER_LYD} نقطة`, ErrorCode.INVALID_DATA),
        );
    }
    // R166-B2: the bundle rule comes from loyalty-policy's single source
    // now — `isConvertibleBundle` ≡ `points >= POINTS_PER_LYD && points %
    // POINTS_PER_LYD === 0`, and the threshold conjunct is already proven
    // true by the check above (kept separate ONLY so a low balance gets
    // the friendlier minimum message above), so here its failure is
    // exactly the old `pointsToConvert % POINTS_PER_LYD !== 0`.
    if (!isConvertibleBundle(pointsToConvert)) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            `يجب أن تكون النقاط من مضاعفات ${POINTS_PER_LYD}`,
            ErrorCode.INVALID_DATA,
          ),
        );
    }

    // B4-F5 (R128): roundLyd, not +toFixed(2) — points/100 is 2dp-exact
    // today, but the roundLyd idiom keeps the boundary hazard-proof
    // (lib/money.ts).
    const lydValue = roundLyd(pointsToConvert / POINTS_PER_LYD);

    // R102 (durable guard, R102-A F3): the middleware above is Redis-only
    // (pass-through during a Redis outage) — a lost response + retry
    // during that window double-converted points. The durable table
    // backstop (same as checkout's F10) closes it: pre-tx existence
    // check for the friendly 409, in-tx claim for the concurrent race.
    const scopedKey = scopeIdempotencyKey(userId, req.header("idempotency-key"));
    // R134 (A7-F4): the durable reuse predicate — hashed at the route
    // layer off req.body, the SAME definition the Redis layer uses.
    const idemBodyHash = canonicalBodyHash(req.body);
    if (scopedKey) {
      const claimedRow = await findIdempotencyClaimed(scopedKey);
      if (claimedRow !== null) {
        // Same key + DIFFERENT body: the classified reuse 409 (the
        // Redis layer's envelope verbatim) — distinct from the
        // already-converted 409 below by code + message. NULL hash = a
        // legacy claim (pre-R134 writer) → the friendly already-converted
        // answer (the ≤48h transition window).
        if (claimedRow.bodyHash !== null && claimedRow.bodyHash !== idemBodyHash) {
          // R158 (B-F2): the shared factory envelope — byte-identical to
          // the previous literals.
          return res.status(409).json(idempotencyReuseBody());
        }
        return res
          .status(409)
          .json(
            createErrorResponse(
              "تم تنفيذ هذا التحويل مسبقاً بنفس المفتاح — تحقق من رصيدك",
              ErrorCode.CONFLICT,
            ),
          );
      }
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Fresh read INSIDE the tx — the pre-transaction state may be stale
        // under concurrency (this route previously did a bare read-modify-
        // write: two concurrent converts double-spent points, and an
        // interleaved topup approval could be silently erased because the
        // whole row was overwritten from stale values).
        const [user] = await tx
          .select({
            loyaltyPoints: usersTable.loyaltyPoints,
            walletBalance: usersTable.walletBalance,
          })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (!user) throw new ConflictError("المستخدم غير موجود");

        if (user.loyaltyPoints < pointsToConvert) {
          return { ok: false as const, status: 400, error: "رصيد النقاط غير كافٍ" };
        }

        const newPoints = user.loyaltyPoints - pointsToConvert;
        const balanceBefore = parseFloat(String(user.walletBalance));
        // R130 (A7-F3): the R128-B4 F5 conversion reached lydValue below
        // but missed the balance WRITE — the boundary idiom completes.
        const newBalance = roundLyd(balanceBefore + lydValue);

        // Optimistic lock on BOTH mutated columns: a concurrent wallet or
        // loyalty write between our SELECT and UPDATE makes this match 0
        // rows → rollback → client retries with fresh state.
        const updated = await tx
          .update(usersTable)
          .set({ loyaltyPoints: newPoints, walletBalance: String(newBalance) })
          .where(
            and(
              eq(usersTable.id, userId),
              eq(usersTable.loyaltyPoints, user.loyaltyPoints),
              eq(usersTable.walletBalance, String(balanceBefore)),
            ),
          )
          .returning({ id: usersTable.id });
        if (updated.length !== 1)
          throw new ConflictError("تغيّرت النقاط أو الرصيد أثناء التحويل، حاول مجدداً");

        // Ledger parity with every other balance mutation (Constitution §I):
        // without this row the credit is unreconstructable from wallet_ledger.
        // R115: the returned id links the points_ledger conversion_out row to
        // the wallet credit it produced (rate pinned in-row via lyd_credited).
        const walletLedgerRowId = await insertLedgerEntry(
          {
            userId,
            type: "adjustment",
            amount: String(lydValue),
            balanceBefore: String(balanceBefore),
            balanceAfter: String(newBalance),
            referenceType: "loyalty_conversion",
            description: `تحويل ${pointsToConvert} نقطة ولاء إلى رصيد`,
          },
          tx as unknown as typeof db,
        );

        // R115 (Part 8): attribute the points side of the conversion.
        await insertPointsLedgerEntry(
          {
            userId,
            type: "conversion_out",
            pointsDelta: -pointsToConvert,
            pointsBefore: user.loyaltyPoints,
            pointsAfter: newPoints,
            lydCredited: lydValue,
            referenceId: walletLedgerRowId || undefined,
            referenceType: "wallet_ledger",
          },
          tx as unknown as typeof db,
        );

        // R102: durable claim, committed atomically with the conversion.
        // Concurrent same-key winner → 23505 → the catch maps to a 409
        // (the user's balance already reflects the first conversion).
        if (scopedKey) {
          try {
            await claimIdempotencyKey(
              tx as unknown as typeof db,
              scopedKey,
              null,
              "loyalty.convert",
              idemBodyHash, // R134 (A7-F4)
            );
          } catch (claimErr) {
            if (isIdempotencyKeyViolation(claimErr))
              throw new ConflictError("تم تنفيذ هذا التحويل مسبقاً بنفس المفتاح — تحقق من رصيدك");
            throw claimErr;
          }
        }

        return { ok: true as const, newPoints, newBalance };
      });

      if (!result.ok) {
        return res
          .status(result.status)
          .json(createErrorResponse(result.error, ErrorCode.INVALID_DATA));
      }

      return res.json({
        success: true,
        points_spent: pointsToConvert,
        lyd_credited: lydValue,
        new_points: result.newPoints,
        new_balance: result.newBalance,
        message: `تم تحويل ${pointsToConvert} نقطة إلى ${formatLyd(lydValue)}`,
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        return res.status(409).json(createErrorResponse(err.message, ErrorCode.CONFLICT));
      }
      throw err;
    }
  },
);

// R115 (Part 8): the user-facing POINTS HISTORY — every point movement
// attributed (purchase awards, referral credits, conversions out, refund
// reversals, admin corrections), newest first. The balance is finally
// explainable in the UI: "why do I have exactly 750 points?" is a list.
const POINTS_TYPE_LABELS: Record<string, string> = {
  purchase_award: "نقاط شراء",
  refund_reversal: "استرداد نقاط",
  referral_credit: "نقاط إحالة",
  conversion_out: "تحويل إلى رصيد",
  admin_set: "تسوية إدارية",
  correction: "تسوية",
};

router.get("/ledger", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;
  // R120-B6/A6-F1: additive ?page= (admin/orders.ts clamp idiom,
  // offset=(page-1)*limit) — rows 201+ were unreachable before. Default
  // page=1 → offset 0 → byte-identical response. (limitParam from
  // lib/http.ts is intentionally NOT adopted here: its parseInt idiom
  // accepts "12.9"/"1e2" where this route's stricter Number.isInteger
  // idiom falls back to 100 — adoption would drift behavior (A6-F14).)
  const offset = (pageParam(req) - 1) * limit;

  const entries = await db
    .select()
    .from(pointsLedgerTable)
    .where(eq(pointsLedgerTable.userId, userId))
    .orderBy(desc(pointsLedgerTable.createdAt), desc(pointsLedgerTable.id))
    .limit(limit)
    .offset(offset);

  return res.json(
    entries.map((e) => ({
      id: e.id,
      type: e.type,
      type_label: POINTS_TYPE_LABELS[e.type] ?? e.type,
      points_delta: e.pointsDelta,
      points_after: e.pointsAfter,
      lyd_credited: e.lydCredited != null ? parseFloat(String(e.lydCredited)) : null,
      created_at: e.createdAt.toISOString(),
    })),
  );
});

router.get("/referrals", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // R122 (A3-P2-1): the list was hard-capped at the first 200 rows with no
  // way to reach older referrals (the same gap the R120 A6-F1 fix closed
  // for orders / wallet topups / the ledgers). Additive ?page= (the R120
  // idiom, offset=(page-1)*200; pageParam clamps garbage/0/negative → 1
  // and, since R122, caps absurd deep pages at 10 000) — default page=1 →
  // offset 0 → byte-identical response for every existing caller.
  const offset = (pageParam(req) - 1) * 200;

  const events = await db
    .select({
      id: referralEventsTable.id,
      status: referralEventsTable.status,
      createdAt: referralEventsTable.createdAt,
      creditedAt: referralEventsTable.creditedAt,
      phone: usersTable.phone,
    })
    .from(referralEventsTable)
    .innerJoin(usersTable, eq(usersTable.id, referralEventsTable.refereeId))
    .where(eq(referralEventsTable.referrerId, userId))
    .orderBy(desc(referralEventsTable.createdAt))
    .limit(200)
    .offset(offset);

  const maskPhone = (p: string) => (p.length >= 7 ? p.slice(0, 3) + "****" + p.slice(-3) : p);

  return res.json(
    events.map((e) => ({
      id: e.id,
      status: e.status,
      phone_masked: maskPhone(e.phone),
      created_at: e.createdAt.toISOString(),
      credited_at: e.creditedAt?.toISOString() ?? null,
      points_earned: e.status === "credited" ? POINTS_PER_REFERRAL : 0,
    })),
  );
});

export { router as loyaltyRouter };
