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
 *
 * Round-98 F4 extension (R98-DB-01/02/03/04/05): the same discipline
 * applied to the V1-M16/V1-M17 live-only objects — the two variant
 * indexes, the cart→user FK, and the NULLS NOT DISTINCT unique index —
 * plus compile-level getTableConfig assertions that the schema TS now
 * DECLARES every round-98 mirror (variant indexes, forecast partial
 * index, the six CHECKs, the cart FK, auth_activity timestamptz), so a
 * silent schema-TS regression fails here even where the pglite harness
 * carries no such table (inventory_forecasts / enrichment_drafts are not
 * in the harness DDL — TS parity is the goal there).
 *
 * R122 (A4-P1-2 + A4-P2-5) extension: the harness also carries the
 * V1-M25/V1-M26 post-boot shape — the four money-history user FKs as
 * ON DELETE RESTRICT (never-delete audit-trail policy; fk_orders_user /
 * fk_topups_user now by their boot names, points_ledger by the boot
 * auto-name) and the two V1-M26 CHECKs (chk_orders_amount_pos + the
 * type-aware chk_ledger_arithmetic). Behavioral pins: a user delete is
 * BLOCKED when ledger rows exist and still succeeds when none do.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  db,
  initTestDb,
  resetTestDb,
  cartItemsTable,
  productsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import {
  authActivityTable,
  enrichmentDraftsTable,
  inventoryForecastsTable,
  inventoryTable,
  ordersTable,
  pointsLedgerTable,
  productVariantsTable,
} from "@workspace/db/schema";
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

/** Render a drizzle sql`` template (predicate / check expression) to text. */
function sqlText(chunk: SQL | undefined): string {
  if (!chunk) return "";
  const chunks = (chunk as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks;
  return String(chunks?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value)).join(""));
}

