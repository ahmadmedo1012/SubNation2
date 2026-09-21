/**
 * Account-link consent token tests — F-003 (security audit 004) +
 * round-97 F2 PostgreSQL fallback.
 *
 * Asserts the security properties of the issue/consume cycle:
 *   - tokens are 256 bits of entropy, hex-encoded
 *   - one-shot via Redis GETDEL (second consume returns EXPIRED)
 *   - consume rejects when candidateUserId differs from issuance
 *   - consume rejects when firebaseUid differs from issuance
 *   - Redis stays PRIMARY: with a client present nothing touches PG
 *   - with Redis ABSENT the `account_link_consents` PG table takes over
 *     (issue writes a row, consume is an atomic DELETE..RETURNING,
 *     expired/double-consume/wrong-hash all reject) — round-97 F2,
 *     closing the user-facing 503 REDIS_UNAVAILABLE outage
 *   - maskEmail / maskPhone produce hint-not-disclosure output
 *
 * Hermetic strategy: `../redis-client` is stubbed in-memory (no real
 * Redis), and `@workspace/db` resolves via vitest.config.ts's alias to
 * the in-process pglite harness — the PG-fallback SQL (CREATE TABLE /
 * INSERT / DELETE..RETURNING / sweep) runs against REAL SQL semantics,
 * never the Neon pool. That is strictly stronger than a vi.fn() pool
 * mock: the WHERE/RETURNING predicates themselves are under test.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../test/db";

// Minimal in-memory Redis stub. Only implements what
// account-link-consent.ts uses today (set / getDel). Returns are typed
// loosely to match node-redis's runtime shape.
type RedisStub = {
  storage: Map<string, string>;
  set: (key: string, value: string, opts: { NX: true; EX: number }) => Promise<"OK" | null>;
  getDel: (key: string) => Promise<string | null>;
  __reset: () => void;
};

let redisStub: RedisStub | null = null;
function makeRedisStub(): RedisStub {
  const storage = new Map<string, string>();
  return {
    storage,
    set: async (key, value, opts) => {
      if (opts.NX && storage.has(key)) return null;
      storage.set(key, value);
      // EX TTL is irrelevant for the unit tests — the consumer never
      // sleeps long enough for it to matter.
      return "OK";
    },
    getDel: async (key) => {
      const v = storage.get(key) ?? null;
      storage.delete(key);
      return v;
    },
    __reset: () => storage.clear(),
  };
}

vi.mock("../redis-client", () => ({
  getRedisClient: () => redisStub,
  initRedisClient: async () => redisStub,
  requireRedisClient: () => redisStub,
  isRedisInitialised: () => redisStub !== null,
  stopPingWatchdog: () => {},
  // AUD103-8-F2 (r103): the consent flow now bounds its Redis commands
  // (issue SET + consume GETDEL) — a passthrough wrapper for the healthy
  // stub mirrors the real module's contract for a responsive client.
  withRedisCommandTimeout: (_label: string, fn: () => Promise<unknown>) => fn(),
}));

// Import AFTER the mock is registered so the module's top-level import
// of getRedisClient resolves to the stub.
const consent = await import("../account-link-consent");

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** timestamptz comes back as Date (node-pg) or ISO string (some drivers) —
 * normalize so assertions work under both. */
function toMs(value: unknown): number {
  return new Date(value as string | Date).getTime();
}

