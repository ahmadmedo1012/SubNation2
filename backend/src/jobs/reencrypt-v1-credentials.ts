import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { decrypt, encrypt, isV1Blob } from "../lib/encryption";
import { logger } from "../lib/logger";
import { logAdminAlert } from "./alertLogger";

/**
 * R118-B1c (A4 F-2) — one-shot v1→v2 credential re-encryption.
 *
 * The encryption-at-rest format gained a version prefix (v2 = minted by
 * the CURRENT ENCRYPTION_KEY, see lib/encryption.ts). Every pre-R118 blob
 * — including the 15 live credential rows (10 inventory.account_password +
 * 5 orders.delivered_password, live-verified by the R118-A4 audit) — is
 * prefixless v1. This job drains them: decrypt with the current key (or
 * the ENCRYPTION_KEY_PREV rotation fallback), re-encrypt as v2 under the
 * current key, and commit with an OPTIMISTIC conditional UPDATE
 * (`WHERE id = $1 AND <col> = $oldValue`) so a concurrent writer (admin
 * re-uploading stock, checkout copying credentials) can never be
 * clobbered — a raced row simply yields 0 updated rows and stays for the
 * next pass.
 *
 * Idempotent by construction: a v2 blob never matches the scan predicate
 * again, so the second run is a pure no-op (0 candidates, 0 updates).
 * Scheduled as a boot one-shot (jobs/boot-one-shots.ts): leader-gated +
 * sequential like every sibling, safe on every restart.
 *
 * Scope — every column that carries AES-256-GCM ciphertext today
 * (enumerated from the encrypt() call sites: admin/products.ts inventory
 * writes + the checkout at-rest passthrough + R118-B1c's totp_secret):
 *   - inventory.account_password   (admin stock uploads, migrate backfill)
 *   - inventory.extra_details      (F7: deliverable recovery notes/codes)
 *   - orders.delivered_password    (checkout at-rest passthrough)
 *   - orders.delivered_extra_details (same passthrough)
 *   - admin_users.totp_secret      (R118-B1c/A4 F-4, encrypted on setup)
 *
 * Deliberately NOT scanned: inventory.account_email / orders.delivered_email
 * — emails are stored PLAINTEXT BY DESIGN (bulk-import dedup compares them
 * lowercased in SQL); plaintext values never match the v1 predicate anyway,
 * but keeping the email columns out of the scan documents the intent.
 *
 * Undecryptable v1 rows (key mismatch with no ENCRYPTION_KEY_PREV, or
 * corruption) are LEFT UNTOUCHED (never destroyed), counted in the result,
 * and surfaced as a deduped admin alert — the operator fixes the key
 * situation and the next pass picks them up. A v2 upgrade that would not
 * fit the varchar column budget (the +3-char prefix vs a 512-char v1 blob)
 * is treated the same way: fail the row loudly, keep the v1 blob.
 */

type TargetTable = "inventory" | "orders" | "admin_users";
type TargetColumn =
  | "account_password"
  | "extra_details"
  | "delivered_password"
  | "delivered_extra_details"
  | "totp_secret";

interface TargetSpec {
  table: TargetTable;
  column: TargetColumn;
  /**
   * varchar ceiling from the Drizzle schema (text columns: null). The v2
   * prefix adds 3 chars — a legacy blob that exactly filled the column
   * cannot be upgraded in place and is failed loudly instead of 500-ing
   * the boot chain with a 22001.
   */
  maxLength: number | null;
}

const TARGETS: readonly TargetSpec[] = [
  { table: "inventory", column: "account_password", maxLength: 512 },
  { table: "inventory", column: "extra_details", maxLength: null },
  { table: "orders", column: "delivered_password", maxLength: 512 },
  { table: "orders", column: "delivered_extra_details", maxLength: null },
  { table: "admin_users", column: "totp_secret", maxLength: 255 },
];

/**
 * Defensive ceiling per column per run: live volume is ≤ a few hundred
 * rows, but this runs inside the boot chain — a pathological legacy
 * table must not turn the leader's first minutes into a giant UPDATE
 * loop. Leftover rows are picked up by the next boot (idempotent).
 */
const MAX_ROWS_PER_COLUMN = 5000;

export interface V1Candidate {
  table: TargetTable;
  column: TargetColumn;
  id: number;
  /** The v1 blob as READ from the row (the optimistic-WHERE comparand). */
  value: string;
}

export interface ReencryptOutcome {
  /** v1 blobs examined (after the isV1Blob gate). */
  scanned: number;
  /** v1 → v2 commits (conditional UPDATE matched exactly 1 row). */
  upgraded: number;
  /** Conditional UPDATE matched 0 rows — the row changed concurrently; untouched, retried next run. */
  stale: number;
  /** Undecryptable or overlong v1 blobs — LEFT AS-IS (v1), alerted once per run. */
  failed: number;
}

function emptyOutcome(): ReencryptOutcome {
  return { scanned: 0, upgraded: 0, stale: 0, failed: 0 };
}

function mergeOutcome(into: ReencryptOutcome, from: ReencryptOutcome): void {
  into.scanned += from.scanned;
  into.upgraded += from.upgraded;
  into.stale += from.stale;
  into.failed += from.failed;
}

/** node-pg ({ rows }) and pglite (array) result shapes (migrate.ts pattern). */
function resultRows<T>(result: unknown): T[] {
  return (
    (result as { rows?: T[] }).rows ?? (result as unknown as T[]) ?? []
  );
}

function specFor(table: TargetTable, column: TargetColumn): TargetSpec | undefined {
  return TARGETS.find((t) => t.table === table && t.column === column);
}

