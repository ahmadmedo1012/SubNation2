import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { decryptForRotation, encrypt, isPrevKeyConfigured, isV1Blob } from "../lib/encryption";
import { logger } from "../lib/logger";
import { logAdminAlert } from "./alertLogger";

/**
 * R118-B1c (A4 F-2) — one-shot v1→v2 credential re-encryption.
 * R119-B1 (A1 F-1) — SECOND pass: mid-rotation v2 re-keying.
 *
 * The encryption-at-rest format gained a version prefix (v2 = minted by
 * the CURRENT ENCRYPTION_KEY, see lib/encryption.ts). Every pre-R118 blob
 * — including the 15 live credential rows (10 inventory.account_password +
 * 5 orders.delivered_password, live-verified by the R118-A4 audit) — is
 * prefixless v1. The FIRST pass drains them: decrypt with the current key
 * (or the ENCRYPTION_KEY_PREV rotation fallback), re-encrypt as v2 under
 * the current key, and commit with an OPTIMISTIC conditional UPDATE
 * (`WHERE id = $1 AND <col> = $oldValue`) so a concurrent writer (admin
 * re-uploading stock, checkout copying credentials) can never be
 * clobbered — a raced row simply yields 0 updated rows and stays for the
 * next pass.
 *
 * R119-B1 (A1 F-1): that design was SINGLE-SHOT. Once the first rotation
 * completed, every blob on disk was v2 — and the R118 scan predicate
 * (`NOT LIKE 'v2:%'` + the isV1Blob gate) meant a SECOND rotation found
 * nothing to fix while every v2 blob minted by the old key sat orphaned:
 * checkout refused all sales (INVENTORY_CORRUPT), buyer/admin reveals
 * degraded to decrypt_failed, admin 2FA (totp_secret, now v2) failed
 * behind a misleading wrong-code 401 — and this job reported ZERO
 * failures because nothing matched its v1 scan (R119-A1 finding P1).
 * The SECOND pass closes the gap: while ENCRYPTION_KEY_PREV is armed it
 * scans the SAME credential columns for v2-prefixed rows, and every row
 * whose current-key decrypt fails but PREV-key decrypt succeeds (i.e.
 * minted by the previous key before the switch — mid-rotation material)
 * is re-encrypted to v2 under the CURRENT key through the exact same
 * machinery (optimistic WHERE guard, varchar budget guard, 5000-row cap
 * with next-boot continuation, deduped admin alert on failures). With
 * PREV unset the pass does not even SCAN — steady-state boot cost is
 * byte-for-byte the R118 ship (five cheap NOT LIKE prefiltered SELECTs).
 * Rows dead under BOTH keys land in their own failed bucket with a
 * DISTINCT alert (reencrypt-v2:undecryptable) so the operator can tell
 * “v1 undecryptable” from “v2 undecryptable under both keys” apart.
 *
 * Idempotent by construction: a v2 blob never matches the v1 scan
 * predicate again, and a re-keyed v2 blob decrypts under the current key
 * on the next pass (probe → "current" → skip, byte-identical). The
 * second run is therefore a pure no-op in effect; while PREV stays armed
 * the v2 pass still pays one current-key decrypt attempt per encrypted
 * v2 row (bounded by the same 5000-per-column cap) — acceptable during
 * the rare rotation window, zero cost in the steady state.
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
 * Undecryptable rows (key mismatch with no ENCRYPTION_KEY_PREV, or
 * corruption) are LEFT UNTOUCHED (never destroyed), counted in the result,
 * and surfaced as a deduped admin alert — the operator fixes the key
 * situation and the next pass picks them up. A v2 upgrade that would not
 * fit the varchar column budget (the +3-char prefix vs a 512-char v1 blob)
 * is treated the same way: fail the row loudly, keep the original blob.
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

/**
 * R119-B1 (A1 F-1): same row shape as V1Candidate, but `value` is a
 * v2-prefixed blob — the mid-rotation scan's material (a v2 blob minted
 * by the PREVIOUS key before a rotation switch).
 */
export type V2Candidate = V1Candidate;

