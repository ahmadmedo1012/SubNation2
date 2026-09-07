import { db, loginAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MINUTES = 15;

// Exponential backoff: 15min, 30min, 60min, 120min, 240min for 2nd+ lockouts.
// Kept as the JS mirror of the SQL CASE inside recordFailedAttempt's upsert —
// the lockout-upsert test cross-checks the two against each other.
export function calculateLockoutDuration(failureCount: number): number {
  if (failureCount <= MAX_ATTEMPTS) {
    return BASE_LOCKOUT_MINUTES;
  }
  const lockoutNumber = Math.ceil((failureCount - MAX_ATTEMPTS) / MAX_ATTEMPTS) + 1;
  return BASE_LOCKOUT_MINUTES * Math.pow(2, lockoutNumber - 1);
}

export async function checkLockout(
  identifier: string,
): Promise<{ locked: boolean; lockedUntil: Date | null; attemptCount: number }> {
  const [record] = await db
    .select()
    .from(loginAttemptsTable)
    .where(eq(loginAttemptsTable.identifier, identifier))
    .limit(1);

  if (!record || !record.lockedUntil) {
    return { locked: false, lockedUntil: null, attemptCount: record?.attemptCount || 0 };
  }

  if (record.lockedUntil > new Date()) {
    return { locked: true, lockedUntil: record.lockedUntil, attemptCount: record.attemptCount };
  }

  // Lockout expired — reset count but keep record for tracking
  await db
    .update(loginAttemptsTable)
    .set({ attemptCount: 0, lockedUntil: null })
    .where(eq(loginAttemptsTable.identifier, identifier));

  return { locked: false, lockedUntil: null, attemptCount: 0 };
}

/**
 * Record a failed attempt as ONE atomic upsert (93-A1 S12, round-93).
 *
 * The previous SELECT-then-INSERT flow raced on concurrent FIRST
 * failures: two requests for a fresh identifier both saw "no row",
 * both INSERTed, the second lost the unique race with a 23505 that the
 * login route did not catch → 500 instead of 401. With the unique index
 * (idx_login_attempts_identifier, shared/db schema) this is now a
 * single-statement INSERT … ON CONFLICT DO UPDATE:
 *
 *   - fresh identifier  → INSERT {attemptCount: 1}
 *   - existing row      → attemptCount = attemptCount + 1
 *   - locked_until      → set (with exponential duration, mirroring
 *                         calculateLockoutDuration) exactly when the
 *                         incremented count reaches MAX_ATTEMPTS,
 *                         cleared otherwise
 *
 * The duration math in SQL is the closed form of the JS function:
 *   JS:  15 * 2^(ceil((count - MAX) / MAX) + 1 - 1)
 *   SQL: 15 * 2^(ceil((attempt_count + 1 - MAX) / MAX))
 */
export async function recordFailedAttempt(identifier: string): Promise<void> {
  await db
    .insert(loginAttemptsTable)
    .values({
      identifier,
      attemptCount: 1,
      lastAttempt: new Date(),
    })
    .onConflictDoUpdate({
      target: loginAttemptsTable.identifier,
      set: {
        attemptCount: sql`${loginAttemptsTable.attemptCount} + 1`,
        lastAttempt: new Date(),
        lockedUntil: sql`CASE
          WHEN ${loginAttemptsTable.attemptCount} + 1 >= ${MAX_ATTEMPTS}
          THEN now() + (
            ${BASE_LOCKOUT_MINUTES}
            * power(2, ceil((${loginAttemptsTable.attemptCount} + 1 - ${MAX_ATTEMPTS})::numeric / ${MAX_ATTEMPTS}))
            * interval '1 minute'
          )
          ELSE NULL
        END`,
      },
    });
}

export async function resetAttempts(identifier: string): Promise<void> {
  await db
    .update(loginAttemptsTable)
    .set({ attemptCount: 0, lockedUntil: null })
    .where(eq(loginAttemptsTable.identifier, identifier));
}
