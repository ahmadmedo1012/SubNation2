/**
 * Fulfillment provider boundary (R102, provider-readiness phase).
 *
 * THE SEAM: today fulfillment is synchronous and local — checkout claims a
 * pre-uploaded inventory unit INSIDE the purchase transaction and copies
 * its credentials onto the order row. The next phase connects an external
 * provider (the sourcing supplier's reseller API). This module declares
 * the boundary between the two worlds so the checkout transaction never
 * learns provider specifics, and no provider ever rewrites checkout.
 *
 * DESIGN RULES (from the project directive):
 *   - No provider is implemented here — no fake endpoints, no invented
 *     API shapes, no credentials. The ONLY implementation today is
 *     ManualProvider (manual.provider.ts), which reproduces the current
 *     in-transaction claim verbatim.
 *   - `fulfill()` is the ONE required method and it runs INSIDE the
 *     purchase transaction (`tx`) — it must be local-first: no network
 *     I/O, or (for a future async provider) a bounded local reservation
 *     whose network settlement happens post-commit. A provider that
 *     blocks the transaction on an external API is a design bug.
 *   - Optional capabilities are signaled by the presence of their method
 *     (no boolean flags to drift out of sync): syncCatalog for catalog
 *     synchronization, queryStatus for async settlement polling, release
 *     for provider-side refund/recovery.
 *   - Provider identity and provider order references are OPERATOR-ONLY
 *     data — never serialized to any public DTO (pinned by tests).
 *   - Provider-level idempotency rides the DB: the
 *     uniq_provider_fulfillments_provider_order index (plain UNIQUE:
 *     non-null provider orders dedup, manual NULL rows coexist)
 *     makes one provider order attachable to at most one SubNation order.
 */

import type { db } from "@workspace/db";

/**
 * The transaction handle providers run inside. Same idiom as
 * lib/ledger.ts's DbOrTx — drizzle transaction objects are passed with a
 * `tx as unknown as typeof db` cast by the caller.
 */
export type ProviderTx = typeof db;

/** What the provider is asked to fulfill — one unit of one order. */
export interface FulfillmentRequest {
  /** The store product being purchased (inventory/product scoping). */
  productId: number;
  /** The exact option purchased, or null for undifferentiated stock. */
  variantId: number | null;
  /** The in-transaction clock — the soldAt stamp (never Date.now() inside a tx). */
  now: Date;
}

/**
 * A delivered unit. Credential fields carry the SAME at-rest shapes as the
 * local inventory columns today: email may be plaintext (legacy) or
 * ciphertext, password/extraDetails are AES-256-GCM ciphertext — the
 * provider returns values AS THEY SHOULD BE STORED on orders.delivered_*,
 * never plaintext secrets it decrypted itself (H2 contract).
 */
export interface FulfilledUnit {
  email: string | null;
  password: string | null;
  extraDetails: string | null;
  /**
   * The claimed LOCAL inventory unit, when the provider fulfilled from
   * local stock (manual always sets it; a pure external provider sets
   * null and orders.inventoryId stays null).
   */
  inventoryItemId: number | null;
  /**
   * The provider's own order reference — the durable idempotency anchor
   * for provider retries. Null for local/manual fulfillment.
   */
  providerOrderId: string | null;
}

/** Failure vocabulary rides the EXISTING CheckoutFailureReason members. */
export type FulfillmentFailureReason =
  /** No deliverable unit available (pre-tx fast-fail + in-tx race both). */
  | "OUT_OF_STOCK"
  /** The locked unit was claimed between lock and guarded update. */
  | "INVENTORY_CLAIMED"
  /** The unit exists but its credentials are undeliverable (fail-closed). */
  | "INVENTORY_CORRUPT"
  /** Reserved for a future async provider that cannot accept the order. */
  | "PROVIDER_UNAVAILABLE";

export type FulfillmentResult =
  | { ok: true; unit: FulfilledUnit }
  | { ok: false; reason: FulfillmentFailureReason; detail?: string };

/**
 * A fulfillment provider. Checkout calls ONLY `fulfill()` today; the
 * optional methods are the declared boundary for the provider phase.
 */
export interface FulfillmentProvider {
  /** Stable identity — recorded on provider_fulfillments.provider. */
  readonly id: string;

  /**
   * Claim/deliver one unit inside the purchase transaction. MUST be
   * idempotent per (provider, provider_order_id) and MUST NOT perform
   * unbounded network I/O. Throws only on programming errors — business
   * refusals come back as { ok: false } so the caller's catch maps them
   * to the stable checkout failure codes.
   */
  fulfill(req: FulfillmentRequest, tx: ProviderTx): Promise<FulfillmentResult>;

  /**
   * OPTIONAL — provider catalog synchronization (pull products/plans/
   * availability into the local catalog). Absent on ManualProvider.
   */
  syncCatalog?(tx: ProviderTx): Promise<{ created: number; updated: number; skipped: number }>;

  /**
   * OPTIONAL — async settlement polling for providers that return
   * 'pending'. Absent on ManualProvider (fulfillment is synchronous).
   */
  queryStatus?(providerOrderId: string): Promise<"pending" | "succeeded" | "failed">;

  /**
   * OPTIONAL — provider-side refund/recovery (return the unit to the
   * provider). Absent on ManualProvider: today's refund semantics are
   * revoke-not-return by design (B2-03 — the buyer already saw the
   * credentials; the operator rotates them instead).
   */
  release?(providerOrderId: string): Promise<void>;
}
