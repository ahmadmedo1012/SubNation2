import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B7-P0-1 (round-92) tests — boot-migration resilience.
 *
 * The failed deploy dep-daf0rt8n74is73fraih0 died because a Neon
 * read-only window made `CREATE EXTENSION` throw SQLSTATE 25006, which
 * classifyError mapped to "critical" → process.exit(1) with zero retry.
 * These tests pin the three countermeasure layers:
 *
 *   Layer 1 — write-capability probe gate (poll pg_is_in_recovery /
 *             transaction_read_only before any DDL, bounded wait);
 *   Layer 2 — "transient" classification + full-run retry with
 *             5s/15s/45s backoff (shrunk to 1ms/3ms/9ms here via
 *             MIGRATION_TRANSIENT_BACKOFF_MS) and
 *             transient_recovered / transient_exhausted outcomes;
 *   Layer 3 — lives in migrate-v1m9.test.ts (extension pre-check + otps
 *             gate + zero-steady-state-DDL).
 *
 * Module graph is mocked: runMigrations (the DDL body), the Redis
 * singleton (null → no lock), and @workspace/db (probe responses).
 */

vi.mock("../../migrate", () => ({
  runMigrations: vi.fn(),
}));

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(() => null),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({
      rows: [{ in_recovery: false, tro: "off" }],
    })),
  },
}));

import {
  bootMigrations,
  classifyError,
  isTransientError,
  waitForWritableDatabase,
} from "../../lib/boot-migrations";
import { runMigrations } from "../../migrate";
import { db } from "@workspace/db";

const mockRunMigrations = vi.mocked(runMigrations);
const mockExecute = vi.mocked(db.execute);

// Drizzle's `db.execute` returns a PgRaw thenable (QueryPromise with
// extra driver methods) — NOT a plain Promise — so a plain async mock
// implementation fails the structural check. Cast through unknown.
type ExecuteImpl = Parameters<typeof mockExecute.mockImplementation>[0];
const asExecuteImpl = (fn: () => Promise<unknown>): ExecuteImpl => fn as unknown as ExecuteImpl;
const writableProbe = () => ({ rows: [{ in_recovery: false, tro: "off" }] });

