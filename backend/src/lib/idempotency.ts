/**
 * Durable idempotency guard for the money path — F10 (round-94 A4).
 *
 * The HTTP-layer middleware (middlewares/idempotency.ts) dedupes via
 * Redis (24h TTL, header-gated): valuable, but soft. A cache flush, a
 * Redis outage, a slow client retry after the TTL, or any non-UI
 * client skips it entirely — and `POST /api/orders` then charges per
 * request ("double-fire = two purchases, two debits"). This module is
 * the transactional backstop the inspection asked for:
 *
 *   1. `scopeIdempotencyKey` — normalize + per-user scope.
 *   2. `findIdempotentOrderId` — pre-tx lookup: a retry with a key that
 *      already created an order replays that order instead of
 *      re-pricing/re-charging (crucially, this also short-circuits
 *      INSUFFICIENT_BALANCE on a retry whose original debit already
 *      landed — the buyer gets their order back, not a scary error).
 *   3. `claimIdempotencyKey` — INSERT inside the caller's transaction,
 *      committing atomically with the order + ledger. A concurrent
 *      same-key winner surfaces as SQLSTATE 23505 which the caller
 *      maps to a replay (or a retryable 409 if the original can't be
 *      reconstructed) — never a second charge.
 *
 * Degradation contract (money never breaks, deploys never block):
 * until migration V1-M12 creates `idempotency_keys`, every SQLSTATE
 * 42P01 (undefined table) is caught, remembered, and the guard turns
 * into a no-op — the exact pre-F10 behavior. The probe is re-armed
 * only per process boot (deploy) which is precisely when a migration
 * could have landed.
 */

import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
// Direct import (NOT via schema/index.ts) — see the schema module docs:
// the table is registered in the barrel + created by migration V1-M12
// in a later step; drizzle queries against a pgTable object do not
// require registry membership.
import { idempotencyKeysTable } from "../../../shared/db/src/schema/idempotency-keys";

// Drizzle transaction is structurally compatible with `db` for our
// uses (same convention as lib/ledger.ts).
type DbOrTx = typeof db;

/** Parity with the HTTP middleware's minimum header length. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
/** Client keys are UUID-ish (~36 chars); 128 leaves generous headroom. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Set when the backing table is missing (SQLSTATE 42P01, pre-V1-M12).
 * Latched per process: a deploy is the only moment the table can
 * appear, so retrying the probe on every request adds error-path load
 * for zero information.
 */
let tableMissing = false;

/** Test-only: re-arm the 42P01 probe after a test creates the table. */
export function __resetIdempotencyTableProbeForTests(): void {
  tableMissing = false;
}

/**
 * Two-level unwrap mirroring TopupService's isDuplicatePaymentReference
 * violation helper: drizzle wraps driver errors (DrizzleQueryError)
 * with the driver error preserved on `.cause`; node-postgres exposes
 * the SQLSTATE directly, pglite on the wrapped cause.
 */
function pgErrorParts(err: unknown): { code?: string; constraint?: string } {
  const wrapper = err as { code?: string; constraint?: string; cause?: unknown } | null;
  const driver = (wrapper?.cause ?? err) as { code?: string; constraint?: string } | null;
  return driver?.code ? { code: driver.code, constraint: driver.constraint } : { ...wrapper };
}

/** SQLSTATE 42P01 — relation does not exist (table not migrated yet). */
function isUndefinedTableError(err: unknown): boolean {
  return pgErrorParts(err).code === "42P01";
}

/**
 * SQLSTATE 23505 on the idempotency_keys primary key — a same-key
 * purchase committed concurrently. Constraint name is checked when
 * present so an unrelated 23505 on this statement (none exists today)
 * is not misrouted to the replay path; when the driver omits the name
 * we follow the topup helper's convention and claim it.
 */
export function isIdempotencyKeyViolation(err: unknown): boolean {
  const { code, constraint } = pgErrorParts(err);
  if (code !== "23505") return false;
  if (!constraint) return true;
  return /idempotency_keys/i.test(constraint);
}

/**
 * Normalize + scope a client-supplied Idempotency-Key to one buyer:
 * `u{userId}:{key}`. Scoping mirrors the middleware's subject-scoped
 * Redis keys — two users sending the same key string must never
 * alias each other's orders (an IDOR-flavored replay leak).
 *
 * Returns null when the raw key is absent/undersized/oversized — the
 * caller then runs the legacy (pre-F10) unguarded path, exactly like a
 * request without the header.
 */
export function scopeIdempotencyKey(userId: number, rawKey: string | undefined): string | null {
  if (typeof rawKey !== "string") return null;
  const trimmed = rawKey.trim();
  if (trimmed.length < IDEMPOTENCY_KEY_MIN_LENGTH) return null;
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) return null;
  return `u${userId}:${trimmed}`;
}

/**
 * Pre-transaction lookup: which order did this (user-scoped) key
 * create, if any? Returns the orderId to replay, or null when the key
 * is fresh OR the backing table is missing (42P01 → legacy behavior,
 * latched — see module docs).
 */
export async function findIdempotentOrderId(scopedKey: string): Promise<number | null> {
  if (tableMissing) return null;
  try {
    const [row] = await db
      .select({ orderId: idempotencyKeysTable.orderId })
      .from(idempotencyKeysTable)
      .where(eq(idempotencyKeysTable.key, scopedKey))
      .limit(1);
    return row?.orderId ?? null;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      tableMissing = true;
      logger.warn(
        "idempotency_keys table missing (pre-V1-M12) — checkout idempotency degrades to legacy pass-through",
      );
      return null;
    }
    throw err;
  }
}

/**
 * Claim the key INSIDE the purchase transaction (call after the order
 * + ledger inserts so the claim commits atomically with them — a
 * rollback releases the key for the client's next retry).
 *
 * No-op while the table is missing. A concurrent same-key winner
 * throws SQLSTATE 23505 — the caller (checkout) maps it to the
 * idempotent-replay path.
 */
export async function claimIdempotencyKey(
  client: DbOrTx,
  scopedKey: string,
  orderId: number,
): Promise<void> {
  if (tableMissing) return;
  await client.insert(idempotencyKeysTable).values({ key: scopedKey, orderId });
}
