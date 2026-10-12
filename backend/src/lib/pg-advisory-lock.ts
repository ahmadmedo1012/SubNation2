/**
 * Generic pg advisory-lock gate — the reusable serialization machinery
 * extracted from services/whatsapp-otp.service.ts (R136 BE-2).
 *
 * SHAPE (A9-3 / R117 / R118-A1, as proven in the OTP start-lock path):
 *
 *   pg_try_advisory_lock(hashtext(key)) on a DEDICATED pooled client:
 *   session-scoped advisory locks live on the connection that took
 *   them, so acquire + release MUST share one client
 *   (pool.connect() … release()). Callers pass a namespaced key —
 *   e.g. "otp-start:<phone>" — so it can never collide with the
 *   sibling hashtextextended-keyed advisory locks (topup.service.ts /
 *   jobs/alertLogger.ts use different hash functions, but distinct
 *   prefixes remove all doubt).
 *
 *   R117 (A1-P2): the client MUST come from a DEDICATED lock pool
 *   (@workspace/db's `lockPool`, max 2) — never the runtime pool. The
 *   critical section can span an external call (~30 s WhatsApp sends);
 *   holders taken from the runtime pool (max 8 in production) could
 *   pin the entire app DB layer under a burst. Saturation of the lock
 *   pool fails fast into the SAME busy verdict as a lock loser — a
 *   retryable condition, never a runtime 500.
 *
 *   F-4 (R118-A1): the finally-branch unlock query is raced against a
 *   bounded timer — a silently-dead connection must not hang the
 *   response AND pin a lock-pool slot until TCP keepalives error out.
 *   A timeout takes the same destroy path as a rejected query:
 *   release(true) destroys the client, closing the session so Postgres
 *   drops the advisory lock server-side. The losing (still-pending)
 *   query promise stays race-observed so its late settlement can never
 *   surface as an unhandled rejection.
 *
 *   F-5 (R118-A1): saturation + unlock failures fire DEDUPED
 *   fire-and-forget admin alerts (dynamic import of jobs/alertLogger —
 *   the same lazy pattern the socket emits use — so callers' test
 *   module-boundary mocks stay in charge of the alertLogger surface).
 *
 * The OTP pool RESOLUTION (resolveDbPool's lazy @workspace/db dynamic
 * import + the __setOtpStartLockPoolForTests seam) deliberately stays
 * in services/whatsapp-otp.service.ts — the pglite/module-boundary
 * mocks and the lock-pool-wiring source-contract suite pin it there.
 * Future sibling gates (topup, alertLogger) resolve their own pool and
 * reuse this machinery.
 */

import { logger } from "./logger";

/** A pg pooled client — the minimal surface the gate touches. */
export interface PoolClientLike {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  release: (destroy?: boolean) => void;
}

/** A pg pool — `lockPool` from @workspace/db satisfies this. */
export interface PoolLike {
  connect: () => Promise<PoolClientLike>;
}

// F-4 (R118-A1): bound on the finally-branch unlock query. The lock
// pool sets only an acquisition timeout (connectionTimeoutMillis) — no
// statement timeout — so a silently-dead connection used to leave the
// `SELECT pg_advisory_unlock` await hanging until TCP keepalives error
// out. Env-overridable per gate for tests + ops (same pattern as
// HEALTH_AGGREGATE_TIMEOUT_MS in routes/health.ts).
export const DEFAULT_UNLOCK_TIMEOUT_MS = 5_000;

function unlockTimeoutMs(envVar: string, defaultMs: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultMs;
}

/** F-5 (R118-A1): a deduped admin alert the gate fires on a failure
 * branch (dedupeKey collapses repeats within logAdminAlert's 24 h
 * window; the caller passes the operator-facing title/message). */
export interface AdvisoryLockAlertText {
  dedupeKey: string;
  title: string;
  message: string;
}

/**
 * F-5 (R118-A1): lock-pool failure paths previously surfaced ONLY as
 * warn lines — a sustained pathology (pool saturation, unlock
 * failures) stayed invisible to the alerts drawer. Fire-and-forget by
 * design: logAdminAlert never rejects (its own catch swallows DB
 * failures), so the .catch here only guards the module load itself.
 * Dynamic import — same lazy pattern the socket emits use — keeps
 * alertLogger (and its @workspace/db import) out of the caller's eager
 * import graph: the module-boundary mocks used by the test suites
 * export no adminAlertsTable, and the lock path is the one place the
 * callers run under them.
 */
function fireAdvisoryLockAlert(logPrefix: string, alert: AdvisoryLockAlertText): void {
  import("../jobs/alertLogger")
    .then(({ logAdminAlert }) =>
      logAdminAlert("system", alert.title, alert.message, { dedupeKey: alert.dedupeKey }),
    )
    .catch((err) =>
      logger.warn(
        { err, dedupeKey: alert.dedupeKey },
        `${logPrefix} lock-pool admin alert dispatch failed`,
      ),
    );
}

export interface AdvisoryLockOptions {
  /** Lock pool to draw the client from. `null` → the gate is SKIPPED
   * (single-process contexts: pglite harness / module-boundary mocks
   * export no lockPool) and the guarded fn runs ungated. */
  pool: PoolLike | null;
  /** Namespaced lock key — pg_try_advisory_lock(hashtext(key)). */
  key: string;
  /** pino warn-log category for the saturation/unlock warn lines. */
  logCategory: string;
  /** Prefix for the warn-log messages (e.g. "[whatsapp-otp]"). */
  logPrefix: string;
  /** Env var that overrides the F-4 bounded unlock timeout. */
  unlockTimeoutEnv: string;
  /** Default for the F-4 bounded unlock timeout (ms). */
  unlockTimeoutDefaultMs: number;
  /** F-5 deduped admin alert fired on lock-pool saturation. */
  saturationAlert: AdvisoryLockAlertText;
  /** F-5 deduped admin alert fired on an unlock failure/timeout. */
  unlockFailureAlert: AdvisoryLockAlertText;
}

