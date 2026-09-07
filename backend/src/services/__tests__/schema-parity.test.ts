/**
 * A10 (round-93 audit §2 P0) — schema parity: the test harness must carry
 * the REAL production money schema, not a hand-written subset.
 *
 * Three DDL sources existed with no reconciliation gate: the drizzle
 * schema TS (no constraints), migrate.ts applyMoneyConstraintStage (what
 * production runs), and test/db.ts (what every service test ran against).
 * The harness certified prod-forbidden behavior: signed debit adjustments
 * passed here while chk_ledger_amount_pos 500'd in production, and the
 * payment_reference partial unique index was invisible to every service
 * test (only topup-payment-reference.test.ts re-created it in-file).
 *
 * Fix under test: initTestDb()'s DDL now ships the V1-M9 + V1-M10
 * constraints/indexes verbatim (names AND definitions), and money services
 * run against them — the suite certifies what production enforces:
 *   - every constraint/index exists by NAME and by DEFINITION;
 *   - AdjustmentService.adjust(-30) commits (V1-M10) with a signed row;
 *   - a duplicate approved payment_reference is rejected by the
 *     DDL-carried partial unique index at the SERVICE layer (no per-file
 *     index re-creation);
 *   - direct negative-balance / zero-amount writes are rejected.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { AdjustmentService } from "../../services/adjustment.service";
import { ServiceError, TopupService } from "../../services/topup.service";

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_800_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(balance = "100.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** Unwrap drizzle's error cause to pin the exact constraint that rejected. */
async function constraintViolationName(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint;
  }
}

describe("initTestDb carries the production money schema (V1-M9 + V1-M10)", () => {
  it("every money constraint exists by NAME and by DEFINITION", async () => {
    expect(await constraintDef("chk_users_wallet_balance_nonneg")).toBe(
      "CHECK ((wallet_balance >= (0)::numeric))",
    );
    expect(await constraintDef("chk_topups_amount_pos")).toBe("CHECK ((amount > (0)::numeric))");
    // V1-M10 form — NOT the amount > 0 variant that broke signed debits.
    expect(await constraintDef("chk_ledger_amount_nonzero")).toBe(
      "CHECK ((amount <> (0)::numeric))",
    );
    expect(await constraintDef("chk_coupons_used_le_max")).toBe(
      "CHECK (((max_uses IS NULL) OR (used_count <= max_uses)))",
    );
    expect(await constraintDef("fk_wallet_ledger_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    );
  });

  it("the payment_reference partial unique index matches the production predicate", async () => {
    const def = await indexDef("uniq_wallet_topups_payment_reference");
    expect(def).toContain("UNIQUE INDEX uniq_wallet_topups_payment_reference");
    expect(def).toContain("ON public.wallet_topups");
    // The exact partial predicate: approved-only, non-blank refs.
    expect(def).toContain(
      "WHERE ((payment_reference IS NOT NULL) AND (btrim((payment_reference)::text) <> ''::text) AND (status = 'approved'::topup_status))",
    );
    // A blanket (non-partial) unique index would reject the legacy exempt
    // class — the predicate text pins that it doesn't.
  });

  it("the four V1-M9 composite indexes exist", async () => {
    expect(await indexDef("idx_orders_status_created")).toContain("ON public.orders");
    expect(await indexDef("idx_topups_status_created")).toContain("ON public.wallet_topups");
    expect(await indexDef("idx_inventory_product_sold")).toContain("ON public.inventory");
    expect(await indexDef("idx_cart_items_user")).toContain("ON public.cart_items");
  });
});

describe("money services against the constraint-carrying harness (A10 §2 spec)", () => {
  it("AdjustmentService.adjust(userId, -30) commits a signed ledger row — V1-M10 behavior", async () => {
    const user = await makeUser("100.00");

    const result = await AdjustmentService.adjust(user.id, -30, {
      adminId: 42,
      note: "admin reversal under real constraints",
    });

    expect(result.walletBalance).toBe(70);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(70);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(parseFloat(String(ledger[0].amount))).toBe(-30);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(70);
  });

  it("duplicate approved payment_reference is rejected at the service layer by the DDL-carried index", async () => {
    // No index re-creation in this file — the guard must come from the
    // harness DDL itself (the A10 finding: only
    // topup-payment-reference.test.ts ever saw this constraint).
    const user = await makeUser("0.00");
    const [t1] = await db
      .insert(walletTopupsTable)
      .values({
        userId: user.id,
        amount: "50.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        paymentReference: "PARITY-REF-1",
        status: "pending",
      })
      .returning();
    const [t2] = await db
      .insert(walletTopupsTable)
      .values({
        userId: user.id,
        amount: "50.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        paymentReference: "PARITY-REF-1",
        status: "pending",
      })
      .returning();

    await TopupService.approve(t1.id, null);
    await expect(TopupService.approve(t2.id, null)).rejects.toBeInstanceOf(ServiceError);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50); // credited once
  });

  it("users.wallet_balance cannot go negative via direct write", async () => {
    await makeUser("10.00");
    expect(
      await constraintViolationName(
        db.insert(usersTable).values({ phone: "09199900000", walletBalance: "-5.00" }),
      ),
    ).toBe("chk_users_wallet_balance_nonneg");
  });

  it("a zero-amount wallet_ledger row is rejected (amount <> 0)", async () => {
    const user = await makeUser("10.00");
    expect(
      await constraintViolationName(
        db.insert(walletLedgerTable).values({
          userId: user.id,
          type: "adjustment",
          amount: "0.00",
          balanceBefore: "10.00",
          balanceAfter: "10.00",
        }),
      ),
    ).toBe("chk_ledger_amount_nonzero");
  });
});
