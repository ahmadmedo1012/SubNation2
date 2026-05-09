import { pgTable, serial, integer, numeric, varchar, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["topup", "purchase", "refund", "adjustment", "referral_credit"]);

export const walletLedgerTable = pgTable("wallet_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: ledgerEntryTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 10, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 10, scale: 2 }).notNull(),
  referenceId: integer("reference_id"),
  referenceType: varchar("reference_type", { length: 50 }),
  description: varchar("description", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WalletLedgerEntry = typeof walletLedgerTable.$inferSelect;
