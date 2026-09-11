import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 97-F1 — Postgres-backed leader lease (lib/pg-leader-lease.ts).
 *
 * NO real database is touched: everything is mocked at the POOL boundary
 * (the `__setPgLeaderLeasePoolForTests` seam), exactly one layer below the
 * module under test. The CAS semantics themselves live in the single
 * statement each op sends, so the suite pins BOTH:
 *
 *   1. the statement SHAPE (ON CONFLICT .. DO UPDATE .. WHERE .. RETURNING —
 *      the take-over / idempotent-re-acquire predicate the spec demands), and
 *   2. the outcome mapping + parameter contract, exercised through a tiny
 *      stateful fake that interprets those exact statements for the
 *      singleton (id=1) row — acquire/busy/take-over/refresh/release.
 */

beforeEach(() => {
  vi.resetModules();
});

async function loadLease() {
  return import("../pg-leader-lease");
}

/** Whitespace-normalized SQL text for shape assertions. */
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

interface RecordedCall {
  sql: string;
  values: unknown[];
}

/**
 * Stateful fake of the singleton lease row. Implements the EXACT predicates
 * the module's statements declare:
 *   - INSERT .. ON CONFLICT (id) DO UPDATE .. WHERE expires_at <= now()
 *     OR holder = EXCLUDED.holder  → busy when a FOREIGN lease is unexpired.
 *   - UPDATE .. WHERE holder = $2 AND expires_at > now()  → lost otherwise.
 *   - DELETE .. WHERE holder = $1  → not-held otherwise.
 * The fake's clock is manual so expiry scenarios are deterministic.
 */
function makeFakeLeaseTable() {
  const calls: RecordedCall[] = [];
  let row: { holder: string; expiresAtMs: number } | null = null;
  let nowMs = Date.parse("2026-09-11T00:00:00.000Z");
  let failNextCount = 0;

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (failNextCount > 0) {
      failNextCount -= 1;
      throw new Error(`fake pool failure #${failNextCount + 1}`);
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS scheduler_leader_lease")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO scheduler_leader_lease")) {
      const [holder, ttlSec] = values as [string, number];
      const foreignLeaseAlive = row !== null && row.expiresAtMs > nowMs && row.holder !== holder;
      if (foreignLeaseAlive) return { rows: [], rowCount: 0 }; // ON CONFLICT WHERE not satisfied
      row = { holder, expiresAtMs: nowMs + ttlSec * 1000 };
      return { rows: [{ holder }], rowCount: 1 };
    }
    if (sql.includes("UPDATE scheduler_leader_lease")) {
      const [ttlSec, holder] = values as [number, string];
      if (row !== null && row.holder === holder && row.expiresAtMs > nowMs) {
        row = { holder, expiresAtMs: nowMs + ttlSec * 1000 };
        return { rows: [{ holder }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("DELETE FROM scheduler_leader_lease")) {
      const [holder] = values as [string];
      if (row !== null && row.holder === holder) {
        row = null;
        return { rows: [{ holder }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`fake lease table: unrecognized SQL: ${sql}`);
  });

  return {
    pool: { query },
    query,
    calls,
    advance: (ms: number) => {
      nowMs += ms;
    },
    holder: () => row?.holder ?? null,
    expiresAtMs: () => row?.expiresAtMs ?? null,
    /** Make the next N pool calls reject (error-outcome scenarios). */
    fail: (n = 1) => {
      failNextCount = n;
    },
  };
}

describe("97-F1 — acquire CAS semantics", () => {
  it("acquires on a fresh table (conflict-free insert of singleton row 1)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    expect(fake.holder()).toBe("inst-A");
    expect(fake.expiresAtMs()).toBe(Date.parse("2026-09-11T00:00:00.000Z") + 60_000);
  });

  it("is busy while a FOREIGN holder's lease is unexpired", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    await expect(mod.acquireSchedulerLeaderLease("inst-B", 60)).resolves.toBe("busy");
    expect(fake.holder()).toBe("inst-A"); // B never touched the row
  });

  it("the SAME holder re-acquires idempotently even while unexpired (renewal via acquire)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    // The OR holder = EXCLUDED.holder branch: a demoted instance wins its
    // lease back immediately without waiting for TTL expiry.
    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    expect(fake.holder()).toBe("inst-A");
  });

  it("takes over after the TTL expired", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    fake.advance(60_001); // past the 60s TTL
    await expect(mod.acquireSchedulerLeaderLease("inst-B", 60)).resolves.toBe("acquired");
    expect(fake.holder()).toBe("inst-B");
  });

  it("verifies the RETURNING holder — a foreign row maps to busy, never to acquired", async () => {
    // Defensive pin: per the statement's WHERE clause this cannot happen in
    // Postgres, but if it ever did the module must not self-promote.
    const query = vi.fn(async () => ({ rows: [{ holder: "someone-else" }], rowCount: 1 }));
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests({ query });

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("busy");
  });

  it("acquire is ONE round-trip statement with the CAS shape (ON CONFLICT .. WHERE .. RETURNING)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);

    // Skip the one-time CREATE TABLE bootstrap, then assert the SINGLE
    // acquire statement.
    const acquireCalls = fake.calls.filter((c) =>
      c.sql.includes("INSERT INTO scheduler_leader_lease"),
    );
    expect(acquireCalls).toHaveLength(1);
    expect(acquireCalls[0]?.values).toEqual(["inst-A", 60]);
    expect(norm(acquireCalls[0]!.sql)).toBe(
      norm(`
        INSERT INTO scheduler_leader_lease (id, holder, expires_at)
        VALUES (1, $1, now() + make_interval(secs => $2))
        ON CONFLICT (id) DO UPDATE
          SET holder = EXCLUDED.holder,
              expires_at = EXCLUDED.expires_at
          WHERE scheduler_leader_lease.expires_at <= now()
             OR scheduler_leader_lease.holder = EXCLUDED.holder
        RETURNING holder`),
    );
  });
});

