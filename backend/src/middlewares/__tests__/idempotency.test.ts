import express, { type Express, type Request, type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "../../lib/redis-client";
import { idempotency } from "../idempotency";

/**
 * R111-FIX-T / W2 (R111-T1 §W2) — DIRECT tests for the HTTP idempotency
 * middleware (287 lines, mounted on /api/orders, /api/wallet/topups,
 * /api/loyalty/convert-points and admin adjustment).
 *
 * Until now this middleware had ZERO direct tests: every "idempotency" test
 * basename hit lib/idempotency (the durable layer), and the only route-level
 * coverage (wallet-topups-idempotency.test.ts) rides an in-memory Redis
 * double that honors `NX` but SILENTLY IGNORES `EX` — so the 24 h replay TTL
 * and the 60 s in-flight sentinel TTL were untested anywhere. Deleting `EX`
 * from either SET kept the whole 1312-test backend suite green.
 *
 * This file pins the TTL contract with a double that actually expires keys:
 *
 *   1. Pass-throughs: no key / short key / no subject / Redis unavailable.
 *   2. First keyed request: in-flight sentinel `SET NX EX 60`, response
 *      cached with `SET EX 86400` (the TTL params are ASSERTED, not assumed).
 *   3. Completed same-key retry → replay (status + body + headers), handler
 *      still executed exactly once.
 *   4. In-flight same-key → 409 IDEMPOTENCY_IN_FLIGHT; 60 s later the
 *      sentinel expires and a new request proceeds live.
 *   5. 24 h TTL expiry → fresh live execution.
 *   6. Same key + different body → 409 IDEMPOTENCY_KEY_REUSE.
 *   7. Non-2xx releases the key (del) so a corrected retry runs live.
 *   8. Subject isolation (user vs admin) via the cache-key namespace.
 *   9. AUD103-2-F4: credential fields redacted in the CACHED copy only.
 *  10. F-3 (R118-A1): two same-key arrivals that BOTH miss the GET race
 *      on the sentinel SET NX — exactly one proceeds to the handler, the
 *      loser is answered with the same 409 IDEMPOTENCY_IN_FLIGHT as the
 *      GET path (previously the SET NX result was ignored and BOTH ran).
 *
 * The Redis singleton is mocked with the capture client below; the raced
 * wrapper is a passthrough (its timeout behavior is pinned in
 * redis-client-resilience.test.ts — same split as wallet-topups-idempotency).
 * Expiry is driven by MANUAL CLOCK INJECTION inside the double (no fake
 * timers — the middleware's fire-and-forget cache writes stay real).
 *
 * Mounting follows the route-suite pattern: real express app + real fetch
 * against listen(0).
 */

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(),
  withRedisCommandTimeout: <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const getRedisClientMock = vi.mocked(getRedisClient);

const ROUTE_KEY = "t.mutate";
const USER_ID = 42;
const ADMIN_ID = 7;

type Subject = "user" | "admin" | "none";

function buildApp(handler: RequestHandler, subject: Subject = "user"): Express {
  const app = express();
  app.use(express.json());
  if (subject !== "none") {
    app.use((req: Request, _res, next) => {
      const decorated = req as Request & { adminId?: number; userId?: number };
      if (req.header("x-subject") === "admin") decorated.adminId = ADMIN_ID;
      else decorated.userId = USER_ID;
      next();
    });
  }
  app.post("/mutate", idempotency({ routeKey: ROUTE_KEY }), handler);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/mutate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

function cacheKeyFor(userKey: string, subjectKind = "user", subjectId = USER_ID): string {
  // Mirrors buildCacheKey(): idempotent:{kind}:{id}:{routeKey}:{userKey}
  return `idempotent:${subjectKind}:${subjectId}:${ROUTE_KEY}:${userKey}`;
}

/** Let the middleware's fire-and-forget cache writes (del on non-2xx, SET on
 * 2xx) land before the test inspects the double's store. */
async function settle(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !predicate(); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!predicate()) throw new Error(`timed out waiting for ${what}`);
}

interface RecordedSet {
  key: string;
  value: string;
  /** The EX seconds argument — undefined when the caller sent no TTL. */
  ex?: number;
  nx: boolean;
}

interface TtlRedisDouble {
  client: NonNullable<ReturnType<typeof getRedisClient>>;
  setCalls: RecordedSet[];
  delCalls: string[];
  /** Move the double's clock forward WITHOUT touching real timers. */
  advanceClock(ms: number): void;
  /** Live view of the store — expired entries read as null (like GET). */
  peek(key: string): { value: string; expiresAt: number } | null;
}

/**
 * In-memory Redis double covering exactly the surface the middleware uses
 * (get / set(key, value, {EX, NX}) / del — node-redis v5 shape, SET NX on an
 * existing key resolves null), but — unlike the route-suite double — it
 * HONORS `EX`: entries carry an absolute expiry computed from an injectable
 * clock, so tests can age keys past the 60 s in-flight / 24 h replay TTLs.
 * Every SET records its TTL argument so the tests can prove `EX` was passed.
 */
function installTtlRedis(): TtlRedisDouble {
  interface Entry {
    value: string;
    expiresAt: number;
  }
  const store = new Map<string, Entry>();
  let clockOffsetMs = 0;
  const now = () => Date.now() + clockOffsetMs;
  const live = (key: string): Entry | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };
  const double: TtlRedisDouble = {
    client: {
      isReady: true,
      get: async (key: string) => live(key)?.value ?? null,
      set: async (key: string, value: string, opts: { EX?: number; NX?: boolean } = {}) => {
        double.setCalls.push({ key, value, ex: opts.EX, nx: opts.NX === true });
        if (opts.NX && live(key)) return null;
        const ex = typeof opts.EX === "number" && opts.EX > 0 ? opts.EX : 0;
        store.set(key, {
          value,
          expiresAt: ex > 0 ? now() + ex * 1000 : Number.POSITIVE_INFINITY,
        });
        return "OK";
      },
      del: async (...keys: string[]) => {
        let removed = 0;
        for (const key of keys) {
          double.delCalls.push(key);
          if (store.delete(key)) removed += 1;
        }
        return removed;
      },
    } as unknown as TtlRedisDouble["client"],
    setCalls: [],
    delCalls: [],
    advanceClock: (ms: number) => {
      clockOffsetMs += ms;
    },
    peek: (key: string) => live(key),
  };
  getRedisClientMock.mockReturnValue(double.client);
  return double;
}