export interface ReencryptOutcome {
  /** Candidate blobs examined (after the pass's gate — isV1Blob / v2 prefix). */
  scanned: number;
  /** Re-encrypt commits (conditional UPDATE matched exactly 1 row). */
  upgraded: number;
  /** Conditional UPDATE matched 0 rows — the row changed concurrently; untouched, retried next run. */
  stale: number;
  /** Undecryptable or overlong blobs — LEFT AS-IS, alerted once per run. */
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
  return (result as { rows?: T[] }).rows ?? (result as unknown as T[]) ?? [];
}

function specFor(table: TargetTable, column: TargetColumn): TargetSpec | undefined {
  return TARGETS.find((t) => t.table === table && t.column === column);
}

/** How a single conditional re-encrypt commit landed. */
type CommitResult = "upgraded" | "stale" | "overlong";

/**
 * Shared conditional re-encrypt commit (R119-B1, A1 F-1 — extracted from
 * upgradeV1Candidates so the v2 pass reuses the EXACT same machinery):
 * re-encrypt the plaintext as v2 under the CURRENT key, varchar-budget
 * guard (keep the original blob, fail loudly — never 22001 the boot
 * chain), and the optimistic `WHERE id AND col = oldValue` commit that a
 * concurrent writer can never lose to. updated_at is bumped explicitly:
 * raw SQL bypasses drizzle's $onUpdate hook (inventory.ts/admin_users.ts
 * write-clock contract).
 */
async function commitReencryptedBlob(
  spec: TargetSpec,
  id: number,
  oldValue: string,
  plaintext: string,
): Promise<CommitResult> {
  const upgraded = encrypt(plaintext); // v2, current key
  if (spec.maxLength !== null && upgraded.length > spec.maxLength) {
    // The re-encrypted form does not fit — keep the original blob (still
    // decryptable via its own key path!) and fail loudly rather than
    // 22001-ing the chain. Length-neutral in practice for the v2 pass
    // (v2→v2 keeps the +3 prefix); the guard stays for the v1 pass's
    // legacy edge and for schema-narrowed columns.
    return "overlong";
  }
  const result = await db.execute(sql`
    UPDATE ${sql.raw(spec.table)}
    SET ${sql.raw(spec.column)} = ${upgraded},
        updated_at = now()
    WHERE id = ${id}
      AND ${sql.raw(spec.column)} = ${oldValue}
    RETURNING id
  `);
  return resultRows<{ id: number }>(result).length > 0 ? "upgraded" : "stale";
}

/** Fold a commit result into the outcome counters (shared by both passes). */
function countCommit(outcome: ReencryptOutcome, commit: CommitResult): void {
  if (commit === "upgraded") {
    outcome.upgraded += 1;
  } else if (commit === "stale") {
    outcome.stale += 1;
  } else {
    outcome.failed += 1; // overlong — kept as-is, alerted once per run
  }
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

    // R119-B1 (A1 F-1): the tri-state probe runs the same current-key +
    // ENCRYPTION_KEY_PREV ladder decrypt() uses (both keys live in
    // lib/encryption.ts); "undecryptable" = wrong key with no working
    // fallback, or corruption.
    const probe = decryptForRotation(candidate.value);
    if (probe.status === "undecryptable") {
      outcome.failed += 1;
      continue;
    }

    countCommit(
      outcome,
      await commitReencryptedBlob(spec, candidate.id, candidate.value, probe.plaintext!),
    );
  }
  return outcome;
}

/**
 * R119-B1 (A1 F-1) — re-key a batch of scanned v2 rows. Exported for the
 * rotation/concurrency tests exactly like upgradeV1Candidates: a caller
 * passing a STALE candidate (the row already changed) exercises the
 * optimistic-WHERE race window. Only v2-prefixed values move; a row that
 * already decrypts under the CURRENT key ("current") is left
 * byte-identical — the pass re-keys MID-ROTATION material, it never
 * rewrites the steady state.
 */
