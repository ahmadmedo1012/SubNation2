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

// Historical note (R118-A1 F-6): the `referral_credit` wallet-ledger type
// above has had NO writer since R115 retired the instant 5.00 LYD signup
// credit (policy B moved the welcome bonus to the first approved topup —
// those grants write their ledger rows directly in topup.service.ts with
// reference_type='welcome_bonus'). The pre-R115 referral_signup rows
// remain meaningful historical evidence (the V1-M21 backfill used them to
// mark users.welcome_bonus_granted); the dead `insertReferralSignupLedger`
// helper that used to own this shape was deleted in R118-A1 F-6 after a
// repo-wide caller hunt found zero production AND zero test callers.