beforeEach(() => {
  getRedisClientMock.mockReset();
});

/**
 * F-3 (R118-A1) double: deterministically reproduces the same-tick race.
 * The FIRST `get` for a key BLOCKS until a second `get` for the same key
 * arrives, so two concurrent requests are forced to both miss the lookup
 * BEFORE either has stored the sentinel — the exact window the old
 * middleware let through (both proceeded; the SET NX loser's null was
 * ignored). SET honors NX like the TTL double (loser resolves null), and a
 * 2 s failsafe releases a stranded gate so a wiring regression fails the
 * test instead of hanging it.
 */
function installRaceWindowRedis(): { setCalls: RecordedSet[] } {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const setCalls: RecordedSet[] = [];
  const waiters: Array<() => void> = [];
  let getsForRacingKey = 0;
  const now = () => Date.now();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };
  const client = {
    isReady: true,
    get: async (key: string) => {
      getsForRacingKey += 1;
      if (getsForRacingKey === 1) {
        // Hold the first GET open until a peer GET arrives (or the
        // failsafe fires) — both lookups must observe an EMPTY store.
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 2_000);
        });
      } else {
        for (const w of waiters) w();
      }
      return live(key)?.value ?? null;
    },
    set: async (key: string, value: string, opts: { EX?: number; NX?: boolean } = {}) => {
      setCalls.push({ key, value, ex: opts.EX, nx: opts.NX === true });
      if (opts.NX && live(key)) return null;
      const ex = typeof opts.EX === "number" && opts.EX > 0 ? opts.EX : 0;
      store.set(key, {
        value,
        expiresAt: ex > 0 ? now() + ex * 1000 : Number.POSITIVE_INFINITY,
      });
      return "OK";
    },
    del: async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return removed;
    },
  } as unknown as NonNullable<ReturnType<typeof getRedisClient>>;
  getRedisClientMock.mockReturnValue(client);
  return { setCalls };
}

