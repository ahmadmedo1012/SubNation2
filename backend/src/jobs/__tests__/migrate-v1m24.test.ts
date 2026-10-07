import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { notificationsTable, supportTicketsTable } from "@workspace/db/schema";
import { applyListReadPathIndexesStage } from "../../migrate";

/**
 * R120-B6 (A6 F3/F4 + the R118-A6-F4 leftover) — V1-M24 list read-path
 * indexes.
 *
 *   F3  idx_notifications_user swapped same-name (user_id, is_read) →
 *       (user_id, created_at DESC) so the notification bell's
 *       WHERE user_id ORDER BY created_at DESC LIMIT 40 stops paying a
 *       top-N sort on every poll. Same-name swap → V1-M17's probe-gated
 *       rebuild: ZERO notifications DDL on a steady-state boot (the
 *       regression pin — a naive DROP+CREATE would rebuild the index on
 *       every single cold start).
 *   F4  idx_tickets_status_updated (status, updated_at DESC) — additive
 *       twin for the admin ticket queue.
 *   +   idx_admin_alerts_created — the R118 schema/0016 declaration whose
 *       "boot twin: migrate.ts must CREATE INDEX IF NOT EXISTS this name"
 *       promise never shipped; the live DB never received it. The stage
 *       closes that loop.
 *
 * The pglite harness carries the POST-V1-M24 steady state for
 * notifications (user_id, created_at DESC) and the PRE-V1-M24 state for
 * the two additive objects (absent) — so the default run certifies both
 * the zero-DDL pin and the creation, and the legacy-shape test restores
 * the (user_id, is_read) twin by hand (the users-ddl pristine-state
 * pattern: raw SQL, never the stage under test).
 */

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-users-ddl). */
function recorder(): Recorded {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    },
  };
}

/** DDL-class statements touching the notifications table. */
const DDL_ON_NOTIFICATIONS =
  /DROP\s+INDEX.*idx_notifications_user|CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+idx_notifications_user/i;

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

beforeAll(initTestDb, 60_000);
beforeEach(resetTestDb);

describe("V1-M24 — applyListReadPathIndexesStage (A6-F3/F4)", () => {
  it("steady state: creates the two additive twins, sends ZERO DDL on notifications", async () => {
    // Harness boots with the steady-state bell shape + neither additive
    // index — exactly the first post-R120 live boot.
    expect(await indexDef("idx_notifications_user")).toContain("created_at");
    expect(await indexDef("idx_tickets_status_updated")).toBeUndefined();
    expect(await indexDef("idx_admin_alerts_created")).toBeUndefined();

    const rec = recorder();
    await applyListReadPathIndexesStage(rec.execute);

    // THE F3 regression pin: the probe answered "new shape" → no
    // DROP/CREATE on idx_notifications_user at all.
    expect(rec.statements.filter((s) => DDL_ON_NOTIFICATIONS.test(s))).toHaveLength(0);

    expect(await indexDef("idx_tickets_status_updated")).toContain("updated_at DESC");
    expect(await indexDef("idx_admin_alerts_created")).toContain("created_at DESC");
  });

  it("legacy (user_id, is_read) shape: probe-gated swap → (user_id, created_at DESC), once", async () => {
    // Restore the pre-V1-M24 live shape by hand (pristine-state pattern).
    await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_notifications_user`));
    await db.execute(
      sql.raw(`CREATE INDEX idx_notifications_user ON notifications (user_id, is_read)`),
    );
    expect(await indexDef("idx_notifications_user")).toContain("is_read");

    await applyListReadPathIndexesStage();

    const def = await indexDef("idx_notifications_user");
    expect(def).toContain("user_id");
    expect(def).toContain("created_at DESC");
    expect(def).not.toContain("is_read");
  });

  it("re-running the stage is a clean no-op (the forever-boot contract)", async () => {
    await applyListReadPathIndexesStage();
    const defAfterFirst = await indexDef("idx_notifications_user");

    // Simulate the legacy shape again mid-history: the second run must
    // converge it back exactly like the first (idempotent swap).
    await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_notifications_user`));
    await db.execute(
      sql.raw(`CREATE INDEX idx_notifications_user ON notifications (user_id, is_read)`),
    );
    await applyListReadPathIndexesStage();
    await applyListReadPathIndexesStage();

    expect(await indexDef("idx_notifications_user")).toBe(defAfterFirst);
    expect(await indexDef("idx_tickets_status_updated")).toContain("updated_at DESC");
    expect(await indexDef("idx_admin_alerts_created")).toContain("created_at DESC");
  });
});