const ENV_KEYS = [
  "DISABLE_BOOT_MIGRATIONS",
  "MIGRATION_WRITE_WAIT_MAX_MS",
  "MIGRATION_WRITE_WAIT_POLL_MS",
  "MIGRATION_TRANSIENT_BACKOFF_MS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Shrink all timers: probe budget 50ms @ 5ms polls, backoff 1ms →
  // [1ms, 3ms, 9ms]. Env is read lazily inside the functions, so
  // runtime mutation works.
  process.env.MIGRATION_WRITE_WAIT_MAX_MS = "50";
  process.env.MIGRATION_WRITE_WAIT_POLL_MS = "5";
  process.env.MIGRATION_TRANSIENT_BACKOFF_MS = "1";
  mockRunMigrations.mockReset();
  mockExecute.mockReset();
  mockExecute.mockImplementation(asExecuteImpl(async () => writableProbe()));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function transientError(): Error & { code: string } {
  const err = new Error("cannot execute CREATE EXTENSION in a read-only transaction") as Error & {
    code: string;
  };
  err.code = "25006";
  return err;
}

describe("classifyError — transient class (B7-P0-1 Layer 2)", () => {
  it("classifies read-only SQLSTATE 25006 as transient", () => {
    expect(classifyError(transientError())).toBe("transient");
  });

  it.each(["08006", "08003", "08001", "57P01", "57P03"])(
    "classifies connection/shutdown SQLSTATE %s as transient",
    (code) => {
      const err = new Error("driver failure") as Error & { code: string };
      err.code = code;
      expect(classifyError(err)).toBe("transient");
    },
  );

  it("classifies node errno connection failures as transient", () => {
    const err = new Error("read ECONNRESET") as Error & { code: string };
    err.code = "ECONNRESET";
    expect(isTransientError(err)).toBe(true);
    const refused = new Error("connect ECONNREFUSED") as Error & { code: string };
    refused.code = "ECONNREFUSED";
    expect(isTransientError(refused)).toBe(true);
  });

  it.each([
    "cannot execute CREATE EXTENSION in a read-only transaction",
    "the cluster is in read-only mode",
    "terminating connection due to administrator command",
  ])("classifies text fallback %j as transient", (message) => {
    expect(classifyError(new Error(message))).toBe("transient");
  });

  it("still classifies already-exists as idempotent (42P07 + text)", () => {
    const err = new Error('relation "users" already exists') as Error & {
      code: string;
    };
    err.code = "42P07";
    expect(classifyError(err)).toBe("idempotent");
    expect(classifyError(new Error("duplicate object"))).toBe("idempotent");
  });

  it("classifies unknown schema errors as critical", () => {
    const err = new Error('column "nope" of relation "users" does not exist') as Error & {
      code: string;
    };
    err.code = "42703";
    expect(classifyError(err)).toBe("critical");
  });
});

describe("waitForWritableDatabase — Layer 1 probe gate", () => {
  it("returns immediately when the probe reports writable", async () => {
    let calls = 0;
    const ok = await waitForWritableDatabase({
      probeFn: async () => {
        calls += 1;
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("polls until the database becomes writable", async () => {
    let attempts = 0;
    const ok = await waitForWritableDatabase({
      probeFn: async () => {
        attempts += 1;
        return attempts >= 3; // failover clears on the 3rd probe
      },
      maxWaitMs: 1000,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("treats probe connection errors as not-writable and keeps polling", async () => {
    let attempts = 0;
    const ok = await waitForWritableDatabase({
      probeFn: async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("connect ECONNREFUSED");
        return true;
      },
      maxWaitMs: 1000,
      pollMs: 1,
    });
    expect(ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("gives up (false) after the wait budget on a permanently read-only database", async () => {
    let attempts = 0;
    const ok = await waitForWritableDatabase({
      probeFn: async () => {
        attempts += 1;
        return false;
      },
      maxWaitMs: 20,
      pollMs: 2,
    });
    expect(ok).toBe(false);
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  it("isDatabaseWritable parses the raw probe rows correctly", async () => {
    const { isDatabaseWritable } = await import("../../lib/boot-migrations");
    // default executor (mocked db) says writable
    expect(await isDatabaseWritable()).toBe(true);
    mockExecute.mockResolvedValueOnce({
      rows: [{ in_recovery: true, tro: "off" }],
    } as never);
    expect(await isDatabaseWritable()).toBe(false);
    mockExecute.mockResolvedValueOnce({
      rows: [{ in_recovery: false, tro: "on" }],
    } as never);
    expect(await isDatabaseWritable()).toBe(false);
    mockExecute.mockRejectedValueOnce(new Error("connection refused"));
    expect(await isDatabaseWritable()).toBe(false);
  });
});

describe("bootMigrations — end-to-end classification outcomes", () => {
  it("returns ok on a clean first run", async () => {
    mockRunMigrations.mockResolvedValue(undefined);
    const result = await bootMigrations();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
  });

  it("retries the FULL run after a transient (25006) failure and reports transient_recovered", async () => {
    mockRunMigrations.mockRejectedValueOnce(transientError()).mockResolvedValueOnce(undefined);
    const result = await bootMigrations();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("transient_recovered");
    expect(mockRunMigrations).toHaveBeenCalledTimes(2);
    expect(result.error).toContain("read-only transaction");
  });

  it("retries 3 times (5s/15s/45s schedule) then fails loudly as transient_exhausted", async () => {
    mockRunMigrations.mockRejectedValue(transientError());
    const result = await bootMigrations();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("transient_exhausted");
    // initial run + 3 retries
    expect(mockRunMigrations).toHaveBeenCalledTimes(4);
  });

  it("escalates immediately to critical on non-transient failures (no retry)", async () => {
    const err = new Error('column "nope" does not exist') as Error & { code: string };
    err.code = "42703";
    mockRunMigrations.mockRejectedValue(err);
    const result = await bootMigrations();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("critical");
    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
  });

  it("swallows idempotent (already exists) errors as ok", async () => {
    const err = new Error('relation "users" already exists') as Error & {
      code: string;
    };
    err.code = "42P07";
    mockRunMigrations.mockRejectedValue(err);
    const result = await bootMigrations();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("idempotent");
  });

  it("a retry that fails with a CRITICAL error stops retrying immediately", async () => {
    const critical = new Error('column "nope" does not exist') as Error & {
      code: string;
    };
    critical.code = "42703";
    mockRunMigrations.mockRejectedValueOnce(transientError()).mockRejectedValueOnce(critical);
    const result = await bootMigrations();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("critical");
    expect(mockRunMigrations).toHaveBeenCalledTimes(2);
  });

  it("never runs DDL when the database never becomes writable (Layer 1 gate, probe timeout)", async () => {
    // Probe always reports a standby / read-only primary.
    mockExecute.mockImplementation(
      asExecuteImpl(async () => ({ rows: [{ in_recovery: true, tro: "on" }] })),
    );
    const result = await bootMigrations();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("transient_exhausted");
    expect(result.error).toContain("not writable");
    // The DDL body must never have been attempted.
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it("skips everything when DISABLE_BOOT_MIGRATIONS=true", async () => {
    process.env.DISABLE_BOOT_MIGRATIONS = "true";
    const result = await bootMigrations();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("skipped_disabled");
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });
});