describe("idempotency middleware — pass-through branches (availability over strictness)", () => {
  it("no Idempotency-Key → pass-through WITHOUT touching Redis (phase-1 legacy shape)", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const res = await post(url, { amount: 50 });
      expect(res.status).toBe(201);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(getRedisClientMock).not.toHaveBeenCalled();
      expect(double.setCalls).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("an Idempotency-Key shorter than 8 chars → pass-through (same phase-1 branch)", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const res = await post(url, { amount: 50 }, { "Idempotency-Key": "short" });
      expect(res.status).toBe(201);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(getRedisClientMock).not.toHaveBeenCalled();
      expect(double.setCalls).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("no authenticated subject (route mounted without an auth middleware) → pass-through", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler, "none"));
    try {
      const res = await post(url, { amount: 50 }, { "Idempotency-Key": "valid key one" });
      expect(res.status).toBe(201);
      expect(handler).toHaveBeenCalledTimes(1);
      // Refuses to dedup without a subject — a programming error, not user input.
      expect(getRedisClientMock).not.toHaveBeenCalled();
      expect(double.setCalls).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("Redis unavailable → pass-through on EVERY request (no in-memory dedup half-state)", async () => {
    getRedisClientMock.mockReturnValue(null);
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, n: handler.mock.calls.length });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const first = await post(url, { amount: 50 }, { "Idempotency-Key": "down key one" });
      const second = await post(url, { amount: 50 }, { "Idempotency-Key": "down key one" });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBeNull();
      // Availability over strict guarantees — both ran live; the durable
      // in-tx idempotency_keys claim is the backstop on this path.
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      close();
    }
  });
});

