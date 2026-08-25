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
 */
export async function insertLedgerEntry(
  params: LedgerEntryParams,
  client: DbOrTx = db,
): Promise<void> {
  try {
    await client.insert(walletLedgerTable).values({
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      referenceId: params.referenceId ?? null,
      referenceType: params.referenceType ?? null,
      description: params.description ?? null,
    });
  } catch (err) {
    logger.error({ err, params }, "Failed to insert wallet ledger entry");
    throw err;
  }
}

/**
 * Ledger row for the 5 LYD signup bonus granted to referred new users.
 * Every path that inserts a user with `walletBalance: "5.00"` MUST call
 * this inside the same transaction, otherwise the balance is not
 * reconstructable from wallet_ledger (Constitution Principle I).
 */
export async function insertReferralSignupLedger(
  client: DbOrTx,
  userId: number,
): Promise<void> {
  await insertLedgerEntry(
    {
      userId,
      type: "referral_credit",
      amount: "5.00",
      balanceBefore: "0.00",
      balanceAfter: "5.00",
      referenceId: userId,
      referenceType: "referral_signup",
      description: "رصيد ترحيبي عبر كود إحالة",
    },
    client,
  );
}