describe("97-F1 — refresh verifies the holder", () => {
  it("renews an unexpired lease for the holder (params: ttl, holder)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    fake.advance(30_000);
    await expect(mod.refreshSchedulerLeaderLease("inst-A", 60)).resolves.toBe("renewed");
    expect(fake.holder()).toBe("inst-A");
    expect(fake.expiresAtMs()).toBe(Date.parse("2026-09-11T00:00:00.000Z") + 90_000);

    const refreshCalls = fake.calls.filter((c) => c.sql.includes("UPDATE scheduler_leader_lease"));
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.values).toEqual([60, "inst-A"]);
    expect(norm(refreshCalls[0]!.sql)).toBe(
      norm(`
        UPDATE scheduler_leader_lease
        SET expires_at = now() + make_interval(secs => $1)
        WHERE id = 1 AND holder = $2 AND expires_at > now()
        RETURNING holder`),
    );
  });

  it("is lost for a non-holder after a take-over", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    fake.advance(60_001);
    await expect(mod.acquireSchedulerLeaderLease("inst-B", 60)).resolves.toBe("acquired");
    // A's next refresh must NOT renew B's lease and must report lost — the
    // coordinator demotes on this instead of double-running schedulers.
    await expect(mod.refreshSchedulerLeaderLease("inst-A", 60)).resolves.toBe("lost");
    expect(fake.holder()).toBe("inst-B");
  });

  it("is lost once the lease expired even without a take-over (expiry unverified = not ours)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    fake.advance(60_001);
    await expect(mod.refreshSchedulerLeaderLease("inst-A", 60)).resolves.toBe("lost");
    expect(fake.holder()).toBe("inst-A"); // row untouched — another instance may already be re-acquiring
  });
});