async function pgRows(query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute(query);
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

beforeAll(async () => {
  // Mirror of the module's lazy DDL so the Redis-primary assertions
  // can SELECT against the table before any fallback call ran.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS account_link_consents (
      token text PRIMARY KEY,
      candidate_user_id integer NOT NULL,
      firebase_uid_hash text NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `);
});

beforeEach(async () => {
  redisStub = makeRedisStub();
  await db.execute(sql`DELETE FROM account_link_consents`);
});

afterEach(() => {
  redisStub = null;
});

describe("account-link-consent — issue / consume", () => {
  it("issues a 64-character hex token (256 bits)", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    // 32 bytes encoded as hex = 64 characters.
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two adjacent issues produce different tokens", async () => {
    const a = await consent.issueConsentToken({ candidateUserId: 1, firebaseUid: "uid-a" });
    const b = await consent.issueConsentToken({ candidateUserId: 1, firebaseUid: "uid-a" });
    expect(a).not.toBe(b);
  });

  it("consume succeeds when candidate + uid match issuance", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).resolves.toBeUndefined();
  });

  it("second consume of the same token returns EXPIRED (one-shot)", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("consume rejects with CANDIDATE_MISMATCH when candidate id differs", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 8, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "CANDIDATE_MISMATCH" });
    // The token MUST be deleted on first call regardless of validation
    // outcome — defense against an attacker retrying with corrected
    // fields. A second call returns EXPIRED.
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("consume rejects with FIREBASE_UID_MISMATCH when uid differs", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, {
        candidateUserId: 7,
        firebaseUid: "different-uid",
      }),
    ).rejects.toMatchObject({ code: "FIREBASE_UID_MISMATCH" });
  });

  it("consume rejects with INVALID_TOKEN on malformed input", async () => {
    await expect(
      consent.consumeConsentToken("", { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(
      consent.consumeConsentToken("too-short", {
        candidateUserId: 7,
        firebaseUid: "uid-fake",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("Redis stays PRIMARY: a live client means NO account_link_consents row is written", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 7, firebaseUid: "uid-fake" });
    const rows = await pgRows(sql`SELECT count(*)::int AS n FROM account_link_consents`);
    expect(Number(rows[0]?.n)).toBe(0);
    // ...while the Redis stub holds the record.
    expect(redisStub!.storage.has(`account-link-consent:${token}`)).toBe(true);
  });

  it("does NOT store the raw firebase UID in Redis (only its sha256 hash)", async () => {
    const uid = "very-recognisable-uid-do-not-leak";
    const token = await consent.issueConsentToken({ candidateUserId: 7, firebaseUid: uid });
    const stored = redisStub!.storage.get(`account-link-consent:${token}`)!;
    expect(stored).not.toContain(uid);
    // The hash IS present (verifies the schema).
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });
});

describe("account-link-consent — PostgreSQL fallback (Redis absent, R97 F2)", () => {
  // Runs AFTER the file-level beforeEach (which installs a live Redis
  // stub) — the null wins, so every test in this block exercises the
  // account_link_consents PG path.
  beforeEach(() => {
    redisStub = null;
  });

  it("issue persists a row bound to (candidate, sha256(uid)) with a ~5-minute expiry — no 503", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-pg" });
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const rows = await pgRows(
      sql`SELECT candidate_user_id, firebase_uid_hash, expires_at FROM account_link_consents WHERE token = ${token}`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Number(row.candidate_user_id)).toBe(9);
    // The stored hash is exactly sha256(uid) — and never the raw UID.
    expect(row.firebase_uid_hash).toBe(sha256Hex("uid-pg"));
    expect(String(row.firebase_uid_hash)).not.toContain("uid-pg");
    // TTL: 5 minutes ± 1 minute of slop.
    const ttlMs = toMs(row.expires_at) - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60_000);
    expect(ttlMs).toBeLessThan(6 * 60_000);
  });

  it("consume succeeds on a matching pair and the row is GONE afterwards", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-pg" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-pg" }),
    ).resolves.toBeUndefined();

    const rows = await pgRows(
      sql`SELECT count(*)::int AS n FROM account_link_consents WHERE token = ${token}`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("double consume is rejected (one-shot — DELETE..RETURNING is atomic)", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-pg" });
    await consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-pg" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-pg" }),
    ).rejects.toMatchObject({ code: "EXPIRED", statusCode: 400 });
  });

  it("an expired token is rejected (expires_at > now() predicate)", async () => {
    // Pin Math.random high so the async sweep stays disabled — the
    // "row still present" assertion below must be deterministic.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-pg" });
      await db.execute(
        sql`UPDATE account_link_consents SET expires_at = now() - interval '1 hour' WHERE token = ${token}`,
      );

      await expect(
        consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-pg" }),
      ).rejects.toMatchObject({ code: "EXPIRED", statusCode: 400 });

      // The expired row itself is NOT deleted by the consume (it fails
      // the predicate) — removal is the sweep's job.
      const rows = await pgRows(
        sql`SELECT count(*)::int AS n FROM account_link_consents WHERE token = ${token}`,
      );
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("a wrong firebase UID is rejected with FIREBASE_UID_MISMATCH — and the token is dead (anti-retry)", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-a" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-b" }),
    ).rejects.toMatchObject({ code: "FIREBASE_UID_MISMATCH", statusCode: 409 });
    // The row was still deleted on the first consume — retrying with
    // the CORRECT fields must not succeed either.
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-a" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("a wrong candidate id is rejected with CANDIDATE_MISMATCH — same anti-retry death", async () => {
    const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-a" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 10, firebaseUid: "uid-a" }),
    ).rejects.toMatchObject({ code: "CANDIDATE_MISMATCH", statusCode: 409 });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-a" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("the probabilistic sweep (10%) removes expired rows when it fires", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01); // < 0.1 → sweep fires
    try {
      const expiredToken = "deadbeef".repeat(8);
      await db.execute(
        sql`INSERT INTO account_link_consents (token, candidate_user_id, firebase_uid_hash, expires_at)
            VALUES (${expiredToken}, 1, ${"ab".repeat(32)}, now() - interval '1 hour')`,
      );

      // A normal issue+consume cycle on a DIFFERENT token is what
      // triggers the sweep.
      const token = await consent.issueConsentToken({ candidateUserId: 9, firebaseUid: "uid-pg" });
      await consent.consumeConsentToken(token, { candidateUserId: 9, firebaseUid: "uid-pg" });

      // The sweep is fire-and-forget — give the DELETE a moment to land.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rows = await pgRows(sql`SELECT count(*)::int AS n FROM account_link_consents`);
      expect(Number(rows[0]?.n)).toBe(0); // consumed token AND expired row both gone
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("consume with no Redis and no row (garbage token) rejects EXPIRED, not 503", async () => {
    const garbage = "f".repeat(64); // well-formed shape, never issued
    await expect(
      consent.consumeConsentToken(garbage, { candidateUserId: 9, firebaseUid: "uid-pg" }),
    ).rejects.toMatchObject({ code: "EXPIRED", statusCode: 400 });
  });
});

describe("account-link-consent — masking helpers", () => {
  it("masks an email to first-letter + 4 dots + domain", () => {
    expect(consent.maskEmail("john.doe@example.com")).toBe("j••••@example.com");
    expect(consent.maskEmail("a@b.co")).toBe("a••••@b.co");
  });

  it("hides the local-part length (always 4 dots regardless of input)", () => {
    // Long local part — still 4 dots, not 8.
    expect(consent.maskEmail("a-very-long-username@example.com")).toBe("a••••@example.com");
  });

  it("returns null for malformed / missing email", () => {
    expect(consent.maskEmail(null)).toBeNull();
    expect(consent.maskEmail(undefined)).toBeNull();
    expect(consent.maskEmail("")).toBeNull();
    expect(consent.maskEmail("no-at-sign")).toBeNull();
    expect(consent.maskEmail("@no-local")).toBeNull();
    expect(consent.maskEmail("no-domain@")).toBeNull();
  });

  it("masks a Libyan phone — head + tail visible, middle hidden", () => {
    // 9-digit Libyan local format: head 1 + 6 dots + tail 2.
    expect(consent.maskPhone("912345678")).toBe("9••••••78");
  });

  it("returns null for too-short phones", () => {
    expect(consent.maskPhone(null)).toBeNull();
    expect(consent.maskPhone("")).toBeNull();
    expect(consent.maskPhone("12")).toBeNull();
  });
});
