import { db, pointsLedgerTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * points_ledger insert + attribution queries (R115, Part 8).
 *
 * Mirrors lib/ledger.ts (wallet): pass a transaction so the row commits
 * atomically with the users.loyalty_points mutation it explains. Errors
 * propagate — the ledger is the source of truth and MUST not silently
 * fail. The DB enforces (V1-M21): arithmetic (after = before + delta),
 * non-negativity, non-zero deltas, reason-for-manual-types, and the
 * structural exactly-once partial UNIQUE (type, reference_id).
 */
type DbOrTx = typeof db;

export type PointsLedgerType =
  | "purchase_award"
  | "refund_reversal"
  | "referral_credit"
  | "conversion_out"
  | "admin_set"
  | "correction";

export interface PointsLedgerParams {
  userId: number;
  type: PointsLedgerType;
  pointsDelta: number;
  pointsBefore: number;
  pointsAfter: number;
  /** conversion_out only — the LYD credit this conversion yielded. */
  lydCredited?: number;
  referenceId?: number;
  referenceType?: string;
  /** admin_set only — who did it. */
  actorAdminId?: number;
  /** admin_set / correction only (DB-required). */
  reason?: string;
}

export async function insertPointsLedgerEntry(
  params: PointsLedgerParams,
  client: DbOrTx = db,
): Promise<void> {
  try {
    await client.insert(pointsLedgerTable).values({
      userId: params.userId,
      type: params.type,
      pointsDelta: params.pointsDelta,
      pointsBefore: params.pointsBefore,
      pointsAfter: params.pointsAfter,
      lydCredited: params.lydCredited != null ? String(params.lydCredited) : null,
      referenceId: params.referenceId ?? null,
      referenceType: params.referenceType ?? null,
      actorAdminId: params.actorAdminId ?? null,
      reason: params.reason ?? null,
    });
  } catch (err) {
    logger.error(
      { err, params: { ...params, reason: params.reason?.slice(0, 80) } },
      "Failed to insert points_ledger entry",
    );
    throw err;
  }
}

/**
 * The order's purchase award as recorded at checkout (points), or null when
 * the order predates the ledger (V1-M21). Callers fall back to the frozen
 * historical formula floor(orders.amount) for pre-ledger orders — derivable
 * from the order row itself, so the reversal stays exact either way.
 */
export async function findPurchaseAward(
  orderId: number,
  client: DbOrTx = db,
): Promise<{ id: number; pointsDelta: number } | null> {
  const rows = await client
    .select({ id: pointsLedgerTable.id, pointsDelta: pointsLedgerTable.pointsDelta })
    .from(pointsLedgerTable)
    .where(
      and(
        eq(pointsLedgerTable.type, "purchase_award"),
        eq(pointsLedgerTable.referenceType, "order"),
        eq(pointsLedgerTable.referenceId, orderId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Points already revoked from a specific order by a prior refund reversal
 * (0 when none). Under the (type, reference_id) unique constraint there can
 * be at most one reversal row per order — this read is exact, and its
 * result also feeds the CAS predicate so a concurrent reversal cannot
 * double-revoke.
 */
export async function findRefundReversal(
  orderId: number,
  client: DbOrTx = db,
): Promise<{ id: number; pointsDelta: number } | null> {
  const rows = await client
    .select({ id: pointsLedgerTable.id, pointsDelta: pointsLedgerTable.pointsDelta })
    .from(pointsLedgerTable)
    .where(
      and(
        eq(pointsLedgerTable.type, "refund_reversal"),
        eq(pointsLedgerTable.referenceType, "order"),
        eq(pointsLedgerTable.referenceId, orderId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * R115 Part 9 — per-source FIFO attribution of a user's point balance.
 *
 * Points are fungible in the balance, but the ledger remembers their
 * sources. Replaying the user's ledger in (created_at, id) order models
 * conversions as FIFO spend (oldest points leave first — the
 * business-friendly default: a recent purchase award survives if older
 * points were available to convert), which answers precisely:
 * "how many of THIS order's award points are still in the pool?"
 *
 * Reliability rule: admin_set / correction rows rebalance the pool
 * without source attribution — if any such row exists AFTER the order's
 * award, per-source attribution is no longer provable and the caller
 * falls back to the bounded cap semantics (revoke at most the award
 * remainder). Returns { precise: false, remaining: awarded - alreadyRevoked }
 * in that case.
 */
export async function remainingAwardForOrder(
  userId: number,
  orderId: number,
  client: DbOrTx = db,
): Promise<{ precise: boolean; remaining: number }> {
  const rows = await client
    .select({
      id: pointsLedgerTable.id,
      type: pointsLedgerTable.type,
      pointsDelta: pointsLedgerTable.pointsDelta,
      referenceId: pointsLedgerTable.referenceId,
      referenceType: pointsLedgerTable.referenceType,
    })
    .from(pointsLedgerTable)
    .where(eq(pointsLedgerTable.userId, userId))
    .orderBy(asc(pointsLedgerTable.createdAt), asc(pointsLedgerTable.id));

  let sawAward = false;
  let attributionBroken = false;
  let awarded = 0;
  let alreadyRevoked = 0;
  // FIFO queue of [sourceKey, amount] — oldest first.
  const queue: Array<[string, number]> = [];
  const awardKey = `order:${orderId}`;

  for (const row of rows) {
    const sourceKey =
      row.referenceType && row.referenceId != null
        ? `${row.referenceType}:${row.referenceId}`
        : `raw:${row.id}`;

    if (row.type === "purchase_award" || row.type === "referral_credit") {
      if (
        row.type === "purchase_award" &&
        row.referenceType === "order" &&
        row.referenceId === orderId
      ) {
        sawAward = true;
        awarded = row.pointsDelta;
        queue.push([awardKey, row.pointsDelta]);
      } else {
        queue.push([sourceKey, row.pointsDelta]);
      }
    } else if (row.type === "conversion_out") {
      // FIFO: consume from the front.
      let toSpend = -row.pointsDelta;
      while (toSpend > 0 && queue.length > 0) {
        const head = queue[0];
        const take = Math.min(head[1], toSpend);
        head[1] -= take;
        toSpend -= take;
        if (head[1] === 0) queue.shift();
      }
    } else if (row.type === "refund_reversal") {
      if (row.referenceType === "order" && row.referenceId === orderId) {
        alreadyRevoked += -row.pointsDelta;
      } else {
        // Another order's reversal — consume from ITS source...
        const key = `order:${row.referenceId}`;
        let consumed = false;
        for (const entry of queue) {
          if (entry[0] === key) {
            entry[1] = Math.max(0, entry[1] + row.pointsDelta);
            consumed = true;
          }
        }
        // ...unless that order PREDATES the ledger (no award entry — the
        // legacy floor(amount) revoke drew from the oldest pool). R115-R1
        // P3 fix: consume from the FRONT (FIFO, like a conversion) so the
        // debit is not silently dropped — otherwise interleaved conversions
        // leave later orders' remainders overstated and "precise" mode
        // over-revokes.
        if (!consumed) {
          let toSpend = -row.pointsDelta;
          while (toSpend > 0 && queue.length > 0) {
            const head = queue[0];
            const take = Math.min(head[1], toSpend);
            head[1] -= take;
            toSpend -= take;
            if (head[1] === 0) queue.shift();
          }
        }
      }
    } else if (row.type === "correction" && row.pointsDelta > 0) {
      // Opening-balance corrections are append-style inflows — opaque but
      // REAL points older than any post-migration award, so FIFO conversions
      // must consume them before newer awards. Attribution stays precise.
      queue.push([sourceKey, row.pointsDelta]);
    } else {
      // admin_set (absolute rebalance) or a negative correction — the pool
      // was rewritten beyond source attribution. Fall back to bounded-cap
      // semantics for this order.
      attributionBroken = true;
    }
  }

  if (!sawAward) {
    // Pre-ledger order — no per-order attribution exists. The caller uses
    // the legacy frozen formula (floor(orders.amount)).
    return { precise: false, remaining: 0 };
  }
  if (attributionBroken) {
    return { precise: false, remaining: Math.max(0, awarded - alreadyRevoked) };
  }
  const remainingInQueue = queue.find(([k]) => k === awardKey)?.[1] ?? 0;
  return {
    precise: true,
    remaining: Math.max(0, Math.min(remainingInQueue, awarded - alreadyRevoked)),
  };
}
