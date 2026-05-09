import { db, walletLedgerTable } from "@workspace/db";
import { logger } from "./logger";

type LedgerType = "topup" | "purchase" | "refund" | "adjustment" | "referral_credit";

export async function insertLedgerEntry(params: {
  userId: number;
  type: LedgerType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceId?: number;
  referenceType?: string;
  description?: string;
}): Promise<void> {
  try {
    await db.insert(walletLedgerTable).values({
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
  }
}
