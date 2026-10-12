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
 *   1. `scopeIdempotencyKey` — normalize + per-subject scope (user and
 *      admin ids share the `u{id}:` PK namespace — see its docs).
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
 * into a no-op — the exact pre-F10 behavior. The latch re-arms per
 * process boot (deploy) — precisely when a migration could have landed
 * — AND, since R135 (BE-1, repo audit #9), per HOURLY re-probe: a table
 * dropped/restored MID-process no longer silently disables the guard
 * for the process's whole lifetime. The degraded state is observable
 * (the `idempotency_degraded` Prometheus gauge — 1 while latched, 0
 * when armed) and the re-probe (SELECT 1 FROM idempotency_keys
 * LIMIT 1) clears the latch, flips the gauge back, and logs the
 * recovery the moment the table answers. The re-probe timer exists
 * ONLY while degraded (and is unref'd — it can never keep the process
 * alive), so the healthy path stays timer-free per the repo's
 * free-tier no-timer doctrine (lib/opportunistic.ts docs).
 */

import { db, idempotencyKeysTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
// R135 (BE-1): the degradation gauge + its throwing-safe setter.
import { idempotencyDegraded, safeGaugeSet } from "./metrics";
import { logger } from "./logger";

// Drizzle transaction is structurally compatible with `db` for our
// uses (same convention as lib/ledger.ts).
type DbOrTx = typeof db;

/** Parity with the HTTP middleware's minimum header length. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
/** Client keys are UUID-ish (~36 chars); 128 leaves generous headroom. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Set when the backing table is missing (SQLSTATE 42P01, pre-V1-M12).
 * Latched until re-armed — per process boot (deploy), or per the R135
 * (BE-1) hourly re-probe below once the table answers again — so
 * retrying the probe on every request adds error-path load for zero
 * information.
 */
let tableMissing = false;

// R135 (BE-1, repo audit #9): while the 42P01 latch is set, an hourly
// unref'd re-probe (probeIdempotencyTable) checks whether the table
// came back — the latch previously cleared ONLY at the next process
// boot, so a mid-process DROP silently disabled the durable dedup
// guard for the process's whole lifetime. The timer is armed by
// latchTableMissing() and torn down by clearTableMissing(), so the
// healthy path never carries a timer (the repo's free-tier no-timer
// doctrine, lib/opportunistic.ts docs) and a degraded process
// self-heals within the hour without a restart.
const REPROBE_INTERVAL_MS = 60 * 60 * 1000;
let reprobeTimer: NodeJS.Timeout | null = null;

/** Set the 42P01 latch: guard off, gauge 1, hourly re-probe armed. */
function latchTableMissing(): void {
  tableMissing = true;
  safeGaugeSet(idempotencyDegraded, 1);
  if (!reprobeTimer) {
    reprobeTimer = setInterval(() => void probeIdempotencyTable(), REPROBE_INTERVAL_MS);
    // Never keep the process alive for the re-probe alone.
    reprobeTimer.unref?.();
  }
}

/** Clear the 42P01 latch: guard re-armed, gauge 0, re-probe stopped. */
function clearTableMissing(): void {
  tableMissing = false;
  safeGaugeSet(idempotencyDegraded, 0);
  if (reprobeTimer) {
    clearInterval(reprobeTimer);
    reprobeTimer = null;
  }
}

/**
 * Cheap liveness probe for the backing table (R135 BE-1):
 * `SELECT 1 FROM idempotency_keys LIMIT 1`. Returns true when the table
 * answers — clearing the latch + gauge + re-probe timer when the guard
 * was degraded — and false while it is still missing (or the probe
 * itself failed: stays degraded). Never throws. Production callers are
 * the hourly latch timer; exported for the degradation tests.
 */
export async function probeIdempotencyTable(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM idempotency_keys LIMIT 1`);
    if (tableMissing) {
      logger.warn(
        "idempotency_keys table is back — durable idempotency guard re-armed (idempotency_degraded → 0)",
      );
      clearTableMissing();
    }
    return true;
  } catch (err) {
    if (tableMissing) {
      logger.warn(
        { err },
        "idempotency re-probe: idempotency_keys still unavailable — guard stays degraded (idempotency_degraded stays 1)",
      );
    }
    return false;
  }
}

/**
 * Test-only: re-arm the 42P01 probe after a test creates the table.
 * R135 (BE-1): routes through clearTableMissing() so the latch, the
 * idempotency_degraded gauge, and the re-probe timer can never
 * disagree between tests.
 */
export function __resetIdempotencyTableProbeForTests(): void {
  clearTableMissing();
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
 * Normalize + scope a client-supplied Idempotency-Key to one subject:
 * `u{subjectId}:{key}`. Subjects are userIds (checkout, topups, loyalty)
 * AND adminIds (the admin wallet-adjustment path) — the `u{…}:` prefix
 * does NOT encode subject kind, so admin N and user N sending the same
 * raw key string share ONE durable PK (unlike the HTTP middleware's
 * Redis keys, which bake in `admin:`/`user:`). A cross-subject reuse is
 * therefore a collision, and it is CLASSIFIED, never replayed: the
 * 409 pre-check or the in-tx 23505 surfaces, and the referenceType
 * filter keeps one subject's row from ever resolving for the other
 * intent — a liveness papercut (pick a fresh key), not a money-safety
 * hole. The shared namespace is the frozen on-disk contract (existing
 * rows live in it), so it is documented here rather than re-keyed.
 * What the scoping does guarantee: two DIFFERENT ids never alias each
 * other's rows (the IDOR-flavored replay leak it was built for).
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
export async function findIdempotentOrderId(
  scopedKey: string,
  referenceType?: string,
): Promise<{ orderId: number | null; bodyHash: string | null } | null> {
  if (tableMissing) return null;
  try {
    // RT-2 (R104 red team): filter by referenceType when the caller knows
    // its intent — a client reusing one Idempotency-Key across /orders and
    // /topups must never replay the OTHER intent's row. Undefined keeps
    // the historical any-type behavior for existing callers.
    //
    // R134 (A7-F4): the row now carries bodyHash so the caller can apply
    // the durable reuse predicate (match/NULL → replay, mismatch → 409).
    const conditions =
      referenceType !== undefined
        ? and(
            eq(idempotencyKeysTable.key, scopedKey),
            eq(idempotencyKeysTable.referenceType, referenceType),
          )
        : eq(idempotencyKeysTable.key, scopedKey);
    const [row] = await db
      .select({ orderId: idempotencyKeysTable.orderId, bodyHash: idempotencyKeysTable.bodyHash })
      .from(idempotencyKeysTable)
      .where(conditions)
      .limit(1);
    return row?.orderId !== undefined
      ? { orderId: row.orderId, bodyHash: row.bodyHash ?? null }
      : null;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      // R135 (BE-1): latch through the helper so the gauge + hourly
      // re-probe arm together with the flag.
      latchTableMissing();
      logger.warn(
        "idempotency_keys table missing (pre-V1-M12) — checkout idempotency degrades to legacy pass-through",
      );
      return null;
    }
    throw err;
  }
}

/**
 * R102 (loyalty durable guard): pre-transaction existence check — has
 * this (user-scoped) key been claimed by ANY intent (order or otherwise)?
 * Unlike findIdempotentOrderId this covers loyalty claims (order_id
 * NULL) too. Same 42P01 tolerance.
 *
 * R134 (A7-F4): returns the row (key + bodyHash) so the caller can
 * apply the durable reuse predicate; `truthy row` still works as the
 * old claimed/not-claimed answer.
 */
export async function findIdempotencyClaimed(
  scopedKey: string,
): Promise<{ key: string; bodyHash: string | null } | null> {
  if (tableMissing) return null;
  try {
    const [row] = await db
      .select({ key: idempotencyKeysTable.key, bodyHash: idempotencyKeysTable.bodyHash })
      .from(idempotencyKeysTable)
      .where(eq(idempotencyKeysTable.key, scopedKey))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      // R135 (BE-1): latch through the helper so the gauge + hourly
      // re-probe arm together with the flag.
      latchTableMissing();
      logger.warn(
        "idempotency_keys table missing (pre-V1-M12) — durable idempotency degrades to legacy pass-through",
      );
      return null;
    }
    throw err;
  }
}

/**
 * Claim the key INSIDE the money transaction (call after the ledger
 * insert so the claim commits atomically with it — a rollback releases
 * the key for the client's next retry).
 *
 * R102: orderId is nullable + referenceType discriminates the intent —
 * checkout claims ('<orderId>', 'order'); loyalty claims (null,
 * 'loyalty.convert'). Existing callers pass only (client, key, orderId)
 * and default to 'order' — byte-identical behavior.
 *
 * R134 (A7-F4): bodyHash (trailing optional — every existing 3-4-arg
 * call stays byte-identical) stores the request body's canonical hash
 * so the durable reuse predicate can fire on later lookups. Computed
 * at the ROUTE layer off req.body (lib/idempotency-body-hash.ts) and
 * threaded through — the services never re-derive it.
 *
 * No-op while the table is missing. A concurrent same-key winner throws
 * SQLSTATE 23505 — checkout maps it to the idempotent-replay path;
 * loyalty maps it to a 409 "already converted".
 */
export async function claimIdempotencyKey(
  client: DbOrTx,
  scopedKey: string,
  orderId: number | null,
  referenceType: string = "order",
  bodyHash?: string | null,
): Promise<void> {
  if (tableMissing) return;
  await client
    .insert(idempotencyKeysTable)
    .values({ key: scopedKey, orderId, referenceType, bodyHash: bodyHash ?? null });
}
