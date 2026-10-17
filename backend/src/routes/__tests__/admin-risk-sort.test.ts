/**
 * R160 — GET /api/admin/risk/events ?sort= (the risk half of the R158-A
 * P3 «no sort affordance on orders/coupons/risk tables»).
 *
 * The queue is CURSOR-paginated, so the sort must ride the SQL ORDER BY
 * (the R159 orders blueprint) AND the cursor must encode the ACTIVE
 * sort's keyset tuple — a createdAt cursor under a score sort would
 * duplicate/drop rows across load-more pages. The score column is an
 * integer 0..100 (chk_risk_score_range), which is what makes the
 * "<score>:<id>" cursor variant safe. Pinned here:
 *
 *   1. ABSENT ?sort= → the frozen default `created_at DESC, id DESC`
 *      (byte-identical to pre-R160 — the param is additive) and the
 *      next_cursor stays the "<isoCreatedAt>:<id>" format.
 *   2. created_at:asc → oldest-first, and the ASCENDING continuation
 *      (page 2 via the cursor) returns strictly-after rows — the
 *      comparison direction flips with the sort.
 *   3. score:asc / score:desc order by the score column.
 *   4. score TIES break on `id DESC`, stable across cursor pages —
 *      same-score events are the common case on a 0..100 integer
 *      scale; the emitted cursor is "<score>:<id>".
 *   5. composes with the ?level= filter.
 *   6. unknown key/direction → 400 INVALID_DATA with the allowed
 *      values in the Arabic message (the ?eventType= family idiom —
 *      never a Postgres error, never a silently ignored value).
 *
 * Runs against the REAL adminRiskRouter over the pglite harness (same
 * mount + RISK_DDL idiom as admin-risk-config / risk-hard-block).
 */

import express, { type Express } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { signAdminToken } from "../../lib/jwt";
import { adminRiskRouter } from "../admin/risk";
import { adminUsersTable, db, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { riskEventsTable } from "@workspace/db";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRiskRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
  // risk_events is not part of the shared test DDL — owned here
  // (mirrors shared/db/src/schema/risk.ts, the risk-hard-block RISK_DDL).
  await db.execute(
    sql.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_event_type') THEN
    CREATE TYPE risk_event_type AS ENUM (
      'login_attempt','login_success','login_failure','otp_request','otp_verify',
      'topup_attempt','topup_success','order_create','order_deliver','coupon_apply',
      'referral_event','admin_force_reauth');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN
    CREATE TYPE risk_level AS ENUM ('low','medium','high','critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_action_taken') THEN
    CREATE TYPE risk_action_taken AS ENUM ('none','log','soft_block','hard_block','alert');
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`),
  );
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS risk_events (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  event_type risk_event_type NOT NULL,
  score integer NOT NULL,
  level risk_level NOT NULL,
  confidence numeric(4,3) NOT NULL,
  rule_fired text[] NOT NULL DEFAULT '{}',
  statistical_signals jsonb NOT NULL DEFAULT '{}',
  ml_score numeric(4,3),
  top_features jsonb,
  action_taken risk_action_taken NOT NULL DEFAULT 'log',
  ip_address varchar(45),
  user_agent varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz
)`),
  );
});
beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE risk_events RESTART IDENTITY"));
});

let phoneSeq = 91_900_000;
async function seedAdmin(): Promise<string> {
  phoneSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_risk_sort_${Math.floor(Math.random() * 1e6)}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["users"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

interface EventSpec {
  score: number;
  createdAt: Date;
  level?: "low" | "medium" | "high" | "critical";
}

/** One user + the given events (ids ascend with insertion). */
async function seedEvents(specs: EventSpec[]): Promise<number[]> {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: String((phoneSeq += 1)) })
    .returning();
  const ids: number[] = [];
  for (const spec of specs) {
    const [row] = await db
      .insert(riskEventsTable)
      .values({
        userId: user.id,
        eventType: "login_failure",
        score: spec.score,
        level: spec.level ?? "medium",
        confidence: "0.900",
        createdAt: spec.createdAt,
      })
      .returning({ id: riskEventsTable.id });
    ids.push(row.id);
  }
  return ids;
}

