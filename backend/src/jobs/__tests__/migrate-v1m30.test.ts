import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { applyOrganizationsRemovalStage } from "../../migrate";

/**
 * R123-E5 (R123-A7 P2) — V1-M30: the organizations table removal.
 *
 * organizations is DEAD (zero route/service/job/frontend references, no
 * INSERT anywhere, 0 live rows — R118-A3; the full-repo sweep re-run at
 * implementation time confirmed only migrate.ts / schema TS / chain /
 * harness / dated docs referenced it). The harness DDL carries the
 * POST-V1-M30 shape (no organizations table, no users.organization_id),
 * so the default run certifies the zero-DDL steady state, and the
 * legacy-shape test restores the pre-R123 boot objects BY HAND (raw SQL,
 * never the stage under test — the v1m25 pristine-state pattern).
 */

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-v1m25). */
function recorder(): Recorded {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value))
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    },
  };
}

/** DDL-class statements (ALTER TABLE / DROP CONSTRAINT / DROP TABLE / DO blocks). */
const DDL_RE = /ALTER\s+TABLE|DROP\s+CONSTRAINT|DROP\s+TABLE|DO\s+\$\$/i;

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = ${name}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

/** Restore the pre-R123 boot shape: the table + the column + the chain-era FK. */
async function restoreLegacyOrganizations(fkName?: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS organizations (
      id serial PRIMARY KEY,
      name varchar(255) NOT NULL,
      slug varchar(100) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT organizations_slug_unique UNIQUE (slug)
    )
  `));
  if (!(await columnExists("users", "organization_id"))) {
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN organization_id integer`));
  }
  await db.execute(
    sql.raw(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS ${fkName ?? "users_organization_id_organizations_id_fk"}`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE users ADD CONSTRAINT ${fkName ?? "users_organization_id_organizations_id_fk"} FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL`,
    ),
  );
}

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
  // Belt-restore the pristine post-V1-M30 shape (a failed assertion in a
  // legacy-shape test must not leak the objects into the next case).
  await db.execute(sql.raw(`DROP TABLE IF EXISTS organizations CASCADE`));
  await db.execute(sql.raw(`ALTER TABLE users DROP COLUMN IF EXISTS organization_id`));
});

describe("V1-M30 — applyOrganizationsRemovalStage (R123-A7 P2)", () => {
  it("steady state: no table, no column → catalog probes only, ZERO DDL", async () => {
    // The harness boots in the post-V1-M30 shape — exactly every steady-
    // state boot after the first post-R123 deploy.
    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("users", "organization_id")).toBe(false);

    const rec = recorder();
    await applyOrganizationsRemovalStage(rec.execute);

    // THE regression pin: three catalog probes, zero DDL statements.
    expect(rec.statements.filter((s) => DDL_RE.test(s))).toHaveLength(0);
    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("users", "organization_id")).toBe(false);
  });

  it("legacy shape (the pre-R123 boot objects): FK swept, column + table dropped, users intact", async () => {
    await restoreLegacyOrganizations();
    expect(await tableExists("organizations")).toBe(true);
    expect(await columnExists("users", "organization_id")).toBe(true);

    await applyOrganizationsRemovalStage();

    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("users", "organization_id")).toBe(false);
    // No FK residue on users (the column drop carries it away; the sweep
    // ran first) — and users itself still works.
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "0917300001" })
      .returning();
    expect(user).toBeDefined();
    // No FK residue on users — the harness's only users FK is the
    // referred_by self-reference (the column drop carried the org FK away
    // after the sweep; nothing else was touched).
    const fkRows = await db.execute(sql`
      SELECT con.conname AS conname
      FROM pg_constraint con
      WHERE con.contype = 'f' AND con.conrelid = 'users'::regclass
    `);
    const rows = (fkRows as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
    expect(rows.map((r) => String(r.conname))).toEqual(["users_referred_by_fkey"]);
  });

  it("a hand-provisioned FK with a divergent name is swept too (V1-M20 belt)", async () => {
    await restoreLegacyOrganizations("custom_weird_org_fk");

    await applyOrganizationsRemovalStage();

    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("users", "organization_id")).toBe(false);
  });

  it("re-running after convergence is a clean no-op (idempotent)", async () => {
    await restoreLegacyOrganizations();
    await applyOrganizationsRemovalStage();
    await applyOrganizationsRemovalStage(); // second run: probes only

    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("users", "organization_id")).toBe(false);
  });
});