/** Column names an index is declared on (drizzle IndexedColumn.name). */
function indexColumns(index: { config: { columns: unknown[] } }): string[] {
  return index.config.columns.map((c) => String((c as { name?: string }).name));
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
    // R122 (A4-P1-2): V1-M25 rebuilds the money-ledger user FK as ON DELETE
    // RESTRICT — the never-delete audit-trail policy. NOT the pre-R122
    // CASCADE (a manual DELETE FROM users must never silently erase a
    // user's complete financial history).
    expect(await constraintDef("fk_wallet_ledger_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
    // R122 (A4-P2-5): the two V1-M26 CHECKs (definitions as pg renders them).
    expect(await constraintDef("chk_orders_amount_pos")).toBe("CHECK ((amount > (0)::numeric))");
    expect(await constraintDef("chk_ledger_arithmetic")).toContain(
      "balance_after = (balance_before + amount)",
    );
    expect(await constraintDef("chk_ledger_arithmetic")).toContain(
      "balance_after = (balance_before - amount)",
    );
  });

  it("the other three money-history user FKs exist by boot NAME and are RESTRICT (V1-M25)", async () => {
    // R122 (A4-P1-2): orders + wallet_topups carry the boot fkStatements
    // names; points_ledger carries the boot CREATE TABLE auto-name — the
    // exact names V1-M25 probes and rebuilds.
    expect(await constraintDef("fk_orders_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
    expect(await constraintDef("fk_topups_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
    expect(await constraintDef("points_ledger_user_id_fkey")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
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

describe("round-98 F4: harness carries the V1-M16/M17 live-only objects", () => {
  it("the two variant indexes exist by NAME and column", async () => {
    expect(await indexDef("idx_orders_variant")).toContain("ON public.orders");
    expect(await indexDef("idx_orders_variant")).toContain("(variant_id)");
    expect(await indexDef("idx_inventory_variant")).toContain("ON public.inventory");
    expect(await indexDef("idx_inventory_variant")).toContain("(variant_id)");
  });

  it("fk_cart_items_user exists with the boot-SQL definition and cascades", async () => {
    expect(await constraintDef("fk_cart_items_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    );

    const user = await makeUser("10.00");
    const [product] = await db
      .insert(productsTable)
      .values({ name: "cart-fk-probe", price: "10.00" })
      .returning();
    await db.insert(cartItemsTable).values({ userId: user.id, productId: product.id, quantity: 1 });

    await db.delete(usersTable).where(eq(usersTable.id, user.id));

    const remaining = await db.select().from(cartItemsTable);
    expect(remaining).toHaveLength(0); // cascade, not orphan
  });

  it("uniq_product_variants_plan_duration is NULLS NOT DISTINCT and dedups NULL axes", async () => {
    const def = await indexDef("uniq_product_variants_plan_duration");
    expect(def).toContain("UNIQUE INDEX uniq_product_variants_plan_duration");
    expect(def).toContain("ON public.product_variants");
    expect(def).toContain("(product_id, plan_label, duration_label)");
    // The V1-M17 form — without it, NULL axes never dedup (R98-DB-05).
    expect(def).toContain("NULLS NOT DISTINCT");

    const [product] = await db
      .insert(productsTable)
      .values({ name: "variant-null-axis-probe", price: "10.00" })
      .returning();
    await db.insert(productVariantsTable).values({
      productId: product.id,
      planLabel: "Family",
      durationLabel: null,
      costPrice: "5.00",
      priceLyd: "100.00",
    });
    // Same triple incl. the NULL duration → 23505 on the index. The
    // pre-V1-M17 plain UNIQUE would have accepted it (NULLs distinct).
    expect(
      await constraintViolationName(
        db.insert(productVariantsTable).values({
          productId: product.id,
          planLabel: "Family",
          durationLabel: null,
          costPrice: "5.00",
          priceLyd: "100.00",
        }),
      ),
    ).toBe("uniq_product_variants_plan_duration");
    // The NULL plan axis dedups too.
    await db.insert(productVariantsTable).values({
      productId: product.id,
      planLabel: null,
      durationLabel: "1 Month",
      costPrice: "3.00",
      priceLyd: "60.00",
    });
    expect(
      await constraintViolationName(
        db.insert(productVariantsTable).values({
          productId: product.id,
          planLabel: null,
          durationLabel: "1 Month",
          costPrice: "3.00",
          priceLyd: "60.00",
        }),
      ),
    ).toBe("uniq_product_variants_plan_duration");
    // A genuinely distinct triple still coexists.
    await db.insert(productVariantsTable).values({
      productId: product.id,
      planLabel: "Family",
      durationLabel: "1 Month",
      costPrice: "5.00",
      priceLyd: "110.00",
    });
  });
});

describe("R122 (A4-P1-2): money-history user FKs are ON DELETE RESTRICT", () => {
  it("deleting a user with ANY money-history row is BLOCKED, per table (23503 on the boot FK name)", async () => {
    // The pre-R122 CASCADE silently erased the user's complete financial
    // record on a manual DELETE FROM users; RESTRICT must refuse instead.
    // One seeded row per money table — the violating constraint name pins
    // WHICH FK refused (wallet_ledger, orders, wallet_topups, points_ledger).
    const cases: Array<{ name: string; seed: (userId: number) => Promise<unknown> }> = [
      {
        name: "fk_wallet_ledger_user",
        seed: (userId) =>
          db.insert(walletLedgerTable).values({
            userId,
            type: "topup",
            amount: "10.00",
            balanceBefore: "0.00",
            balanceAfter: "10.00",
          }),
      },
      {
        name: "fk_orders_user",
        seed: async (userId) => {
          const [product] = await db
            .insert(productsTable)
            .values({ name: `restrict-probe-${userId}`, price: "10.00" })
            .returning();
          return db.insert(ordersTable).values({
            orderCode: `ORD-RP-${userId}`,
            userId,
            productId: product.id,
            amount: "10.00",
            status: "completed",
          });
        },
      },
      {
        name: "fk_topups_user",
        seed: (userId) =>
          db.insert(walletTopupsTable).values({ userId, amount: "25.00", status: "approved" }),
      },
      {
        name: "points_ledger_user_id_fkey",
        seed: (userId) =>
          db.insert(pointsLedgerTable).values({
            userId,
            type: "purchase_award",
            pointsDelta: 10,
            pointsBefore: 0,
            pointsAfter: 10,
          }),
      },
    ];

    for (const { name, seed } of cases) {
      const user = await makeUser("10.00");
      await seed(user.id);
      expect(
        await constraintViolationName(db.delete(usersTable).where(eq(usersTable.id, user.id))),
      ).toBe(name);
      // The money row survived the refused delete.
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(u).toBeDefined();
    }
  });

  it("deleting a user with NO dependent money rows still succeeds (RESTRICT is not a blanket block)", async () => {
    const user = await makeUser("10.00");
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    const [gone] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(gone).toBeUndefined();
  });
});

describe("R122 (A4-P2-5): the V1-M26 money CHECKs reject bypass-writer dirt", () => {
  it("a zero/negative orders.amount write is rejected (chk_orders_amount_pos)", async () => {
    const user = await makeUser("10.00");
    const [product] = await db
      .insert(productsTable)
      .values({ name: "amount-pos-probe", price: "10.00" })
      .returning();
    expect(
      await constraintViolationName(
        db.insert(ordersTable).values({
          orderCode: "ORD-ZERO-1",
          userId: user.id,
          productId: product.id,
          amount: "0.00",
          status: "pending",
        }),
      ),
    ).toBe("chk_orders_amount_pos");
  });

  it("an incoherent wallet_ledger row is rejected per type (chk_ledger_arithmetic)", async () => {
    const user = await makeUser("100.00");
    // Credit-type row where after != before + amount.
    expect(
      await constraintViolationName(
        db.insert(walletLedgerTable).values({
          userId: user.id,
          type: "topup",
          amount: "10.00",
          balanceBefore: "100.00",
          balanceAfter: "200.00",
        }),
      ),
    ).toBe("chk_ledger_arithmetic");
    // Purchase rows use the DEBIT identity (after = before - amount) — the
    // naive uniform CHECK would have rejected this legitimate row.
    await db.insert(walletLedgerTable).values({
      userId: user.id,
      type: "purchase",
      amount: "14.99",
      balanceBefore: "100.00",
      balanceAfter: "85.01",
    });
    // ...and a purchase row that violates the debit identity is rejected.
    expect(
      await constraintViolationName(
        db.insert(walletLedgerTable).values({
          userId: user.id,
          type: "purchase",
          amount: "14.99",
          balanceBefore: "100.00",
          balanceAfter: "114.99",
        }),
      ),
    ).toBe("chk_ledger_arithmetic");
  });
});

describe("round-98 F4: schema TS declares the live-only objects (compile-level)", () => {
  it("orders + inventory declare the V1-M16 variant indexes", () => {
    const ordersIdx = getTableConfig(ordersTable).indexes.find(
      (i) => i.config.name === "idx_orders_variant",
    );
    expect(ordersIdx).toBeDefined();
    expect(indexColumns(ordersIdx!)).toEqual(["variant_id"]);

    const inventoryIdx = getTableConfig(inventoryTable).indexes.find(
      (i) => i.config.name === "idx_inventory_variant",
    );
    expect(inventoryIdx).toBeDefined();
    expect(indexColumns(inventoryIdx!)).toEqual(["variant_id"]);
  });

  it("inventory_forecasts declares the partial at-risk index + both CHECKs", () => {
    const idx = getTableConfig(inventoryForecastsTable).indexes.find(
      (i) => i.config.name === "idx_forecasts_at_risk_runout",
    );
    expect(idx).toBeDefined();
    expect(indexColumns(idx!)).toEqual(["at_risk", "predicted_runout_at"]);
    // Partial predicate verbatim from the boot SQL (011 stage).
    expect(sqlText(idx!.config.where)).toBe("at_risk = true");

    const checks = getTableConfig(inventoryForecastsTable).checks;
    expect(checks.map((c) => c.name)).toContain("chk_forecast_confidence");
    expect(checks.map((c) => c.name)).toContain("chk_forecast_insufficient_consistency");
    expect(sqlText(checks.find((c) => c.name === "chk_forecast_confidence")?.value)).toBe(
      "confidence IN ('high','medium','low','insufficient_data')",
    );
    expect(
      sqlText(checks.find((c) => c.name === "chk_forecast_insufficient_consistency")?.value),
    ).toBe("(confidence = 'insufficient_data') = (avg_daily_sales IS NULL)");
  });

  it("enrichment_drafts declares the four state-machine CHECKs", () => {
    const checks = getTableConfig(enrichmentDraftsTable).checks;
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "chk_enrichment_state",
        "chk_enrichment_field",
        "chk_enrichment_published_consistency",
        "chk_enrichment_rejected_consistency",
      ]),
    );
    expect(sqlText(checks.find((c) => c.name === "chk_enrichment_state")?.value)).toBe(
      "state IN ('drafted','published','rejected','draft_invalid')",
    );
    expect(
      sqlText(checks.find((c) => c.name === "chk_enrichment_rejected_consistency")?.value),
    ).toBe("(state = 'rejected') = (rejected_at IS NOT NULL)");
  });

  it("cart_items declares the user_id → users(id) cascade FK", () => {
    const fk = getTableConfig(cartItemsTable).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "user_id"),
    );
    expect(fk).toBeDefined();
    const ref = fk!.reference();
    const foreignTableName = String(
      (ref.foreignTable as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")],
    );
    expect(foreignTableName).toBe("users");
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
    expect(fk!.onDelete).toBe("cascade");
  });

  it("auth_activity.created_at is timestamp WITH time zone", () => {
    const col = getTableConfig(authActivityTable).columns.find((c) => c.name === "created_at");
    expect(col).toBeDefined();
    expect((col as unknown as { withTimezone?: boolean }).withTimezone).toBe(true);
    expect((col as unknown as { getSQLType?: () => string }).getSQLType?.()).toBe(
      "timestamp with time zone",
    );
  });

  it("product_variants unique index columns match the LIVE index", () => {
    const idx = getTableConfig(productVariantsTable).indexes.find(
      (i) => i.config.name === "uniq_product_variants_plan_duration",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    // LIVE index (verified via direct Neon query, round-98 main agent):
    // (product_id, plan_label, duration_label) — duration_label, NOT
    // duration_days. NULLS NOT DISTINCT itself is boot-migration-owned
    // (V1-M17) — drizzle's uniqueIndex() cannot express it; see the
    // mirror comment in product-variants.ts.
    expect(indexColumns(idx!)).toEqual(["product_id", "plan_label", "duration_label"]);
  });
});

describe("R122: schema TS declares the V1-M25/V1-M26 objects (compile-level)", () => {
  it("the four money-history tables declare the user FK as onDelete restrict", () => {
    // R122 (A4-P1-2): the TS declarations must match the boot's post-V1-M25
    // shape so a chain regeneration mirrors RESTRICT (not the dead CASCADE).
    const tables: Array<{ name: string; table: Parameters<typeof getTableConfig>[0] }> = [
      { name: "wallet_ledger", table: walletLedgerTable },
      { name: "orders", table: ordersTable },
      { name: "wallet_topups", table: walletTopupsTable },
      { name: "points_ledger", table: pointsLedgerTable },
    ];
    for (const { name, table } of tables) {
      const fk = getTableConfig(table).foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "user_id"),
      );
      expect(fk, `${name} user FK missing from the TS schema`).toBeDefined();
      const ref = fk!.reference();
      const foreignTableName = String(
        (ref.foreignTable as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")],
      );
      expect(foreignTableName).toBe("users");
      expect(fk!.onDelete, `${name} user FK must be restrict post-V1-M25`).toBe("restrict");
    }
  });

  it("orders + wallet_ledger declare the two V1-M26 CHECKs with their exact names", () => {
    // R122 (A4-P2-5): the 0016 MIRROR_CHECKS discipline — the TS check
    // names must match the boot's constraint names byte-for-byte.
    const ordersChecks = getTableConfig(ordersTable).checks;
    expect(ordersChecks.map((c) => c.name)).toContain("chk_orders_amount_pos");
    expect(sqlText(ordersChecks.find((c) => c.name === "chk_orders_amount_pos")?.value)).toBe(
      "amount > 0",
    );

    const ledgerChecks = getTableConfig(walletLedgerTable).checks;
    expect(ledgerChecks.map((c) => c.name)).toContain("chk_ledger_arithmetic");
    expect(sqlText(ledgerChecks.find((c) => c.name === "chk_ledger_arithmetic")?.value)).toBe(
      "(type <> 'purchase' AND balance_after = balance_before + amount) OR (type = 'purchase' AND balance_after = balance_before - amount)",
    );
  });
});
