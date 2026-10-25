import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import {
  db,
  execTestSql,
  initTestDb,
  notificationsTable,
  resetTestDb,
  usersTable,
} from "../test/db";
import { createNotification } from "../notify";
import { captureSubsystemException } from "../lib/sentry";

/**
 * R187 (J-F2) — notify.ts's internal failure arm, pinned DIRECTLY.
 *
 * The only existing pin (orders-idempotency-route.test.ts, R183) wraps
 * createNotification in a full-function mock — a contract that stays
 * green even if the internal catch were deleted. This file drives the
 * REAL function into its own catch: the notifications INSERT fails (the
 * table is dropped, so the error is the real pglite driver failure, not
 * a mock of the unit under test) and the pinned contract is:
 *
 *   1. createNotification RESOLVES (never rejects the caller's request);
 *   2. captureSubsystemException("notifications", err, {userId, type,
 *      title}) fires — the Sentry triage the catch promises;
 *   3. control: with the table present, the insert lands and nothing is
 *      captured.
 */

vi.mock("../lib/sentry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sentry")>();
  return { ...actual, captureSubsystemException: vi.fn(actual.captureSubsystemException) };
});

const NOTIFICATIONS_DDL = `
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL DEFAULT 'system',
  title varchar(255) NOT NULL,
  message text,
  link varchar(255),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
`;

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(captureSubsystemException).mockClear();
});

describe("R187 (J-F2) — createNotification's internal catch", () => {
  it("control — with the table present the insert lands and NOTHING is captured", async () => {
    const [user] = await db.insert(usersTable).values({ phone: "0941000001" }).returning();

    await expect(
      createNotification(user.id, "support", "عنوان", "نص", "/support?ticket=1"),
    ).resolves.toBeUndefined();

    const rows = await db.select().from(notificationsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      type: "support",
      title: "عنوان",
      link: "/support?ticket=1",
    });
    expect(captureSubsystemException).not.toHaveBeenCalled();
  });

  it("a failing notifications INSERT never rejects the caller — warn + captureSubsystemException('notifications') fire instead", async () => {
    const [user] = await db.insert(usersTable).values({ phone: "0941000002" }).returning();

    // The REAL insert fails: the table is gone (a DB hiccup / migration
    // window shape), so the error object is the genuine driver failure.
    await execTestSql("DROP TABLE notifications;");
    try {
      await expect(
        createNotification(user.id, "wallet", "عنوان الفشل", "نص الفشل"),
      ).resolves.toBeUndefined();

      expect(captureSubsystemException).toHaveBeenCalledTimes(1);
      const [subsystem, err, tags] = vi.mocked(captureSubsystemException).mock.calls[0]!;
      expect(subsystem).toBe("notifications");
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("notifications");
      expect(tags).toMatchObject({ userId: user.id, type: "wallet", title: "عنوان الفشل" });
    } finally {
      // Restore the harness shape for any test added after this one.
      await execTestSql(NOTIFICATIONS_DDL);
    }
  });
});
