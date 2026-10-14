import { db, walletLedgerTable } from "@workspace/db";
import { logger } from "./logger";

type LedgerType = "topup" | "purchase" | "refund" | "adjustment" | "referral_credit";

// Drizzle transaction is structurally compatible with `db` for our uses; we
// accept either to allow inserting inside an active transaction so the ledger
// commits atomically with the balance change.
type DbOrTx = typeof db;

export interface LedgerEntryParams {
  userId: number;
  type: LedgerType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceId?: number;
  referenceType?: string;
  description?: string;
}

/**
 * Insert a wallet ledger entry. Pass a transaction (`tx`) to commit
 * atomically with the surrounding balance mutation. Errors propagate so the
 * caller's transaction rolls back — the ledger is the source of truth and
 * MUST not silently fail.
 *
 * R115: returns the inserted row's id so cross-ledger references can link
 * to it (points_ledger conversion_out → the wallet credit it produced).
 * Callers that ignore the return are unaffected.
 */
export async function insertLedgerEntry(
  params: LedgerEntryParams,
  client: DbOrTx = db,
): Promise<number> {
  try {
    const [row] = await client
      .insert(walletLedgerTable)
      .values({
        userId: params.userId,
        type: params.type,
        amount: params.amount,
        balanceBefore: params.balanceBefore,
        balanceAfter: params.balanceAfter,
        referenceId: params.referenceId ?? null,
        referenceType: params.referenceType ?? null,
        description: params.description ?? null,
      })
      .returning({ id: walletLedgerTable.id });
    return row?.id ?? 0;
  } catch (err) {
    logger.error({ err, params }, "Failed to insert wallet ledger entry");
    throw err;
  }
}

// Historical note (R118-A1 F-6; reworded R146 — the previous text claimed
// this type "has NO writer", which was false): the dead
// `insertReferralSignupLedger` helper that used to own this shape was
// deleted after a repo-wide caller hunt found zero production AND zero
// test callers — but the `referral_credit` type literal STAYS, because
// the welcome-bonus grant in topup.service.ts (first approved topup,
// R115 policy B) still writes rows with this type and
// reference_type='welcome_bonus'. The pre-R115 referral_signup rows
// remain meaningful historical evidence (the V1-M21 backfill used them to
// mark users.welcome_bonus_granted).