/**
 * Upgrade a batch of candidate rows. Exported for the concurrency test —
 * the public entry point below always derives candidates from a fresh
 * scan, so a caller passing a STALE candidate (the row already changed)
 * exercises exactly the optimistic-WHERE race window.
 */
export async function upgradeV1Candidates(candidates: V1Candidate[]): Promise<ReencryptOutcome> {
  const outcome = emptyOutcome();
  for (const candidate of candidates) {
    const spec = specFor(candidate.table, candidate.column);
    if (!spec) continue; // unknown target — never touch
    // Belt + braces (the scanner already filters): only v1 blobs move.
    if (!isV1Blob(candidate.value)) continue;
    outcome.scanned += 1;

    let plaintext: string;
    try {
      // Current key first, ENCRYPTION_KEY_PREV fallback second (the
      // rotation window) — both keys live in lib/encryption.ts.
      plaintext = decrypt(candidate.value);
    } catch {
      outcome.failed += 1;
      continue;
    }

    const upgraded = encrypt(plaintext); // v2, current key
    if (spec.maxLength !== null && upgraded.length > spec.maxLength) {
      // The 3-char prefix does not fit — keep the v1 blob (still
      // decryptable!) and fail loudly rather than 22001-ing the chain.
      outcome.failed += 1;
      continue;
    }

    // Optimistic, idempotent commit: the WHERE matches ONLY if the row
    // still holds the exact blob we decrypted. A concurrent admin write
    // (or a second job instance) changed it → 0 rows → stale, untouched.
    // updated_at is bumped explicitly: raw SQL bypasses drizzle's
    // $onUpdate hook (inventory.ts/admin_users.ts write-clock contract).
    const result = await db.execute(sql`
      UPDATE ${sql.raw(spec.table)}
      SET ${sql.raw(spec.column)} = ${upgraded},
          updated_at = now()
      WHERE id = ${candidate.id}
        AND ${sql.raw(spec.column)} = ${candidate.value}
      RETURNING id
    `);
    if (resultRows<{ id: number }>(result).length > 0) {
      outcome.upgraded += 1;
    } else {
      outcome.stale += 1;
    }
  }
  return outcome;
}

/**
 * Scan every encrypted-at-rest column and upgrade its v1 blobs to v2.
 * No-op (all counters zero) when everything is already v2 — the steady
 * state after one successful pass, so every subsequent boot pays only
 * the five cheap NOT LIKE prefiltered SELECTs.
 */
export async function reencryptV1CredentialBlobs(): Promise<ReencryptOutcome> {
  const totals = emptyOutcome();
  for (const spec of TARGETS) {
    // SQL pre-filter (migrate.ts precedent): non-null and not already
    // v2. The JS isV1Blob() gate inside upgradeV1Candidates stays the
    // authoritative, format-exact predicate.
    const result = await db.execute(sql`
      SELECT id, ${sql.raw(spec.column)} AS value
      FROM ${sql.raw(spec.table)}
      WHERE ${sql.raw(spec.column)} IS NOT NULL
        AND ${sql.raw(spec.column)} NOT LIKE 'v2:%'
      ORDER BY id
      LIMIT ${MAX_ROWS_PER_COLUMN + 1}
    `);
    const rows = resultRows<{ id: number; value: string }>(result);
    if (rows.length === 0) continue;
    if (rows.length > MAX_ROWS_PER_COLUMN) {
      logger.warn(
        { category: "security", table: spec.table, column: spec.column, capped: MAX_ROWS_PER_COLUMN },
        `[reencrypt-v1] more than ${MAX_ROWS_PER_COLUMN} candidate rows in ${spec.table}.${spec.column} — processing the first ${MAX_ROWS_PER_COLUMN} this boot, the rest on the next`,
      );
      rows.length = MAX_ROWS_PER_COLUMN;
    }

    const candidates: V1Candidate[] = rows.map((row) => ({
      table: spec.table,
      column: spec.column,
      id: row.id,
      value: row.value,
    }));
    const outcome = await upgradeV1Candidates(candidates);
    mergeOutcome(totals, outcome);
    if (outcome.upgraded > 0 || outcome.failed > 0) {
      logger.info(
        {
          category: "security",
          table: spec.table,
          column: spec.column,
          ...outcome,
        },
        `[reencrypt-v1] ${spec.table}.${spec.column}: upgraded ${outcome.upgraded} v1 blob(s) to v2` +
          (outcome.failed > 0 ? `, ${outcome.failed} undecryptable/overlong left as-is` : "") +
          (outcome.stale > 0 ? `, ${outcome.stale} raced (retry next boot)` : ""),
      );
    }
  }

  if (totals.upgraded > 0) {
    logger.info(
      { category: "security", ...totals },
      `[reencrypt-v1] pass complete: ${totals.upgraded} v1 blob(s) now v2 (current ENCRYPTION_KEY generation)`,
    );
  }
  if (totals.failed > 0) {
    // One deduped drawer alert per day — the condition persists until the
    // operator restores the right key (ENCRYPTION_KEY_PREV) or fixes the
    // corrupt rows; the rows themselves stay v1 and decryptable once the
    // key situation is corrected.
    await logAdminAlert(
      "system",
      "تعذّر ترقية تشفير بيانات اعتماد (v1)",
      `فشلت إعادة تشفير ${totals.failed} قيمة v1 (مفتاح غير مطابق أو تلف). القيم لم تُمس، لكن يلزم ضبط ENCRYPTION_KEY_PREV بمفتاح التشفير السابق ثم إعادة التشغيل.`,
      { dedupeKey: "reencrypt-v1:undecryptable" },
    );
    logger.error(
      { category: "security", failed: totals.failed },
      "[reencrypt-v1] v1 blobs failed to decrypt (left untouched) — set ENCRYPTION_KEY_PREV to the previous key and restart to retry them",
    );
  }
  return totals;
}
