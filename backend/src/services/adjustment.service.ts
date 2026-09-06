/**
 * AdjustmentService — F-004 (security audit 004) bundle S-01.
 *
 * Atomic admin-side wallet adjustment. Wraps the legacy
 * `PATCH /api/admin/users/:id` wallet_adjustment / wallet_balance branches
 * so every balance change carries a ledger entry, fits inside a single
 * transaction with optimistic-lock concurrency safety, and produces an
 * audit trail that can reconstruct the user's balance from the ledger
 * sum (Constitution Principle I).
 *
 * Two operations are exposed:
 *
 *   - `adjust(userId, delta, adminId, note)` — `wallet_adjustment` shape;
 *     adds (or subtracts when negative) `delta` to the current balance.
 *
 *   - `setBalance(userId, target, adminId, note)` — `wallet_balance` shape;
 *     replaces the balance with `target`. Computes the implicit delta and
 *     records it as the ledger entry's `amount`.
 *
 * Both paths share the same transactional shape:
 *   1. Inside `db.transaction`, re-read the user's current balance.
 *   2. UPDATE wallet with `WHERE walletBalance = balanceBefore` (optimistic
 *      lock); throw on rowsAffected = 0 — the caller's idempotency middleware
 *      already deduplicates double-clicks, so a lost lock means a *concurrent
 *      change* (e.g. the user just made a purchase). Surface as 409.
 *   3. `insertLedgerEntry({ type: "adjustment", balanceBefore, balanceAfter,
 *      referenceType: "admin_adjustment", referenceId: <adminId>,
 *      description: note })`. The ledger entry rolls back with the wallet
 *      UPDATE if anything later fails.
 *
 * Closes audit Findings F-004 and F-008 (specs/004-security-audit/security.md).
 * F-008's idempotency requirement is satisfied at the route layer by the
 * idempotency middleware in `middlewares/idempotency.ts`.
 */

import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { insertLedgerEntry } from "../lib/ledger";

export class AdjustmentError extends Error {
  constructor(
    public statusCode: number,
    public code: AdjustmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdjustmentError";
  }
}

export type AdjustmentErrorCode =
  | "USER_NOT_FOUND"
  | "NEGATIVE_BALANCE"
  | "ZERO_DELTA"
  | "CONCURRENCY_ERROR"
  | "INVALID_AMOUNT";

export interface AdjustmentResult {
  userId: number;
  walletBalance: number;
  ledger: {
    balanceBefore: number;
    balanceAfter: number;
    amount: number; // signed: positive = credit, negative = debit
  };
}

export interface AdjustOptions {
  adminId: number;
  note: string; // required — audit trail must explain WHY
}

/**
 * H6 (deep-audit 2026-09-06): a JSON body of `wallet_adjustment: 1e999`
 * parses as Infinity — and Postgres numeric happily stores 'Infinity',
 * which made the wallet permanently infinite (free purchases, ledger
 * invariant destroyed). NaN likewise round-trips through JSON in some
 * clients. Reject non-finite values and absurd magnitudes at the
 * service boundary, where every caller funnels through.
 */
const MAX_ABS_ADJUSTMENT = 1_000_000_000; // 1e9 LYD — far above any legitimate balance

function assertFiniteAmount(value: number): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_ADJUSTMENT) {
    throw new AdjustmentError(400, "INVALID_AMOUNT", "قيمة المبلغ غير صالحة");
  }
}

export class AdjustmentService {
  /**
   * `wallet_adjustment` shape — add (or subtract when negative) `delta`
   * from the user's balance. Throws ZERO_DELTA on no-op so the caller
   * can return 400 instead of writing a meaningless ledger row.
   */
  static async adjust(
    userId: number,
    delta: number,
    options: AdjustOptions,
  ): Promise<AdjustmentResult> {
    assertFiniteAmount(delta);
    if (delta === 0) {
      throw new AdjustmentError(400, "ZERO_DELTA", "لا يمكن تعديل الرصيد بصفر");
    }
    const safeNote = sanitizeNote(options.note);
    return runAdjustmentTransaction({
      userId,
      adminId: options.adminId,
      note: safeNote,
      computeNext: (current) => +(current + delta).toFixed(2),
    });
  }

  /**
   * `wallet_balance` shape — replace the balance with `target` directly.
   * The ledger entry's `amount` is the implicit delta (target - current),
   * so reconstruction still works.
   */
  static async setBalance(
    userId: number,
    target: number,
    options: AdjustOptions,
  ): Promise<AdjustmentResult> {
    assertFiniteAmount(target);
    if (target < 0) {
      throw new AdjustmentError(400, "NEGATIVE_BALANCE", "الرصيد لا يمكن أن يكون سالباً");
    }
    const safeNote = sanitizeNote(options.note);
    return runAdjustmentTransaction({
      userId,
      adminId: options.adminId,
      note: safeNote,
      computeNext: () => +target.toFixed(2),
    });
  }
}

function sanitizeNote(note: string): string {
  // wallet_ledger.description is varchar(500). Truncate; never reject —
  // an admin's typo on a long note should not block a financial action.
  const trimmed = (note ?? "").trim();
  if (trimmed.length === 0) return "Admin adjustment";
  return trimmed.length > 500 ? trimmed.slice(0, 497) + "..." : trimmed;
}

interface AdjustmentTxParams {
  userId: number;
  adminId: number;
  note: string;
  computeNext: (current: number) => number;
}

async function runAdjustmentTransaction(params: AdjustmentTxParams): Promise<AdjustmentResult> {
  const { userId, adminId, note, computeNext } = params;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: usersTable.id,
        walletBalance: usersTable.walletBalance,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      throw new AdjustmentError(404, "USER_NOT_FOUND", "المستخدم غير موجود");
    }

    const balanceBefore = parseFloat(String(user.walletBalance));
    const balanceAfter = computeNext(balanceBefore);

    if (balanceAfter < 0) {
      throw new AdjustmentError(400, "NEGATIVE_BALANCE", "الرصيد لا يمكن أن يكون سالباً");
    }

    const updated = await tx
      .update(usersTable)
      .set({ walletBalance: String(balanceAfter) })
      .where(and(eq(usersTable.id, userId), eq(usersTable.walletBalance, String(balanceBefore))))
      .returning({ id: usersTable.id });

    if (updated.length !== 1) {
      throw new AdjustmentError(
        409,
        "CONCURRENCY_ERROR",
        "تغيّر رصيد المستخدم أثناء التعديل. حاول مرة أخرى.",
      );
    }

    const amount = +(balanceAfter - balanceBefore).toFixed(2);

    await insertLedgerEntry(
      {
        userId,
        type: "adjustment",
        amount: String(amount),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        referenceId: adminId,
        referenceType: "admin_adjustment",
        description: note,
      },
      tx as unknown as typeof db,
    );

    return {
      userId,
      walletBalance: balanceAfter,
      ledger: {
        balanceBefore,
        balanceAfter,
        amount,
      },
    };
  });
}
