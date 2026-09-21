/**
 * ManualProvider — the default and ONLY fulfillment provider (R102).
 *
 * Reproduces the pre-R102 checkout claim block VERBATIM (business rules
 * unchanged — the transaction body was moved, not rewritten):
 *   1. two ordered `FOR UPDATE SKIP LOCKED` selects — variant-scoped
 *      units first, then legacy product-level units (H4: concurrent
 *      buyers take different rows; a variant-scoped unit is never burned
 *      on another variant's order while generic stock remains);
 *   2. the R93-DATA deliverability gate (at least one credential field
 *      present AND every present encrypted field decrypts — fail-closed
 *      before any mutation);
 *   3. the guarded claim UPDATE (`WHERE is_sold = false`) with the
 *      INVENTORY_CLAIMED race check.
 *
 * The credentials are returned in their AT-REST shapes (email as stored,
 * password/extraDetails as AES-256-GCM ciphertext) — checkout copies them
 * onto orders.delivered_* unchanged, exactly as before (H2 contract).
 *
 * No optional capabilities: fulfillment is synchronous and local, the
 * catalog is hand-maintained (no sync), and refunds are revoke-not-return
 * (B2-03). When the external provider arrives it registers alongside this
 * one — never replacing it (manual stock stays the fallback and the
 * operator's safety net).
 */

import { and, eq, isNull } from "drizzle-orm";
import { inventoryTable } from "@workspace/db";
import { isEncrypted, safeDecrypt } from "../../lib/encryption";
import type {
  FulfillmentRequest,
  FulfillmentProvider,
  FulfillmentResult,
  ProviderTx,
} from "./types";

async function fulfillManual(req: FulfillmentRequest, tx: ProviderTx): Promise<FulfillmentResult> {
  const { productId, variantId, now } = req;

  // H4 (deep-audit 2026-09-06): race-free inventory claim. FOR UPDATE
  // SKIP LOCKED inside the transaction makes each buyer take a DIFFERENT
  // row (locked rows are skipped).
  //
  // Claim preference (catalog 2026-09-20): variant-scoped units FIRST
  // (exact option match), then legacy product-level units
  // (variant_id IS NULL) — two ordered selects, so a variant-scoped unit
  // is never burned on another variant's order while generic stock
  // remains. ORDER BY id keeps each pool deterministic.
  let lockedInventory: typeof inventoryTable.$inferSelect | undefined;
  if (variantId !== null) {
    [lockedInventory] = await tx
      .select()
      .from(inventoryTable)
      .where(
        and(
          eq(inventoryTable.productId, productId),
          eq(inventoryTable.isSold, false),
          eq(inventoryTable.variantId, variantId),
        ),
      )
      .orderBy(inventoryTable.id)
      .limit(1)
      .for("update", { skipLocked: true });
  }
  if (!lockedInventory) {
    [lockedInventory] = await tx
      .select()
      .from(inventoryTable)
      .where(
        and(
          eq(inventoryTable.productId, productId),
          eq(inventoryTable.isSold, false),
          isNull(inventoryTable.variantId),
        ),
      )
      .orderBy(inventoryTable.id)
      .limit(1)
      .for("update", { skipLocked: true });
  }
  if (!lockedInventory) return { ok: false, reason: "OUT_OF_STOCK" };

  const inventoryItem = lockedInventory;

  // R93-DATA (round-93): deliverability gate — run BEFORE any mutation.
  // A unit whose ciphertext fails GCM authentication with the current
  // ENCRYPTION_KEY would render as null credentials at the API boundary
  // (money for nothing). Refuse the sale instead; the caller's catch
  // rolls back the whole transaction and fires a deduped admin alert.
  //
  // Product shapes are heterogeneous (C1's refund tests pin this):
  //   - account products: email + password;
  //   - code products: the deliverable IS extraDetails (email/password
  //     legitimately null).
  // So a unit is deliverable when at least ONE field is present AND every
  // PRESENT encrypted field decrypts. Legacy PLAINTEXT rows pass through
  // safeDecrypt unchanged — they stay sellable by design.
  const fieldDeliverable = (v: string | null) =>
    v === null || !isEncrypted(v) || safeDecrypt(v) !== null;
  const hasAnyDeliverable =
    inventoryItem.accountPassword !== null ||
    inventoryItem.accountEmail !== null ||
    inventoryItem.extraDetails !== null;
  if (
    !hasAnyDeliverable ||
    !fieldDeliverable(inventoryItem.accountPassword) ||
    !fieldDeliverable(inventoryItem.accountEmail) ||
    !fieldDeliverable(inventoryItem.extraDetails ?? null)
  ) {
    return { ok: false, reason: "INVENTORY_CORRUPT", detail: String(inventoryItem.id) };
  }

  // Atomic inventory claim inside the transaction to prevent races: the
  // guarded UPDATE re-asserts is_sold=false under the row lock.
  const [inv] = await tx
    .update(inventoryTable)
    .set({ isSold: true, soldAt: now })
    .where(and(eq(inventoryTable.id, inventoryItem.id), eq(inventoryTable.isSold, false)))
    .returning();
  if (!inv) return { ok: false, reason: "INVENTORY_CLAIMED" };

  return {
    ok: true,
    unit: {
      email: inventoryItem.accountEmail,
      // At-rest shapes preserved (H2): password/extra stay ciphertext —
      // the API boundary (formatOrder) decrypts; plaintext legacy rows
      // pass through safeDecrypt unchanged.
      password: inventoryItem.accountPassword,
      extraDetails: inventoryItem.extraDetails ?? null,
      inventoryItemId: inventoryItem.id,
      providerOrderId: null,
    },
  };
}

/** The single manual instance — stateless, safe to share. */
export const manualProvider: FulfillmentProvider = {
  id: "manual",
  fulfill: fulfillManual,
};