describe("idempotency middleware — the TTL contract (what the route-suite double ignores)", () => {
  it("first keyed request: in-flight sentinel SET NX EX 60, response cached with EX 86400", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, n: 1 });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "first key one";
      const res = await post(url, { amount: 50 }, { "Idempotency-Key": key });
      expect(res.status).toBe(201);
      await settle();

      const cacheKey = cacheKeyFor(key);
      // EXACTLY two writes: the in-flight sentinel, then the cached response.
      expect(double.setCalls.map((c) => c.key)).toEqual([cacheKey, cacheKey]);

      const [sentinelSet, cacheSet] = double.setCalls;
      // The sentinel: NX + the 60s in-flight TTL. (Deleting EX here — the
      // W2 mutation — fails these assertions.)
      expect(sentinelSet.value).toBe("__in_flight__");
      expect(sentinelSet.nx).toBe(true);
      expect(sentinelSet.ex).toBe(60);
      // The cached response: the full 24h replay TTL, no NX.
      expect(cacheSet.nx).toBe(false);
      expect(cacheSet.ex).toBe(24 * 60 * 60);

      const payload = JSON.parse(cacheSet.value) as {
        hash: string;
        status: number;
        body: unknown;
        completedAt: string;
      };
      expect(payload).toMatchObject({ status: 201, body: { ok: true, n: 1 } });
      expect(typeof payload.hash).toBe("string");
      expect(payload.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("completed same-key same-body retry REPLAYS status+body with the replay headers — handler runs once", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, order: "SN one" });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "replay key one";
      const first = await post(url, { amount: 50 }, { "Idempotency-Key": key });
      expect(first.status).toBe(201);
      await settle();

      const retry = await post(url, { amount: 50 }, { "Idempotency-Key": key });
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect(retry.headers.get("Idempotent-Original-At")).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      // The money mutation was NOT executed a second time.
      expect(handler).toHaveBeenCalledTimes(1);
      // No additional Redis writes on the replay path.
      expect(double.setCalls).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("same key with a DIFFERENT body → 409 IDEMPOTENCY_KEY_REUSE (client bug surfaced)", async () => {
    installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "reuse key one";
      const first = await post(url, { amount: 50 }, { "Idempotency-Key": key });
      expect(first.status).toBe(201);
      await settle();

      const conflict = await post(url, { amount: 900 }, { "Idempotency-Key": key });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("in-flight same-key → 409 IDEMPOTENCY_IN_FLIGHT (handler not re-entered); completing the original then replays", async () => {
    const double = installTtlRedis();
    const gate = deferred();
    const handler = vi.fn((req, res) => {
      if ((req.body as { block?: boolean }).block) {
        void gate.promise.then(() => res.status(201).json({ ok: true, n: 1 }));
        return;
      }
      res.status(201).json({ ok: true, n: 1 });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "flight key one";
      const headers = { "Idempotency-Key": key };

      // Request A: acquires the in-flight sentinel and blocks inside the
      // handler (a slow money mutation).
      const inFlight = post(url, { block: true }, headers);
      await until(
        () => double.setCalls.some((c) => c.value === "__in_flight__"),
        "the in-flight sentinel to be stored",
      );

      // Request B (concurrent retry, same key) must see the sentinel.
      const raced = await post(url, { block: true }, headers);
      expect(raced.status).toBe(409);
      expect(raced.body).toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT" });
      // Reality note (spec-vs-code): the middleware does NOT set a
      // Retry-After header on this 409 today — the frontend keeps its key
      // and retries on its own cadence (checkout-idempotency-keys.test.tsx
      // pins that client side). Deliberately not asserted either way here.
      expect(handler).toHaveBeenCalledTimes(1);

      // The original completes → its response is cached under the same key…
      gate.resolve();
      expect((await inFlight).status).toBe(201);
      await settle();

      // …so the next same-key attempt replays instead of re-executing.
      const replay = await post(url, { block: true }, headers);
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
      close();
    }
  });

  it("60s in-flight sentinel TTL expiry → a new same-key request proceeds LIVE instead of 409", async () => {
    const double = installTtlRedis();
    const gate = deferred();
    const handler = vi.fn((req, res) => {
      if ((req.body as { block?: boolean }).block) {
        void gate.promise.then(() => res.status(201).json({ ok: true, blocked: true }));
        return;
      }
      res.status(201).json({ ok: true, blocked: false });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "stale flight one";
      const headers = { "Idempotency-Key": key };

      const stuck = post(url, { block: true }, headers);
      await until(
        () => double.setCalls.some((c) => c.value === "__in_flight__"),
        "the in-flight sentinel to be stored",
      );

      // Age the sentinel past its 60s TTL (manual clock — no real waiting).
      double.advanceClock(60_000 + 1_000);

      const next = await post(url, { block: false }, headers);
      expect(next.status).toBe(201);
      expect(next.body).toEqual({ ok: true, blocked: false });
      expect(next.headers.get("Idempotent-Replayed")).toBeNull();
      // The expired sentinel no longer 409s: the request executed live.
      expect(handler).toHaveBeenCalledTimes(2);

      gate.resolve();
      expect((await stuck).status).toBe(201);
    } finally {
      gate.resolve();
      close();
    }
  });

  it("24h TTL expiry → the cached replay evaporates and the request re-executes live", async () => {
    const double = installTtlRedis();
    let executions = 0;
    const handler = vi.fn((_req, res) => {
      executions += 1;
      res.status(201).json({ ok: true, n: executions });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "ttl key one";
      const headers = { "Idempotency-Key": key };

      const first = await post(url, { amount: 50 }, headers);
      expect(first.body).toEqual({ ok: true, n: 1 });
      await settle();
      expect(double.peek(cacheKeyFor(key))).not.toBeNull();

      // 24h + a second: the cached response is gone from the double.
      double.advanceClock(24 * 60 * 60 * 1000 + 1_000);
      expect(double.peek(cacheKeyFor(key))).toBeNull();

      // A retry after the TTL is a genuinely fresh execution…
      const fresh = await post(url, { amount: 50 }, headers);
      expect(fresh.status).toBe(201);
      expect(fresh.body).toEqual({ ok: true, n: 2 });
      expect(fresh.headers.get("Idempotent-Replayed")).toBeNull();
      expect(handler).toHaveBeenCalledTimes(2);

      // …and its response is cached again under a fresh 24h TTL.
      await settle();
      const reCached = double.setCalls.filter((c) => c.value !== "__in_flight__").at(-1);
      expect(reCached?.ex).toBe(24 * 60 * 60);
    } finally {
      close();
    }
  });

  it("non-2xx releases the key (del) — a corrected retry with the SAME key runs live", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((req, res) => {
      if ((req.body as { bad?: boolean }).bad) {
        res.status(400).json({ error: "bad input" });
        return;
      }
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "release key one";
      const headers = { "Idempotency-Key": key };

      const bad = await post(url, { bad: true }, headers);
      expect(bad.status).toBe(400);
      await settle();

      // The in-flight sentinel was dropped so the failure doesn't lock the key.
      expect(double.delCalls).toContain(cacheKeyFor(key));
      expect(double.peek(cacheKeyFor(key))).toBeNull();

      const good = await post(url, { bad: false }, headers);
      expect(good.status).toBe(201);
      expect(good.headers.get("Idempotent-Replayed")).toBeNull();
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      close();
    }
  });

  it("a DIFFERENT key is a distinct intent — both execute and cache independently", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const first = await post(url, { amount: 50 }, { "Idempotency-Key": "intent a one" });
      const second = await post(url, { amount: 50 }, { "Idempotency-Key": "intent b two" });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBeNull();
      expect(handler).toHaveBeenCalledTimes(2);
      expect(double.setCalls.map((c) => c.key)).toEqual([
        cacheKeyFor("intent a one"),
        cacheKeyFor("intent a one"),
        cacheKeyFor("intent b two"),
        cacheKeyFor("intent b two"),
      ]);
    } finally {
      close();
    }
  });

  it("subject isolation: the same key string for a user and an admin dedups in SEPARATE cache keys (V4-P0)", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const sharedKey = "shared key one";
      const asUser = await post(url, { amount: 50 }, { "Idempotency-Key": sharedKey });
      const asAdmin = await post(
        url,
        { amount: 50 },
        { "Idempotency-Key": sharedKey, "x-subject": "admin" },
      );
      expect(asUser.status).toBe(201);
      expect(asAdmin.status).toBe(201);
      expect(asAdmin.headers.get("Idempotent-Replayed")).toBeNull();
      expect(handler).toHaveBeenCalledTimes(2);

      const userWrite = double.setCalls.find((c) => c.key === cacheKeyFor(sharedKey));
      const adminWrite = double.setCalls.find(
        (c) => c.key === cacheKeyFor(sharedKey, "admin", ADMIN_ID),
      );
      expect(userWrite).toBeDefined();
      expect(adminWrite).toBeDefined();
      expect(cacheKeyFor(sharedKey)).not.toBe(cacheKeyFor(sharedKey, "admin", ADMIN_ID));
    } finally {
      close();
    }
  });
});

