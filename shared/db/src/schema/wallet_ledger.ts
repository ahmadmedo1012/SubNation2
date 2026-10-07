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
      // R122 (A4-P1-2): RESTRICT — wallet_ledger is a NEVER-delete audit
      // trail (same retention class as points_ledger). The boot twin is
      // V1-M25 (migrate.ts applyMoneyLedgerUserFkRestrictStage), which
      // rebuilds fk_wallet_ledger_user as ON DELETE RESTRICT; this
      // declaration keeps the drizzle chain mirror in lockstep. The only
      // supported "deletion" story is user ANONYMIZATION (keep the rows).
      .references(() => usersTable.id, { onDelete: "restrict" }),
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
    // R122 (A4-P2-5): the arithmetic identity points_ledger has carried
    // since V1-M21, in the type-aware form wallet_ledger's TWO writer
    // conventions require (documented at V1-M10): purchases store POSITIVE
    // magnitudes with the debit sign carried by `type`
    // (balance_after = balance_before - amount), while topup / refund /
    // adjustment / referral_credit rows all satisfy
    // balance_after = balance_before + amount (adjustments store SIGNED
    // deltas: amount = balanceAfter - balanceBefore). The naive uniform
    // identity would reject every purchase — the V1-M10 disaster class.
    // Boot twin: V1-M26 (migrate.ts applyMoneyArithmeticChecksStage),
    // probe-gated count-then-add.
    arithmeticCheck: check(
      "chk_ledger_arithmetic",
      sql`(type <> 'purchase' AND balance_after = balance_before + amount) OR (type = 'purchase' AND balance_after = balance_before - amount)`,
    ),
  }),
);
