import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "topup",
  "purchase",
  "refund",
  "adjustment",
  "referral_credit",
]);

export const walletLedgerTable = pgTable(
  "wallet_ledger",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: ledgerEntryTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    balanceBefore: numeric("balance_before", { precision: 10, scale: 2 }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 10, scale: 2 }).notNull(),
    referenceId: integer("reference_id"),
    referenceType: varchar("reference_type", { length: 50 }),
    description: varchar("description", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_wallet_ledger_user").on(t.userId),
    typeIdx: index("idx_wallet_ledger_type").on(t.type),
    createdIdx: index("idx_wallet_ledger_created").on(t.createdAt),
    // Round-3 (8-c §4.3): per-user "recent ledger" reads (copilot tools,
    // future wallet statement pages) sort a user's full ledger by date —
    // one row per money event, so this index keeps that O(log n) as the
    // ledger grows.
    userCreatedIdx: index("idx_wallet_ledger_user_created").on(t.userId, t.createdAt),
  }),
);

export type WalletLedgerEntry = typeof walletLedgerTable.$inferSelect;
