import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, execTestSql, initTestDb, resetTestDb } from "../../test/db";
import { applyPushTokensStage } from "../../migrate";

/**
 * V1-M37 (R191, backend mobile contracts) — push_tokens, the upgrade path.
 *
 * The fresh-install path is pinned by the harness DDL itself (the pglite
 * schema carries the table). THIS suite pins the boot stage's convergence
 * of a PRE-R191 database — the production upgrade case:
 *
 *   1. a database without push_tokens gets the table with the EXACT
 *      object names the drizzle mirror (chain 0028) declares —
 *      push_tokens_expo_push_token_unique, chk_push_tokens_platform,
 *      push_tokens_user_id_users_id_fk, idx_push_tokens_user_id — so
 *      runtime-built and chain-built databases converge;
 *   2. the constraints actually bite (UNIQUE token, platform CHECK,
 *      user FK ON DELETE CASCADE);
 *   3. a converged database re-runs the stage with zero DDL (the
 *      probe-gated steady-state contract) and its data survives;
 *   4. a PARTIALLY-converged database (table present, FK absent — the
 *      shape an interrupted first boot leaves) converges via the
 *      duplicate_object-swallowed ADD CONSTRAINT.
 */

async function tableExists(): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = 'push_tokens'`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function constraintNames(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT conname FROM pg_constraint WHERE conrelid = 'push_tokens'::regclass
    ORDER BY conname
  `);
  const rows = (result as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
  return rows.map((r) => r.conname);
}

async function indexNames(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT indexname FROM pg_indexes WHERE tablename = 'push_tokens' ORDER BY indexname
  `);
  const rows = (result as unknown as { rows?: Array<{ indexname: string }> }).rows ?? [];
  return rows.map((r) => r.indexname);
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(query);
  const rows = (result as unknown as { rows?: Array<{ c?: number }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

async function seedUser(): Promise<number> {
  const result = await db.execute(
    sql`INSERT INTO users (phone) VALUES ('9460370001') RETURNING id`,
  );
  const rows = (result as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  return rows[0]!.id;
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Start from the PRE-R191 shape: no push_tokens table at all.
  await db.execute(sql.raw(`DROP TABLE IF EXISTS push_tokens`));
});

describe("V1-M37 (R191) — push_tokens: the upgrade convergence", () => {
  it("creates the table with the drizzle-mirror object names (runtime/chain convergence)", async () => {
    expect(await tableExists()).toBe(false);

    await applyPushTokensStage();

    expect(await tableExists()).toBe(true);
    // The exact names chain 0028 + schema/push-tokens.ts declare (plus the
    // auto-named uuid pkey) — sorted: pg constraint catalogs have no
    // guaranteed listing order across engines.
    expect((await constraintNames()).sort()).toEqual(
      [
        "chk_push_tokens_platform",
        "push_tokens_expo_push_token_unique",
        "push_tokens_user_id_users_id_fk",
        "push_tokens_pkey",
      ].sort(),
    );
    expect(await indexNames()).toContain("idx_push_tokens_user_id");
  });

  it("the constraints bite: UNIQUE token + platform CHECK + uuid default", async () => {
    await applyPushTokensStage();
    const userId = await seedUser();

    await db.execute(sql`
      INSERT INTO push_tokens (user_id, expo_push_token, platform)
      VALUES (${userId}, 'ExponentPushToken[stage1]', 'android')
    `);
    // id came from the gen_random_uuid() default.
    expect(await scalar(sql`SELECT count(*) AS c FROM push_tokens WHERE id IS NOT NULL`)).toBe(1);

    // Duplicate token → 23505 (unique violation).
    await expect(
      db.execute(sql`
        INSERT INTO push_tokens (user_id, expo_push_token, platform)
        VALUES (${userId}, 'ExponentPushToken[stage1]', 'ios')
      `),
    ).rejects.toThrow();

    // Bad platform → 23514 (check violation).
    await expect(
      db.execute(sql`
        INSERT INTO push_tokens (user_id, expo_push_token, platform)
        VALUES (${userId}, 'ExponentPushToken[stage2]', 'webos')
      `),
    ).rejects.toThrow();
  });

  it("the user FK is ON DELETE CASCADE (the sessions-table style)", async () => {
    await applyPushTokensStage();
    const userId = await seedUser();
    await db.execute(sql`
      INSERT INTO push_tokens (user_id, expo_push_token, platform)
      VALUES (${userId}, 'ExponentPushToken[cascade1]', 'ios')
    `);

    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    expect(await scalar(sql`SELECT count(*) AS c FROM push_tokens`)).toBe(0);
  });

  it("a converged database re-runs the stage as a no-op (idempotent, data survives)", async () => {
    await applyPushTokensStage();
    const userId = await seedUser();
    await db.execute(sql`
      INSERT INTO push_tokens (user_id, expo_push_token, platform)
      VALUES (${userId}, 'ExponentPushToken[keep1]', 'android')
    `);

    // Second run: no throw, no data loss.
    await applyPushTokensStage();
    expect(await scalar(sql`SELECT count(*) AS c FROM push_tokens`)).toBe(1);
  });

  it("a PARTIALLY-converged database (table without the FK) converges via the swallowed ADD CONSTRAINT", async () => {
    // The interrupted-first-boot shape: the CREATE landed, the FK did not.
    await execTestSql(`
      CREATE TABLE push_tokens (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        user_id         INTEGER NOT NULL,
        expo_push_token VARCHAR(255) NOT NULL,
        platform        VARCHAR(16) NOT NULL,
        device_label    VARCHAR(255),
        created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
        updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
        last_seen_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
        revoked_at      TIMESTAMPTZ,
        CONSTRAINT push_tokens_expo_push_token_unique UNIQUE (expo_push_token),
        CONSTRAINT chk_push_tokens_platform CHECK (platform IN ('android','ios'))
      );
    `);
    expect(await constraintNames()).not.toContain("push_tokens_user_id_users_id_fk");

    await applyPushTokensStage();

    expect(await constraintNames()).toContain("push_tokens_user_id_users_id_fk");
    expect(await indexNames()).toContain("idx_push_tokens_user_id");
    // And the FK enforces the real reference.
    await expect(
      db.execute(sql`
        INSERT INTO push_tokens (user_id, expo_push_token, platform)
        VALUES (999999, 'ExponentPushToken[badfk]', 'android')
      `),
    ).rejects.toThrow();
  });
});
