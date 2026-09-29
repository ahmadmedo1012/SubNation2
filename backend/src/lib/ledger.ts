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

/**
 * RETIRED (R115 welcome-bonus policy B) — kept for its historical rows.
 *
 * Pre-R115, referred signups received an instant 5.00 LYD wallet credit
 * and this helper wrote the matching referral_credit ledger row
 * (reference_type='referral_signup'). Those rows remain meaningful: the
 * V1-M21 backfill uses them as the evidence for marking
 * users.welcome_bonus_granted = true on pre-R115 recipients, so the
 * topup-path grant never double-pays them.
 *
 * New grants (first approved topup, all channels) write their ledger row
 * directly in topup.service.ts with reference_type='welcome_bonus'.
 */
export async function insertReferralSignupLedger(client: DbOrTx, userId: number): Promise<void> {
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
