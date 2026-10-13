import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, adminUsersTable, productsTable } from "../../../test/db";
import { copilotPreviewsTable } from "@workspace/db";
import { createPreview, getOwnedPreview } from "../preview-store";
// The race simulation mocks only the claim SELECT (see below) — everything
// else is the REAL executor over the REAL pglite tables.
import { executeLowRiskConfirm } from "../executor";

/**
 * E-1 (R142): copilot preview single-use is a CONDITIONAL claim, not
 * check-then-act.
 *
 * The pre-fix shape: claimUnconsumedPreview was a plain SELECT and the
 * consumed_at stamp ran AFTER the low-risk tx — two concurrent confirms
 * that both passed the claim inside the tx window both executed,
 * committing TWO copilot_actions + audit_logs rows for ONE admin intent.
 * The fix: stamp consumed_at INSIDE the tx with an isNull(consumed_at)
 * predicate and throw when 0 rows match → full rollback → the route
 * answers the second click with an honest 409 ("consumed").
 *
 * pglite is single-connection, so the true interleaving (both claims read
 * before either tx commits) cannot be scheduled through the public API —
 * the race test below simulates exactly that window by mocking the claim
 * SELECT to return an ALREADY-CONSUMED row (what the loser read before
 * the winner committed), then asserting the conditional stamp rejects it
 * and NOTHING is written.
 */

vi.mock("../preview-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../preview-store")>();
  return {
    ...actual,
    claimUnconsumedPreview: vi.fn(actual.claimUnconsumedPreview),
    claimHighRiskForExecute: vi.fn(actual.claimHighRiskForExecute),
  };
});

const { claimUnconsumedPreview } = await import("../preview-store");
const claimMock = vi.mocked(claimUnconsumedPreview);
const actualClaim = (await vi.importActual<typeof import("../preview-store")>("../preview-store"))
  .claimUnconsumedPreview;

const ADMIN_ID = 1;

async function seedAdminAndProduct() {
  await db.insert(adminUsersTable).values({
    username: "copilot-admin",
    passwordHash: "x",
    role: "admin",
  });
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Copilot Target Product",
      slug: "copilot-target",
      price: "50.00",
      category: "software",
      description: "before",
    })
    .returning();
  return product!;
}

async function seedLowRiskPreview(productId: number, updatedAt: Date, correlationId: string) {
  return createPreview({
    adminId: ADMIN_ID,
    intentText: "غيّر الوصف",
    toolName: "draft_catalog_edit",
    actionClass: "catalog_edit",
    riskTier: "low",
    affectedIds: [productId],
    affectedEntityType: "product",
    recordVersions: { [String(productId)]: updatedAt.toISOString() },
    previewPayload: { changes: [{ field: "description", after: "after-value" }] },
    modelId: "test-model",
    correlationId,
  });
}

async function actionRowCount(): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS c FROM copilot_actions`);
  const rows = (result as unknown as { rows?: Array<{ c: number }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  claimMock.mockReset();
  claimMock.mockImplementation(actualClaim);
});

describe("E-1 — single-use enforcement (sequential contract)", () => {
  it("the first confirm executes once; a second confirm on the consumed preview is NOT a success and writes no second action row", async () => {
    const product = await seedAdminAndProduct();
    const { id } = await seedLowRiskPreview(product.id, product.updatedAt, "corr-1");

    const first = await executeLowRiskConfirm({ previewId: id, adminId: ADMIN_ID });
    expect(first.kind).toBe("success");
    expect(await actionRowCount()).toBe(1);

    // The preview row is now consumed.
    const consumed = await getOwnedPreview(id, ADMIN_ID);
    expect(consumed?.consumedAt).not.toBeNull();

    // Double-confirm (the user double-clicks): not a success, and the
    // action trail stays at exactly ONE row.
    const second = await executeLowRiskConfirm({ previewId: id, adminId: ADMIN_ID });
    expect(second.kind).not.toBe("success");
    expect(await actionRowCount()).toBe(1);
  });
});

describe("E-1 — the in-tx conditional stamp closes the race window", () => {
  it("a claim that races a concurrent winner (reads a consumed row) rolls EVERYTHING back: consumed outcome, zero action rows, product untouched", async () => {
    const product = await seedAdminAndProduct();
    const { id } = await seedLowRiskPreview(product.id, product.updatedAt, "corr-2");

    // Simulate the race: the claim SELECT returns the row as if it were
    // still fresh (what the loser read before the winner's commit), but
    // the row IS consumed — only the conditional stamp can catch it.
    await db
      .update(copilotPreviewsTable)
      .set({ consumedAt: new Date() })
      .where(eq(copilotPreviewsTable.id, id));
    const racingRow = await getOwnedPreview(id, ADMIN_ID);
    claimMock.mockResolvedValueOnce(racingRow);

    const outcome = await executeLowRiskConfirm({ previewId: id, adminId: ADMIN_ID });

    // Pre-fix this was a second "success" with duplicate action/audit rows.
    expect(outcome).toEqual({ kind: "consumed" });
    expect(await actionRowCount()).toBe(0);

    // The product write rolled back with the stamp.
    const [untouched] = await db
      .select({ description: productsTable.description })
      .from(productsTable)
      .where(eq(productsTable.id, product.id))
      .limit(1);
    expect(untouched?.description).toBe("before");
  });

  it("an UNCONSUMED preview still executes normally through the mocked-claim path (the mock itself is not the assertion)", async () => {
    const product = await seedAdminAndProduct();
    const { id } = await seedLowRiskPreview(product.id, product.updatedAt, "corr-3");
    const fresh = await getOwnedPreview(id, ADMIN_ID);
    claimMock.mockResolvedValueOnce(fresh);

    const outcome = await executeLowRiskConfirm({ previewId: id, adminId: ADMIN_ID });
    expect(outcome.kind).toBe("success");
    expect(await actionRowCount()).toBe(1);
  });
});