describe("idempotency middleware — AUD103-2-F4 credential redaction (r103)", () => {
  it("delivered_* credential fields are nulled in the CACHED copy only — wire intact, replay redacted", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({
        id: 9,
        delivered_email: "buyer at example",
        delivered_password: "pw value one",
        delivered_extra_details: "extra one",
        note: "kept",
      });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "redact key one";
      const headers = { "Idempotency-Key": key };

      // The FIRST response goes out on the wire UNREDACTED (the client that
      // paid is entitled to its credentials).
      const first = await post(url, { product_id: 1 }, headers);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ delivered_password: "pw value one" });
      await settle();

      // …but the cached copy keeps no 24h plaintext credential store.
      const cacheSet = double.setCalls.find((c) => c.value !== "__in_flight__");
      const cached = JSON.parse(cacheSet!.value) as { body: Record<string, unknown> };
      expect(cached.body).toMatchObject({
        delivered_email: null,
        delivered_password: null,
        delivered_extra_details: null,
        note: "kept",
      });

      // The replay therefore returns the order with credentials nulled —
      // the client re-fetches the order detail, which decrypts live.
      const replay = await post(url, { product_id: 1 }, headers);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(replay.body).toMatchObject({ delivered_password: null, note: "kept" });
    } finally {
      close();
    }
  });
});