describe("97-F1 — release deletes only OUR row", () => {
  it("releases our lease; another instance can then acquire", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    await expect(mod.releaseSchedulerLeaderLease("inst-A")).resolves.toBe("released");
    expect(fake.holder()).toBeNull();
    await expect(mod.acquireSchedulerLeaderLease("inst-B", 60)).resolves.toBe("acquired");

    const releaseCalls = fake.calls.filter((c) =>
      c.sql.includes("DELETE FROM scheduler_leader_lease"),
    );
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0]?.values).toEqual(["inst-A"]);
    expect(norm(releaseCalls[0]!.sql)).toBe(
      norm(`
        DELETE FROM scheduler_leader_lease
        WHERE id = 1 AND holder = $1
        RETURNING holder`),
    );
  });

  it("a foreign holder's release is not-held (and deletes nothing)", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    await expect(mod.releaseSchedulerLeaderLease("inst-B")).resolves.toBe("not-held");
    expect(fake.holder()).toBe("inst-A");
  });

  it("release after a take-over is not-held", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    fake.advance(60_001);
    await mod.acquireSchedulerLeaderLease("inst-B", 60);
    await expect(mod.releaseSchedulerLeaderLease("inst-A")).resolves.toBe("not-held");
    expect(fake.holder()).toBe("inst-B");
  });
});

describe("97-F1 — error contract: never throws across scheduler boundaries", () => {
  it("maps pool failures on acquire/refresh/release to the 'error' outcome", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    // Each op fails at its first pool round trip (the CREATE TABLE
    // bootstrap for acquire — memo resets — and the statement itself for
    // the rest): every failure maps to "error", nothing throws.
    fake.fail(1);
    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("error");
    fake.fail(1);
    await expect(mod.refreshSchedulerLeaderLease("inst-A", 60)).resolves.toBe("error");
    fake.fail(1);
    await expect(mod.releaseSchedulerLeaderLease("inst-A")).resolves.toBe("error");
  });

  it("a rejecting pool (never resolves a query) maps to 'error', not a throw", async () => {
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests({
      query: async () => {
        throw new Error("connection refused");
      },
    });
    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("error");
    await expect(mod.refreshSchedulerLeaderLease("inst-A", 60)).resolves.toBe("error");
    await expect(mod.releaseSchedulerLeaderLease("inst-A")).resolves.toBe("error");
  });
});

describe("97-F1 — lazy idempotent table bootstrap", () => {
  it("creates the lease table exactly once per pool, before the first op", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    await mod.acquireSchedulerLeaderLease("inst-A", 60);
    await mod.refreshSchedulerLeaderLease("inst-A", 60);
    await mod.releaseSchedulerLeaderLease("inst-A");

    const creates = fake.calls.filter((c) =>
      c.sql.includes("CREATE TABLE IF NOT EXISTS scheduler_leader_lease"),
    );
    expect(creates).toHaveLength(1);
    // Bootstrap ran FIRST — before any lease statement.
    expect(fake.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS scheduler_leader_lease");
    expect(norm(creates[0]!.sql)).toContain("id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1)");
  });

  it("a failed bootstrap yields 'error' once, resets the memo, and retries on the next op", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    fake.fail(1); // the CREATE TABLE itself fails
    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("error");

    await expect(mod.acquireSchedulerLeaderLease("inst-A", 60)).resolves.toBe("acquired");
    const creates = fake.calls.filter((c) =>
      c.sql.includes("CREATE TABLE IF NOT EXISTS scheduler_leader_lease"),
    );
    expect(creates).toHaveLength(2); // the memo was reset and retried
  });
});

describe("97-F1 — backend object (coordinator's consumption shape)", () => {
  it("getSchedulerLeaderLeaseBackend delegates acquire/refresh/release to the same statements", async () => {
    const fake = makeFakeLeaseTable();
    const mod = await loadLease();
    mod.__setPgLeaderLeasePoolForTests(fake.pool);

    const backend = mod.getSchedulerLeaderLeaseBackend();
    await expect(backend.acquire("inst-A", 60)).resolves.toBe("acquired");
    await expect(backend.refresh("inst-A", 60)).resolves.toBe("renewed");
    await expect(backend.release("inst-A")).resolves.toBe("released");
    expect(fake.holder()).toBeNull();
  });
});
