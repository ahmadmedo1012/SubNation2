import { db, loginAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MINUTES = 15;

// Exponential backoff: 15min, 30min, 60min, 120min, 240min for 2nd+ lockouts
function calculateLockoutDuration(failureCount: number): number {
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

export async function recordFailedAttempt(identifier: string): Promise<void> {
  const [record] = await db
    .select()
    .from(loginAttemptsTable)
    .where(eq(loginAttemptsTable.identifier, identifier))
    .limit(1);

  if (!record) {
    await db.insert(loginAttemptsTable).values({
      identifier,
      attemptCount: 1,
      lastAttempt: new Date(),
    });
    return;
  }

  const newCount = record.attemptCount + 1;
  const lockoutDuration = calculateLockoutDuration(newCount);
  const lockedUntil =
    newCount >= MAX_ATTEMPTS ? new Date(Date.now() + lockoutDuration * 60_000) : null;

  await db
    .update(loginAttemptsTable)
    .set({
      attemptCount: sql`${loginAttemptsTable.attemptCount} + 1`,
      lockedUntil,
      lastAttempt: new Date(),
    })
    .where(eq(loginAttemptsTable.identifier, identifier));
}

export async function resetAttempts(identifier: string): Promise<void> {
  await db
    .update(loginAttemptsTable)
    .set({ attemptCount: 0, lockedUntil: null })
    .where(eq(loginAttemptsTable.identifier, identifier));
}