describe("idempotency middleware — F-3 (R118-A1): the same-tick concurrent-arrival race", () => {
  it("two same-key requests that both miss the GET race on SET NX — exactly one proceeds, the loser gets the 409", async () => {
    const double = installRaceWindowRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, n: 1 });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "race window one";
      const headers = { "Idempotency-Key": key };

      // Fired together BEFORE any sentinel exists; the gated GET in the
      // double forces BOTH lookups to miss (the first get holds until
      // the peer get arrives) — the exact window the old middleware let
      // through when it ignored the SET NX result.
      const [a, b] = await Promise.all([
        post(url, { amount: 50 }, headers),
        post(url, { amount: 50 }, headers),
      ]);

      // The money mutation ran EXACTLY once…
      expect(handler).toHaveBeenCalledTimes(1);
      // …one request got its 201, the other the in-flight 409.
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body).toMatchObject({
        success: false,
        code: "IDEMPOTENCY_IN_FLIGHT",
      });
      // The loser's 409 is a fresh refusal, not a replay.
      expect(loser.headers.get("Idempotent-Replayed")).toBeNull();

      // Both arrivals ATTEMPTED the atomic claim (NX, 60 s TTL) — the
      // double resolved exactly one of them "OK" and the other null.
      const nxClaims = double.setCalls.filter((c) => c.value === "__in_flight__");
      expect(nxClaims).toHaveLength(2);
      expect(nxClaims.every((c) => c.nx && c.ex === 60)).toBe(true);

      await settle();

      // The winner's 201 was cached normally — the loser's 409 did not
      // poison the key: a follow-up same-key request REPLAYS.
      const replay = await post(url, { amount: 50 }, headers);
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });
});

// ── R122 (A3-P2-4): canonical (key-order-insensitive) body hashing ──────────

/**
 * R122 (A3-P2-4): bodyHash hashed raw JSON.stringify — key-order
 * sensitive. The header comment's "the admin UI is the only sender"
 * assumption stopped holding when the middleware was mounted on the USER
 * routes (orders / wallet topups / loyalty convert), so a non-UI client
 * (or a client-library upgrade that changes key order) retrying a
 * semantically identical body got a false 409 IDEMPOTENCY_KEY_REUSE
 * instead of the replay. The hash now covers the CANONICAL form
 * (recursively key-sorted); a transition window additionally accepts the
 * LEGACY hash so claims cached by a pre-R122 deploy keep replaying for
 * byte-identical retries until the 24 h TTL ages them out.
 */