async function listen(): Promise<{ url: string; close: () => void }> {
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

interface EventsBody {
  events: Array<{ id: number; score: number; created_at: string }>;
  next_cursor: string | null;
}

async function getJson(url: string, path: string, token?: string) {
  const res = await fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("R160: GET /api/admin/risk/events ?sort= — the validated column sort", () => {
  it("ABSENT ?sort= keeps the frozen default: created_at DESC (newest first), ISO:id cursor", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      // Inserted oldest→newest; ids [1,2,3] map to t1<t2<t3.
      await seedEvents([
        { score: 30, createdAt: new Date("2026-09-01T10:00:00Z") },
        { score: 10, createdAt: new Date("2026-09-02T10:00:00Z") },
        { score: 20, createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const res = await getJson(url, "/api/admin/risk/events?limit=2", token);
      expect(res.status).toBe(200);
      const body = res.body as EventsBody;
      expect(body.events.map((e) => e.score)).toEqual([20, 10]);
      // hasMore (limit+1 probe found row 3) → the createdAt-cursor format.
      expect(body.next_cursor).toBe("2026-09-02T10:00:00.000Z:2");
    } finally {
      close();
    }
  });

  it("created_at:asc → oldest first, and page 2 continues strictly AFTER (ascending keyset)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedEvents([
        { score: 30, createdAt: new Date("2026-09-01T10:00:00Z") },
        { score: 10, createdAt: new Date("2026-09-02T10:00:00Z") },
        { score: 20, createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const p1 = await getJson(url, "/api/admin/risk/events?limit=2&sort=created_at%3Aasc", token);
      expect(p1.status).toBe(200);
      const body1 = p1.body as EventsBody;
      expect(body1.events.map((e) => e.score)).toEqual([30, 10]);
      expect(body1.next_cursor).toBe("2026-09-02T10:00:00.000Z:2");

      // The continuation flips its comparison with the sort direction —
      // page 2 returns the strictly-after row, not the newest again.
      const p2 = await getJson(
        url,
        `/api/admin/risk/events?limit=2&sort=created_at%3Aasc&cursor=${encodeURIComponent(body1.next_cursor!)}`,
        token,
      );
      expect(p2.status).toBe(200);
      const body2 = p2.body as EventsBody;
      expect(body2.events.map((e) => e.score)).toEqual([20]);
      expect(body2.next_cursor).toBeNull();
    } finally {
      close();
    }
  });

  it("score:desc / score:asc order by the score column (id DESC tiebreaker inside ties)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedEvents([
        { score: 30, createdAt: new Date("2026-09-01T10:00:00Z") },
        { score: 10, createdAt: new Date("2026-09-02T10:00:00Z") },
        { score: 20, createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const desc = await getJson(url, "/api/admin/risk/events?limit=10&sort=score%3Adesc", token);
      expect(desc.status).toBe(200);
      expect((desc.body as EventsBody).events.map((e) => e.score)).toEqual([30, 20, 10]);

      const asc = await getJson(url, "/api/admin/risk/events?limit=10&sort=score%3Aasc", token);
      expect(asc.status).toBe(200);
      expect((asc.body as EventsBody).events.map((e) => e.score)).toEqual([10, 20, 30]);
    } finally {
      close();
    }
  });

  it('score TIES break on id DESC, stable across cursor pages; the cursor is "<score>:<id>" (the load-more contract)', async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      // Five identical-score events — the 0..100 integer-scale common
      // case. ids ascend with insertion, so the id DESC tiebreaker must
      // page them [5,4] / [3,2] / [1] with no duplicate or drop.
      const ids = await seedEvents(
        Array.from({ length: 5 }, (_, i) => ({
          score: 40,
          createdAt: new Date(`2026-09-0${i + 1}T10:00:00Z`),
        })),
      );
      const expectDesc = ids.slice().reverse();

      const pages: number[][] = [];
      let cursor: string | null = null;
      for (const _page of [1, 2, 3]) {
        const res = await getJson(
          url,
          `/api/admin/risk/events?limit=2&sort=score%3Adesc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          token,
        );
        expect(res.status).toBe(200);
        const body = res.body as EventsBody;
        pages.push(body.events.map((e) => e.id));
        // The score cursor encodes the tuple the sort paginates over:
        // the last row's "<score>:<id>".
        if (_page < 3) {
          const lastRow = body.events[body.events.length - 1];
          expect(body.next_cursor).toBe(`${lastRow.score}:${lastRow.id}`);
        }
        cursor = body.next_cursor;
      }
      expect(pages.flat()).toEqual(expectDesc);
      expect(cursor).toBeNull();
    } finally {
      close();
    }
  });

  it("composes with the ?level= filter (sorted within the filtered window)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedEvents([
        { score: 30, createdAt: new Date("2026-09-01T10:00:00Z"), level: "high" },
        { score: 10, createdAt: new Date("2026-09-02T10:00:00Z"), level: "low" },
        { score: 20, createdAt: new Date("2026-09-03T10:00:00Z"), level: "high" },
      ]);

      const res = await getJson(
        url,
        "/api/admin/risk/events?limit=10&level=high&sort=score%3Aasc",
        token,
      );
      expect(res.status).toBe(200);
      const body = res.body as EventsBody;
      expect(body.events).toHaveLength(2);
      expect(body.events.map((e) => e.score)).toEqual([20, 30]);
    } finally {
      close();
    }
  });

  it("unknown key or direction → 400 INVALID_DATA with the allowed values (never a silent ignore)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedEvents([{ score: 10, createdAt: new Date("2026-09-01T10:00:00Z") }]);

      // Direction typos, unknown keys (incl. the DTO-flavored
      // `created`), and injection-shaped values.
      for (const bad of [
        "created_at",
        "created_at:up",
        "created:desc",
        "score",
        "score:asc;DROP",
        "created_at:asc,score:desc",
      ]) {
        const res = await getJson(
          url,
          `/api/admin/risk/events?sort=${encodeURIComponent(bad)}`,
          token,
        );
        expect(res.status, bad).toBe(400);
        expect(res.body.code, bad).toBe("INVALID_DATA");
        expect(res.body.error, bad).toContain("ترتيب غير صالح");
        expect(res.body.error, bad).toContain("score:desc");
      }
    } finally {
      close();
    }
  });
});