describe("R120-B6 — the drizzle 0017 mirror (chain follows the schema)", () => {
  interface JournalEntry {
    idx: number;
    tag: string;
  }

  /** Strip `--` comment lines, split on drizzle's breakpoint marker, drop blanks. */
  function parseStatements(fileSql: string): string[] {
    return fileSql
      .replace(/^\s*--.*$/gm, "")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /** Column names an index is declared on (drizzle IndexedColumn.name). */
  function indexColumns(index: { config: { columns: unknown[] } }): string[] {
    return index.config.columns.map((c) => String((c as { name?: string }).name));
  }

  it("the journal carries 0016 → 0017 in order", async () => {
    const raw = JSON.parse(
      await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"),
    );
    const entries = raw.entries as JournalEntry[];
    const idx16 = entries.findIndex((e) => e.idx === 16);
    const idx17 = entries.findIndex((e) => e.idx === 17);
    expect(idx16).toBeGreaterThanOrEqual(0);
    expect(idx17).toBe(idx16 + 1);
    expect(entries[idx17].tag).toMatch(/^0017_/);
  });

  it("0017 declares exactly the A6-F3/F4 objects, hardened (r110 idiom)", async () => {
    const tag = "0017_silent_greymalkin";
    const statements = parseStatements(
      await readFile(repoPath(`shared/db/drizzle/${tag}.sql`), "utf8"),
    );
    expect(statements).toHaveLength(3);
    // Every CREATE INDEX carries IF NOT EXISTS; the DROP carries IF EXISTS.
    for (const stmt of statements) {
      if (stmt.includes("CREATE INDEX")) expect(stmt).toContain("IF NOT EXISTS");
      if (stmt.includes("DROP INDEX")) expect(stmt).toContain("IF EXISTS");
    }
    const all = statements.join("\n");
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_tickets_status_updated" ON "support_tickets" USING btree ("status","updated_at" DESC NULLS LAST);',
    );
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);',
    );
  });

  it("the TS schema declares both indexes (compile-level mirror)", () => {
    const notifIdx = getTableConfig(notificationsTable as unknown as PgTable).indexes.find(
      (i) => i.config.name === "idx_notifications_user",
    );
    expect(notifIdx).toBeDefined();
    expect(notifIdx!.config.unique).toBe(false);
    expect(indexColumns(notifIdx!)).toEqual(["user_id", "created_at"]);

    const ticketsIdx = getTableConfig(supportTicketsTable as unknown as PgTable).indexes.find(
      (i) => i.config.name === "idx_tickets_status_updated",
    );
    expect(ticketsIdx).toBeDefined();
    expect(ticketsIdx!.config.unique).toBe(false);
    expect(indexColumns(ticketsIdx!)).toEqual(["status", "updated_at"]);
  });

  it("0017 executes cleanly + idempotently on the runtime shape (live-boot dry-run)", async () => {
    const statements = parseStatements(
      await readFile(repoPath("shared/db/drizzle/0017_silent_greymalkin.sql"), "utf8"),
    );
    const applyChain = async () => {
      for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
      }
    };
    await applyChain(); // live-boot simulation
    await applyChain(); // second application: clean no-op

    // Both objects exist in the boot shape after the chain.
    expect(await indexDef("idx_notifications_user")).toContain("created_at DESC");
    expect(await indexDef("idx_tickets_status_updated")).toContain("updated_at DESC");
  });
});