export async function upgradeV2Candidates(candidates: V2Candidate[]): Promise<ReencryptOutcome> {
  const outcome = emptyOutcome();
  for (const candidate of candidates) {
    const spec = specFor(candidate.table, candidate.column);
    if (!spec) continue; // unknown target — never touch
    // Belt + braces (the scanner already filters): only v2-prefixed rows.
    if (!candidate.value.startsWith("v2:")) continue;
    outcome.scanned += 1;

    const probe = decryptForRotation(candidate.value);
    if (probe.status === "current") {
      // Already minted by the current key — nothing to do. This is the
      // steady state; skipping keeps the pass idempotent (a re-keyed blob
      // lands here on the next boot) and byte-identical (no churn write,
      // no updated_at bump, no audit noise).
      continue;
    }
    if (probe.status === "undecryptable") {
      // Both keys dead: corruption, or a blob older than
      // ENCRYPTION_KEY_PREV (two rotations back). Red flag — its own
      // failed bucket + DISTINCT v2 alert below, so the operator can
      // tell it apart from the v1 undecryptables.
      outcome.failed += 1;
      continue;
    }

    // probe.status === "prev": minted by the previous key before the
    // switch — mid-rotation material. Re-key to v2 under the CURRENT key
    // through the same commit machinery as the v1 pass.
    countCommit(
      outcome,
      await commitReencryptedBlob(spec, candidate.id, candidate.value, probe.plaintext!),
    );
  }
  return outcome;
}

/**
 * Scan every encrypted-at-rest column and upgrade its v1 blobs to v2.
 * No-op (all counters zero) when everything is already v2 — the steady
 * state after one successful pass, so every subsequent boot pays only
 * the five cheap NOT LIKE prefiltered SELECTs.
 *
 * R119-B1 (A1 F-1): the boot one-shot now ALSO drains the mid-rotation
 * v2 pass below (while ENCRYPTION_KEY_PREV is armed) — boot-one-shots.ts
 * still registers only this entry point. The returned counters stay the
 * v1 pass's own (the shape every existing caller/logs was built around);
 * the v2 pass reports through its own log lines + alert.
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
        {
          category: "security",
          table: spec.table,
          column: spec.column,
          capped: MAX_ROWS_PER_COLUMN,
        },
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

  // R119-B1 (A1 F-1): rotation #2+ survival — after draining v1, re-key
  // every v2 blob the PREVIOUS key minted. Runs ONLY while the fallback
  // is armed (inside, it re-checks and will not even scan otherwise), so
  // the steady state (PREV unset) is byte-for-byte the R118 boot cost.
  await reencryptMidRotationV2Blobs();
  return totals;
}

/**
 * R119-B1 (A1 F-1) — the SECOND pass: re-key mid-rotation v2 blobs.
 *
 * Runs ONLY while ENCRYPTION_KEY_PREV is armed (set + 32-byte hex — the
 * exact predicate decrypt()'s fallback uses); when it is not, this pass
 * must NOT EVEN SCAN, so a steady-state boot pays nothing. While armed,
 * it scans the same credential columns as the v1 pass for v2-prefixed
 * rows and attempts a current-key decrypt per row (bounded by the same
 * MAX_ROWS_PER_COLUMN cap; one GCM op per steady-state row, a cheap
 * price during the rare rotation window):
 *
 *   - current-key decrypt OK  → already current-generation material;
 *     skipped byte-identically (idempotence — a re-keyed blob lands here
 *     on the next boot, so repeated runs never churn);
 *   - current-key FAILS, PREV OK → mid-rotation v2 blob (minted by the
 *     previous key before the switch) — re-encrypted to v2 under the
 *     CURRENT key via the same optimistic-WHERE + varchar-guard commit
 *     as the v1 pass;
 *   - BOTH fail → the failed bucket with a DISTINCT alert: corruption,
 *     or a blob two rotations old that ENCRYPTION_KEY_PREV cannot reach.
 *     Left untouched, never destroyed — same keep-and-alert contract as
 *     v1 undecryptables, but the operator must be able to tell the two
 *     conditions apart (hence the separate dedupe key + message).
 */