/**
 * Verdict of {@link withAdvisoryLock} — the caller maps it onto its own
 * domain verdicts (the OTP path answers the rate-limit-style cooldown
 * verdict for both busy causes; a store/gate that wants to distinguish
 * lock-lost from saturation can key off `cause`).
 */
export type AdvisoryLockOutcome<T> =
  /** The fn ran under the held lock (its return value). */
  | { kind: "ran"; value: T }
  /** No lock pool available — the gate was consciously bypassed and
   * the fn ran ungated (single-process behavior is unchanged). */
  | { kind: "skipped"; value: T }
  /** The gate refused entry: another holder has the key (lock_lost) or
   * the lock pool is saturated / unreachable (pool_saturated). Retryable. */
  | { kind: "busy"; cause: "lock_lost" | "pool_saturated" };

/**
 * Run `fn` serialized per `key` across processes, on a client drawn
 * from the DEDICATED lock pool. See the module docblock for the full
 * contract (bounded unlock, destroy-on-unlock-failure, saturation
 * alerts, pool-less bypass).
 *
 * The fn's exceptions propagate unchanged — the finally branch always
 * unlocks and releases the client first.
 */
export async function withAdvisoryLock<T>(
  opts: AdvisoryLockOptions,
  fn: () => Promise<T>,
): Promise<AdvisoryLockOutcome<T>> {
  const pool = opts.pool;
  if (pool === null) {
    // No lock pool (test harness / module-boundary mocks) — no
    // cross-process gate. Single-process behavior is unchanged.
    return { kind: "skipped", value: await fn() };
  }
  const lockKey = opts.key;
  // R117 (A1-P2): lock-pool saturation (burst of concurrent callers, or
  // the DB briefly unreachable) fails fast into the SAME busy verdict as
  // a lock loser — retryable, honest ("try again in a moment"), and it
  // never 500s the guarded path. A genuinely down DB still surfaces
  // loudly through every other query path + the neon health check.
  let client: PoolClientLike;
  try {
    client = await pool.connect();
  } catch (err) {
    logger.warn(
      {
        category: opts.logCategory,
        err: err instanceof Error ? err.message : String(err),
      },
      `${opts.logPrefix} start-lock pool saturated — answering busy (retryable)`,
    );
    // F-5 (R118-A1): the warn line alone is invisible to the operator's
    // alert drawer — a sustained saturation (burst traffic or a sick
    // DB) deserves a deduped admin alert.
    fireAdvisoryLockAlert(opts.logPrefix, opts.saturationAlert);
    return { kind: "busy", cause: "pool_saturated" };
  }
  let acquired = false;
  try {
    const res = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [
      lockKey,
    ]);
    acquired = Boolean(res.rows?.[0]?.acquired);
    if (!acquired) {
      // Another holder has the key — the caller's busy verdict. The
      // loser never reaches the guarded fn.
      return { kind: "busy", cause: "lock_lost" };
    }
    return { kind: "ran", value: await fn() };
  } finally {
    if (acquired) {
      let unlockOk = true;
      // F-4 (R118-A1): race the unlock against a bounded timer. Without
      // the race, a silently-dead connection hung this await until TCP
      // keepalives error out — the guarded response was delayed AND one
      // of the two lock-pool slots stayed pinned the whole time (a
      // second such hang 429'd every later gated call with the busy
      // verdict). A timeout takes the SAME unlockOk=false path as a
      // rejected query: release(true) destroys the client, closing the
      // session so Postgres drops the advisory lock server-side. The
      // losing (still-pending) query promise stays race-observed, so its
      // late settlement can never surface as an unhandled rejection.
      let unlockTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]),
          new Promise<never>((_, reject) => {
            unlockTimer = setTimeout(
              () => {
                reject(
                  new Error(
                    `pg_advisory_unlock did not answer within ${unlockTimeoutMs(opts.unlockTimeoutEnv, opts.unlockTimeoutDefaultMs)}ms`,
                  ),
                );
              },
              unlockTimeoutMs(opts.unlockTimeoutEnv, opts.unlockTimeoutDefaultMs),
            );
          }),
        ]);
      } catch (err) {
        unlockOk = false;
        logger.warn(
          {
            category: opts.logCategory,
            err: err instanceof Error ? err.message : String(err),
          },
          `${opts.logPrefix} start-lock advisory unlock failed — destroying the client so Postgres drops the session lock server-side`,
        );
        // F-5 (R118-A1): surface the pathology in the admin alerts
        // drawer too — repeated unlock failures point at a sick
        // lock-pool/DB connection, not a one-off blip.
        fireAdvisoryLockAlert(opts.logPrefix, opts.unlockFailureAlert);
      } finally {
        if (unlockTimer !== undefined) clearTimeout(unlockTimer);
      }
      // R117 (A1-P3): a session-scoped advisory lock dies with the SESSION.
      // A plain release() would return a still-locked live session to the
      // pool — that key would then answer "busy" on every future gated
      // call until process restart. On unlock failure release(true)
      // destroys the client (closing the session → server drops the
      // lock) instead.
      client.release(!unlockOk);
    } else {
      client.release();
    }
  }
}
