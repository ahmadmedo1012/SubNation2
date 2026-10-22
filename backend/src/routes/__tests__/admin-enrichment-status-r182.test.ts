import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  adminUsersTable,
  db,
  enrichmentRunsTable,
  initTestDb,
  execTestSql,
  resetTestDb,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminEnrichmentRouter } from "../admin/enrichment";

/**
 * R182 (§4 operational truth) — the enrichment status contract.
 *
 * The admin panel's empty queue used to conflate five distinct backend
 * states (queue-clear / runner-disabled / no-worker-tier / LLM-
 * unconfigured / last-run-failed) into one hard-coded hint whose
 * prescribed action cannot even succeed in the current deployment (no
 * worker tier exists). GET /api/admin/enrichment/status is the fix's
 * backend half — pinned here:
 *   - the readiness booleans mirror the runner's own gate expressions
 *     (WORKER_TIER / ENRICHMENT_RUNNER_ENABLED / llmAvailable / the
 *     effective daily-token cap incl. the 50k default);
 *   - last_run reports the NEWEST run of ANY outcome (ordered by
 *     started_at) — a failure with its recorded reason, an in_flight
 *     run with completed_at null — not just the last success;
 *   - unauthenticated probes stay 401.
 *
 * Enrichment tables are not part of the shared pglite harness DDL —
 * created per-file via execTestSql (the final-text-cap sibling's
 * pattern). COPILOT_API_KEY is never set in this file, so the cached
 * provider resolution stays "unconfigured" for every case — the
 * configured-key path belongs to the llm-client suites.
 */

const ENRICHMENT_DDL = `
CREATE TABLE enrichment_runs (
  id serial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome varchar(20) NOT NULL DEFAULT 'in_flight',
  drafts_generated integer NOT NULL DEFAULT 0,
  drafts_invalid integer NOT NULL DEFAULT 0,
  products_skipped jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_spent integer NOT NULL DEFAULT 0,
  daily_token_cap integer NOT NULL DEFAULT 0,
  cap_reached boolean NOT NULL DEFAULT false,
  worker_tier varchar(50),
  failure_reason text
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminEnrichmentRouter);
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
  const [admin] = await db
    .insert(adminUsersTable)
    .values({ username: "status_admin", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: admin.id, role: "admin" });
}

async function getStatus(
  url: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/enrichment/status`, {
    headers: { Cookie: `admin_token=${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(ENRICHMENT_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.delete(enrichmentRunsTable);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin enrichment status — the R182 operational-truth contract", () => {
  it("unauthenticated → 401 (the requireAdmin gate)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/enrichment/status`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("default env: both gates off, no LLM key, cap default 50k, no runs → last_run null", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await getStatus(url, token);
      expect(status).toBe(200);
      expect(body.worker_tier).toBe(false);
      expect(body.runner_enabled).toBe(false);
      expect(body.llm_configured).toBe(false);
      expect(body.daily_token_cap).toBe(50_000);
      expect(body.last_run).toBeNull();
    } finally {
      close();
    }
  });

  it("the readiness booleans mirror the runner's own gate expressions", async () => {
    vi.stubEnv("WORKER_TIER", "true");
    vi.stubEnv("ENRICHMENT_RUNNER_ENABLED", "true");
    vi.stubEnv("ENRICHMENT_DAILY_TOKEN_CAP", "0");
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await getStatus(url, token);
      expect(status).toBe(200);
      expect(body.worker_tier).toBe(true);
      expect(body.runner_enabled).toBe(true);
      // cap 0 is the diagnosable FR-RUN-002 refusal state — surfaced, not hidden.
      expect(body.daily_token_cap).toBe(0);
    } finally {
      close();
    }
  });

  it("last_run reports the NEWEST run of ANY outcome — a failure with its reason", async () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // Older SUCCESS …
    await db.insert(enrichmentRunsTable).values({
      startedAt: twoHoursAgo,
      completedAt: new Date(twoHoursAgo.getTime() + 60_000),
      outcome: "success",
      draftsGenerated: 4,
    });
    // … then a newer FAILURE — the truthful "last run".
    await db.insert(enrichmentRunsTable).values({
      startedAt: anHourAgo,
      completedAt: new Date(anHourAgo.getTime() + 30_000),
      outcome: "failure",
      draftsGenerated: 0,
      failureReason: "provider 502",
    });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await getStatus(url, token);
      const lastRun = body.last_run as Record<string, unknown>;
      expect(lastRun.outcome).toBe("failure");
      expect(lastRun.failure_reason).toBe("provider 502");
      expect(lastRun.drafts_generated).toBe(0);
      expect(typeof lastRun.started_at).toBe("string");
      expect(typeof lastRun.completed_at).toBe("string");
    } finally {
      close();
    }
  });

  it("an in_flight run reports outcome in_flight with completed_at null", async () => {
    await db.insert(enrichmentRunsTable).values({ outcome: "in_flight" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await getStatus(url, token);
      const lastRun = body.last_run as Record<string, unknown>;
      expect(lastRun.outcome).toBe("in_flight");
      expect(lastRun.completed_at).toBeNull();
      expect(lastRun.failure_reason).toBeNull();
    } finally {
      close();
    }
  });
});
