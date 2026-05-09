import { db, loginAttemptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function checkLockout(identifier: string): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  const [record] = await db.select().from(loginAttemptsTable)
    .where(eq(loginAttemptsTable.identifier, identifier))
    .limit(1);

  if (!record || !record.lockedUntil) {
    return { locked: false, lockedUntil: null };
  }

  if (record.lockedUntil > new Date()) {
    return { locked: true, lockedUntil: record.lockedUntil };
  }

  // Lockout expired — reset
  return { locked: false, lockedUntil: null };
}

export async function recordFailedAttempt(identifier: string): Promise<void> {
  const [record] = await db.select().from(loginAttemptsTable)
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
  const lockedUntil = newCount >= MAX_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
    : null;

  await db.update(loginAttemptsTable)
    .set({
      attemptCount: sql`${loginAttemptsTable.attemptCount} + 1`,
      lockedUntil,
      lastAttempt: new Date(),
    })
    .where(eq(loginAttemptsTable.identifier, identifier));
}

export async function resetAttempts(identifier: string): Promise<void> {
  await db.delete(loginAttemptsTable)
    .where(eq(loginAttemptsTable.identifier, identifier));
}