export async function reencryptMidRotationV2Blobs(): Promise<ReencryptOutcome> {
  if (!isPrevKeyConfigured()) {
    // Steady state — not even a scan (R119-B1, A1 F-1: the boot-cost
    // contract). Everything below is rotation-window-only work.
    return emptyOutcome();
  }

  const totals = emptyOutcome();
  for (const spec of TARGETS) {
    // Same pre-filter shape as the v1 scan, inverted: v2-prefixed rows
    // only (LIKE already excludes NULL). Includes v2-SHAPED GARBAGE by
    // design — such a row can never decrypt under ANY key, and surfacing
    // it in the failed bucket below is the first time anything would
    // have alerted on it.
    const result = await db.execute(sql`
      SELECT id, ${sql.raw(spec.column)} AS value
      FROM ${sql.raw(spec.table)}
      WHERE ${sql.raw(spec.column)} LIKE 'v2:%'
      ORDER BY id
      LIMIT ${MAX_ROWS_PER_COLUMN + 1}
    `);
    const rows = resultRows<{ id: number; value: string }>(result);
    if (rows.length === 0) continue;
    if (rows.length > MAX_ROWS_PER_COLUMN) {
      logger.warn(
        {
          category: "security",
          table: spec.table,
          column: spec.column,
          capped: MAX_ROWS_PER_COLUMN,
        },
        `[reencrypt-v2] more than ${MAX_ROWS_PER_COLUMN} v2-prefixed rows in ${spec.table}.${spec.column} — processing the first ${MAX_ROWS_PER_COLUMN} this boot, the rest on the next`,
      );
      rows.length = MAX_ROWS_PER_COLUMN;
    }

    const candidates: V2Candidate[] = rows.map((row) => ({
      table: spec.table,
      column: spec.column,
      id: row.id,
      value: row.value,
    }));
    const outcome = await upgradeV2Candidates(candidates);
    mergeOutcome(totals, outcome);
    if (outcome.upgraded > 0 || outcome.failed > 0) {
      logger.info(
        {
          category: "security",
          table: spec.table,
          column: spec.column,
          ...outcome,
        },
        `[reencrypt-v2] ${spec.table}.${spec.column}: re-keyed ${outcome.upgraded} mid-rotation v2 blob(s) under the current ENCRYPTION_KEY` +
          (outcome.failed > 0
            ? `, ${outcome.failed} undecryptable under both keys left as-is`
            : "") +
          (outcome.stale > 0 ? `, ${outcome.stale} raced (retry next boot)` : ""),
      );
    }
  }

  if (totals.upgraded > 0) {
    logger.info(
      { category: "security", ...totals },
      `[reencrypt-v2] pass complete: ${totals.upgraded} v2 blob(s) minted by the previous key are now v2 under the current ENCRYPTION_KEY`,
    );
  }
  if (totals.failed > 0) {
    // Same keep-and-alert contract as the v1 undecryptables, but with a
    // DISTINCT dedupe key + message: a v2 blob dead under BOTH keys is a
    // different diagnosis (corruption, or material older than
    // ENCRYPTION_KEY_PREV — setting PREV to the previous key will NOT
    // rescue it), and the operator must not chase the v1 fix for it.
    await logAdminAlert(
      "system",
      "قيم v2 غير قابلة لفك التشفير (المفتاحان الحالي والسابق)",
      `فشل فك تشفير ${totals.failed} قيمة v2 بالمفتاح الحالي وبالمفتاح السابق معًا (تلف في البيانات، أو مفتاح أقدم من ENCRYPTION_KEY_PREV). القيم لم تُمس، لكن ضبط ENCRYPTION_KEY_PREV وحده لن يستعيدها — يلزم التحقق من المفاتيح الأقدم أو إصلاح الصفوف يدويًا ثم إعادة التشغيل.`,
      { dedupeKey: "reencrypt-v2:undecryptable" },
    );
    logger.error(
      { category: "security", failed: totals.failed },
      "[reencrypt-v2] v2 blobs failed to decrypt under BOTH the current and previous keys (left untouched) — corruption, or the blob predates ENCRYPTION_KEY_PREV; setting PREV to the previous key will not rescue these rows",
    );
  }
  return totals;
}
