import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    createdIdx: index("idx_wallet_ledger_created").on(t.createdAt.desc()),
    // Round-3 (8-c §4.3): per-user "recent ledger" reads (copilot tools,
    // future wallet statement pages) sort a user's full ledger by date —
    // one row per money event, so this index keeps that O(log n) as the
    // ledger grows.
    userCreatedIdx: index("idx_wallet_ledger_user_created").on(t.userId, t.createdAt),
    // R118-A3 F3: the signed-delta invariant the boot SQL applies live —
    // V1-M9 created chk_ledger_amount_pos (amount > 0), V1-M10 replaced
    // it with this sign-free form because adjustments store SIGNED
    // deltas (amount = balanceAfter - balanceBefore). A zero row is a
    // phantom mutation; pinned verbatim to the boot SQL (migrate.ts
    // applyLedgerAmountNonzeroStage).
    amountNonzeroCheck: check("chk_ledger_amount_nonzero", sql`amount <> 0`),
  }),
);