describe("idempotency middleware — R122 (A3-P2-4): canonical body hash", () => {
  it("a reordered-but-equivalent body REPLAYS (was a false 409 IDEMPOTENCY_KEY_REUSE)", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, n: 1 });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "canonical key one";
      const headers = { "Idempotency-Key": key };

      const first = await post(url, { amount: 50, coupon_code: "SAVE10" }, headers);
      expect(first.status).toBe(201);
      await settle();

      // Same values, different key order — a client-library upgrade or a
      // hand-rolled sender produces exactly this shape on retry.
      const retry = await post(url, { coupon_code: "SAVE10", amount: 50 }, headers);
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect(retry.body).toEqual(first.body);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("reordering is canonicalized RECURSIVELY (nested objects), arrays keep their order", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "canonical nested one";
      const headers = { "Idempotency-Key": key };

      const first = await post(
        url,
        { outer: { b: 2, a: { z: 1, y: 2 } }, list: [1, 2, 3] },
        headers,
      );
      expect(first.status).toBe(201);
      await settle();

      // Nested keys reordered → same canonical form → replay.
      const nested = await post(
        url,
        { list: [1, 2, 3], outer: { a: { y: 2, z: 1 }, b: 2 } },
        headers,
      );
      expect(nested.headers.get("Idempotent-Replayed")).toBe("true");
      expect(handler).toHaveBeenCalledTimes(1);

      // Array ORDER is semantic — a re-ordered array is a different intent.
      const reorderedArray = await post(
        url,
        { outer: { b: 2, a: { z: 1, y: 2 } }, list: [3, 2, 1] },
        headers,
      );
      expect(reorderedArray.status).toBe(409);
      expect(reorderedArray.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("a genuinely different body still 409s (the reuse guard is not weakened)", async () => {
    installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "canonical diff one";
      const headers = { "Idempotency-Key": key };
      const first = await post(url, { amount: 50 }, headers);
      expect(first.status).toBe(201);
      await settle();

      const conflict = await post(url, { amount: 900 }, headers);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("transition window: a claim cached with the OLD order-sensitive hash still replays a byte-identical retry (no false 409 across the deploy)", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true, n: 7 });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "legacy hash one";
      const headers = { "Idempotency-Key": key };
      const body = { amount: 50, coupon_code: "SAVE10" };

      // Seed the double EXACTLY as a pre-R122 deploy would have: the cached
      // payload's hash is the legacy JSON.stringify-based digest.
      const legacyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const cacheKey = cacheKeyFor(key);
      await double.client.set(
        cacheKey,
        JSON.stringify({
          hash: legacyHash,
          status: 201,
          body: { ok: true, n: 7 },
          completedAt: new Date().toISOString(),
        }),
        { EX: 24 * 60 * 60 },
      );

      // The new code computes the CANONICAL hash — a strict comparison
      // would 409 here. The transition window also accepts the legacy
      // digest of the incoming body, so the retry still replays.
      const retry = await post(url, body, headers);
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect(retry.body).toEqual({ ok: true, n: 7 });
      expect(handler).toHaveBeenCalledTimes(0); // served from the claim
    } finally {
      close();
    }
  });

  it("transition window is not a bypass: a legacy-hash claim still 409s a DIFFERENT body", async () => {
    const double = installTtlRedis();
    const handler = vi.fn((_req, res) => {
      res.status(201).json({ ok: true });
    });
    const { url, close } = await listen(buildApp(handler));
    try {
      const key = "legacy hash diff";
      const headers = { "Idempotency-Key": key };

      const legacyHash = createHash("sha256")
        .update(JSON.stringify({ amount: 50 }))
        .digest("hex");
      await double.client.set(
        cacheKeyFor(key),
        JSON.stringify({
          hash: legacyHash,
          status: 201,
          body: { ok: true },
          completedAt: new Date().toISOString(),
        }),
        { EX: 24 * 60 * 60 },
      );

      const conflict = await post(url, { amount: 900 }, headers);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
      expect(handler).toHaveBeenCalledTimes(0);
    } finally {
      close();
    }
  });
});
