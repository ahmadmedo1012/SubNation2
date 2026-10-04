import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const topupStatusEnum = pgEnum("topup_status", ["pending", "approved", "rejected"]);

export const walletTopupsTable = pgTable(
  "wallet_topups",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    paymentMethod: varchar("payment_method", { length: 50 }).notNull().default("mobile_transfer"),
    paymentNetwork: varchar("payment_network", { length: 50 }),
    senderPhone: varchar("sender_phone", { length: 20 }),
    senderAccount: varchar("sender_account", { length: 255 }),
    paymentReference: varchar("payment_reference", { length: 255 }),
    status: topupStatusEnum("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    /**
     * A4-04 (R116): who reviewed this topup (admin username, or the
     * Telegram actor tag for webhook approvals). Nullable — legacy rows
     * + the automated gateway path (createApprovedTopup) have no human
     * reviewer. Written by TopupService.approve/reject in the same
     * guarded UPDATE as reviewed_at (V1-M23 boot migration).
     */
    reviewedBy: varchar("reviewed_by", { length: 100 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("idx_topups_user").on(t.userId),
    statusIdx: index("idx_topups_status").on(t.status),
    statusCreatedIdx: index("idx_topups_status_created").on(t.status, t.createdAt),
    // D8 closure (round-97 F7): mirrors the live partial unique index
    // created by applyMoneyConstraintStage (V1-M9, B8-01) — one APPROVED
    // topup per non-blank payment_reference, the authoritative duplicate-
    // transfer guard the topup approve path catches as 23505→409.
    // Previously live-only: a drizzle push would have dropped a money-path
    // safety invariant. Predicate pinned to the production indexdef
    // (NULL/blank refs and non-approved rows are the exempt legacy class).
    paymentRefUniqueIdx: uniqueIndex("uniq_wallet_topups_payment_reference")
      .on(t.paymentReference)
      .where(
        sql`payment_reference IS NOT NULL AND btrim(payment_reference) <> '' AND status = 'approved'`,
      ),
  }),
);

export const insertWalletTopupSchema = createInsertSchema(walletTopupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
