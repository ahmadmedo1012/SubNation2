import express, { type Express } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUsersTable,
  db,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminReferralsRouter } from "../admin/referrals";

/**
 * E-F3 (R186): the admin referrals `?search=` filter ran IN JS on the
 * LIMIT-200 page, so a matching row older than the newest 200 was
 * silently invisible — the operator searched a phone that genuinely had a
 * referral event and got an empty list. The filter now lives in the SQL
 * WHERE (escaped LIKE on the phone columns, the admin/orders.ts idiom);
 * these tests pin the depth-201 shape: 201 events, only the OLDEST
 * matching the search, and it must appear.
 *
 * Harness: coupons-referrals-audit.test.ts (the existing admin-referrals
 * suite) — real router over pglite, admin bearer token.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminReferralsRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_ref_search",
      passwordHash: "x",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function getReferrals(
  url: string,
  token: string,
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/referrals${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The ONLY phone in the fixture containing the search needle "777". */
const OLDEST_REFEREE_PHONE = "0917770000";

async function seed201Events(): Promise<{ oldestEventId: number }> {
  // One shared referrer (phone without the needle); 201 DISTINCT referees
  // (referee_id is UNIQUE per the schema) — the oldest referee carries the
  // needle, the newest 200 do not.
  const [referrer] = await db.insert(usersTable).values({ phone: "0915000000" }).returning();
  const refereeRows = [OLDEST_REFEREE_PHONE];
  for (let i = 1; i <= 200; i++) {
    refereeRows.push(`0916${String(100000 + i).padStart(6, "0")}`);
  }
  const referees = await db
    .insert(usersTable)
    .values(refereeRows.map((phone) => ({ phone })))
    .returning();

  const eventRows = referees.map((referee, i) => ({
    referrerId: referrer.id,
    refereeId: referee.id,
    status: "pending" as const,
    // Distinct descending timestamps: i=0 is the OLDEST (201 minutes ago),
    // i=200 the newest — the LIMIT-200 page is exactly events 1..200.
    createdAt: new Date(Date.now() - (201 - i) * 60_000),
  }));
  const events = await db.insert(referralEventsTable).values(eventRows).returning();
  return { oldestEventId: events[0]!.id };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/admin/referrals?search= — SQL-side search (E-F3)", () => {
  it("a matching row OLDER than the newest 200 is still found (was invisible pre-fix)", async () => {
    const { oldestEventId } = await seed201Events();
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await getReferrals(url, token, "?search=777");
      expect(res.status).toBe(200);

      const list = res.body.list as Array<Record<string, unknown>>;
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(oldestEventId);
      expect(list[0]!.referee_phone).toBe(OLDEST_REFEREE_PHONE);
      expect(list[0]!.referrer_phone).toBe("0915000000");

      // The search narrows the LIST only — stats stay the unfiltered totals.
      expect(res.body.stats).toMatchObject({ total: 201, pending: 201 });

      // The combined status+search WHERE (the new AND composition).
      const both = await getReferrals(url, token, "?status=pending&search=777");
      expect(both.status).toBe(200);
      expect(both.body.list as unknown[]).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("an unsearched listing is still capped at LIMIT 200 (newest first)", async () => {
    await seed201Events();
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await getReferrals(url, token);
      expect(res.status).toBe(200);
      const list = res.body.list as Array<Record<string, unknown>>;
      expect(list).toHaveLength(200);
      // The newest event (201-min-ago minus 200 minutes = 1 minute ago) is
      // first; the OLDEST is the one row the cap cuts.
      expect(list[0]!.referee_phone).toBe("0916100200");
      expect(list.some((r) => r.referee_phone === OLDEST_REFEREE_PHONE)).toBe(false);
    } finally {
      close();
    }
  });

  it("a LIKE wildcard in the search term cannot widen the match (escapeLikeTerm idiom)", async () => {
    await seed201Events();
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await getReferrals(url, token, "?search=%");
      expect(res.status).toBe(200);
      // A bare "%" is a literal now — it matches no phone in the fixture.
      expect(res.body.list).toHaveLength(0);
    } finally {
      close();
    }
  });
});
