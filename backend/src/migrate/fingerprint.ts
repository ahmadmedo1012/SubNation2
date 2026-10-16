// R144-B2: moved verbatim from src/migrate.ts (original lines 7–156).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { constraintSkipKeys } from "../migrate";
import { extractRows } from "./shared";

/**
 * R104 (AG5-1 / AG6-1 — cold-start fast-path): build-time fingerprint of
 * the migration corpus, injected by build.mjs as an esbuild `define`.
 * Steady-state cold starts were paying ~141 sequential no-op DB round trips
 * (2-7 s on 0.1 CPU + a cold Neon resume) on EVERY Render free-tier wake —
 * the dominant readiness cost.
 *
 * r110 (109-e P2-2): the marker is now a VERSIONED COMPOSITE —
 * `v2:<codeHash>:<schemaHash>` — computed at build time by build.mjs.
 *   - <codeHash>  = sha256 of src/migrate.ts (the migration engine);
 *   - <schemaHash> = sha256 of shared/db/src/schema/*.ts + the emitted
 *     drizzle chain (shared/db/drizzle/*.sql + meta/*), so OUT-OF-BAND
 *     schema/SQL edits (a schema TS tweak, a regenerated chain, a hand
 *     edit to a chain file) also invalidate the fast-path, not just
 *     migrate.ts edits.
 * Markers written by older builds (bare 64-hex, no schema component)
 * naturally FAIL the strict-equality compare → exactly one full
 * reconcile → the v2 marker is written. No legacy marker is ever
 * parsed, so the upgrade path cannot crash.
 *
 * When the marker matches the value persisted in system_settings after
 * the last successful full reconcile, runMigrations() skips the entire
 * replay. Any edit to the corpus changes the hash → one full reconcile
 * on the next boot → new hash persisted. Tests/dev (no define) see
 * `undefined` → always full run, semantics unchanged.
 * `MIGRATIONS_FORCE_RECONCILE` (true/1/yes — R108 accepts all three)
 * bypasses the fast-path; deleting the system_settings row forces a
 * full reconcile too.
 *
 * r110 (109-e P2-1): the marker is persisted ONLY when the run fully
 * reconciled — a run that took any constraint-skip alert path (probe →
 * alert instead of ALTER) leaves the stored marker UNTOUCHED so the
 * next boot re-runs the reconcile and actually applies what was
 * skipped ("reboot to apply" must not silently no-op on the fast-path).
 */
declare const __MIGRATIONS_FINGERPRINT__: string | undefined;

export let MIGRATIONS_FINGERPRINT: string | undefined =
  typeof __MIGRATIONS_FINGERPRINT__ === "string" && __MIGRATIONS_FINGERPRINT__.length > 0
    ? __MIGRATIONS_FINGERPRINT__
    : undefined;

/** Test-only: simulate the build-time define (null = unset). */
export function __setMigrationsFingerprintForTests(fp: string | null): void {
  MIGRATIONS_FINGERPRINT = fp ?? undefined;
}

/** system_settings key holding the last fully-reconciled fingerprint. */
const MIGRATIONS_FINGERPRINT_KEY = "migrations.fingerprint";

export async function readStoredMigrationFingerprint(): Promise<string | null> {
  try {
    const rows = extractRows(
      await db.execute(
        sql`SELECT value FROM system_settings WHERE key = ${MIGRATIONS_FINGERPRINT_KEY} LIMIT 1`,
      ),
    );
    const value = rows[0]?.["value"];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    // Table not created yet (true first boot) or transient — either way:
    // fall through to the full reconcile. Never let the fast-path
    // PROBE break boot.
    return null;
  }
}

export async function writeStoredMigrationFingerprint(fingerprint: string): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO system_settings (key, value, updated_at)
          VALUES (${MIGRATIONS_FINGERPRINT_KEY}, ${fingerprint}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    );
  } catch (err) {
    // Persisting the marker is best-effort: a failure here must never
    // fail an otherwise-successful migration run — the next boot simply
    // reconciles again (idempotent).
    logger.warn({ err }, "migrations.fingerprint write skipped (non-fatal)");
  }
}

/**
 * r110 (109-e P2-1): the marker-persist gate runMigrations() ends with.
 *
 * Persists the build fingerprint ONLY when the run fully reconciled
 * (zero constraint-skip alert paths). A skip leaves the stored marker
 * untouched — whatever it was — so the next boot's compare fails and
 * the full reconcile re-runs (and re-alerts, deduped 24h) until the
 * operator fixes the data. No-op when the fingerprint is undefined
 * (tests/dev — no build-time define).
 */
export async function persistMigrationFingerprintAfterRun(): Promise<void> {
  if (!MIGRATIONS_FINGERPRINT) return;
  if (constraintSkipKeys.length > 0) {
    logger.warn(
      { category: "storage", skipped: [...constraintSkipKeys] },
      "[migrations] constraint-skip alert path fired — fingerprint NOT persisted; the next boot re-runs the full reconcile (r110)",
    );
    return;
  }
  await writeStoredMigrationFingerprint(MIGRATIONS_FINGERPRINT);
}

// ── r110 (109-e P2-2): v2 composite marker diagnostics ─────────────────────
//
// The marker format is `v2:<codeHash>:<schemaHash>` (see build.mjs). The
// fast-path compare stays strict string equality — old bare-hex markers
// simply never match — but on mismatch we can tell ops WHICH component
// moved. Pure function over opaque strings; never throws.
export function describeMarkerMismatch(stored: string, current: string): string {
  const parts = (m: string): [string, string, string] | null => {
    const segs = m.split(":");
    return segs.length === 3 && segs[0] === "v2" ? (segs as [string, string, string]) : null;
  };
  const s = parts(stored);
  const c = parts(current);
  if (s && c) {
    if (s[1] === c[1]) return "schema component changed (out-of-band schema/chain edit detected)";
    if (s[2] === c[2]) return "migration engine code changed";
  }
  return "marker format/components changed (legacy or diverged marker)";
}
