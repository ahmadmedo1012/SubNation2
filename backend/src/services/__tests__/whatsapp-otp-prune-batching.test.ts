/**
 * R110-H (P3 from R109 §20) — pruneExpiredOtps was the LAST unbounded
 * retention DELETE in the repo: every other retention job already runs
 * bounded ctid batches of ≤1000 rows/statement (B7-P2-5 family). The 24 h
 * retention window bounds the steady-state table, but the boot one-shot
 * catch-up after an extended outage could land one huge statement lock on
 * the shared Neon pooler.
 *
 * This suite pins the batch loop with the same technique as
 * jobs/__tests__/retention-batching.test.ts: datasets just above the batch
 * boundary (1010 = 1000 + 10) so the LOOP is what's under test — plus a
 * db.execute spy proving the work really splits across statements (a
 * single unbounded DELETE would be exactly one call).
 *
 * The pglite harness is used (same as whatsapp-otp-consume-race.test.ts):
 * whatsapp_otps is not part of the shared harness DDL, so the production
 * shape is created locally in beforeAll.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, whatsappOtpsTable } from "../../test/db";
import { pruneExpiredOtps } from "../whatsapp-otp.service";

// 1010 rows: one full batch (1000) + a 10-row remainder — forces the loop
// to iterate (2 DELETE statements) without burning sandbox CPU on rows the
// boundary test doesn't need.
const BATCH_BOUNDARY_ROWS = 1010;

beforeAll(async () => {
  await initTestDb();
  // Mirror of the real whatsapp_otps schema (same DDL as
  // whatsapp-otp-consume-race.test.ts — not in the shared harness DDL).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_otps (
      id serial PRIMARY KEY,
      phone varchar(20) NOT NULL,
      code_hash varchar(64) NOT NULL,
      purpose varchar(32) NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      consumed_at timestamptz,
      ip_address varchar(45),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Explicit hook timeout — same 2-CPU full-suite contention rationale as
  // retention-batching.test.ts.
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE whatsapp_otps RESTART IDENTITY`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedStaleOtps(count: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO whatsapp_otps (phone, code_hash, purpose, expires_at, created_at)
    SELECT '091' || LPAD(g::text, 7, '0'), 'stale-hash', 'registration',
           now() - interval '25 hours', now() - interval '25 hours'
    FROM generate_series(1, ${count}) g
  `);
}

async function seedFreshOtp(phone: string, ageHours: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO whatsapp_otps (phone, code_hash, purpose, expires_at, created_at)
    VALUES (${phone}, 'fresh-hash', 'registration',
            now() + (${5 - ageHours} * interval '1 hour'),
            now() - (${ageHours} * interval '1 hour'))
  `);
}

describe("pruneExpiredOtps — ctid-batched ≤1000 per statement (R110-H)", () => {
  it("deletes >1000 stale rows through the batch loop (two DELETE statements) and keeps fresh rows", async () => {
    await seedStaleOtps(BATCH_BOUNDARY_ROWS);
    // Two survivors: one minted now, one 23 h old (inside the 24 h window).
    await seedFreshOtp("0910000901", 0);
    await seedFreshOtp("0910000902", 23);

    const execSpy = vi.spyOn(db, "execute");
    const deleted = await pruneExpiredOtps();

    expect(deleted).toBe(BATCH_BOUNDARY_ROWS);
    // 1010 rows / 1000 per statement → exactly two DELETEs (full batch +
    // short remainder). A single unbounded DELETE would be exactly one
    // call — this is the batching pin.
    expect(execSpy).toHaveBeenCalledTimes(2);

    const survivors = await db.select().from(whatsappOtpsTable);
    expect(survivors).toHaveLength(2);
    expect(survivors.map((r) => r.phone).sort()).toEqual(["0910000901", "0910000902"]);
  });

  it("exactly one full batch (1000 stale) still probes once more — the loop exits only on a SHORT batch", async () => {
    await seedStaleOtps(1000);

    const execSpy = vi.spyOn(db, "execute");
    const deleted = await pruneExpiredOtps();

    // 1000 deleted by statement #1 (full batch → must continue), 0 by the
    // probe statement #2 (short → exit). A "break on full batch" bug would
    // leave the remainder class of the first test undeleted.
    expect(deleted).toBe(1000);
    expect(execSpy).toHaveBeenCalledTimes(2);
  });

  it("returns 0 after a single short-batch statement when nothing is stale", async () => {
    await seedFreshOtp("0910000903", 1);

    const execSpy = vi.spyOn(db, "execute");
    expect(await pruneExpiredOtps()).toBe(0);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(await db.select().from(whatsappOtpsTable)).toHaveLength(1);
  });
});
