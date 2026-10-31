// R191 (backend mobile contracts): stage family for the Expo push-token
// infrastructure — V1-M37. Creates the `push_tokens` table (one row per
// DEVICE registration; expo_push_token is the natural key, re-registration
// upserts ownership, logout soft-revokes via revoked_at).
//
// Idiom: the V1-M13/M14 probe-gated CREATE (zero-DDL steady state — a
// database already converged by a prior boot sends no DDL at all), with
// the object names EXACTLY matching the drizzle mirror (chain 0028 +
// shared/db/src/schema/push-tokens.ts) so runtime-built and chain-built
// databases converge: constraint names push_tokens_expo_push_token_unique,
// chk_push_tokens_platform, push_tokens_user_id_users_id_fk and the
// idx_push_tokens_user_id index.
//
// The user FK follows the sessions-table style (ON DELETE CASCADE — a user
// delete takes their device registrations), NOT the money tables' RESTRICT
// family; push_tokens carries no financial history.
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { type SqlExecutor, defaultExecutor } from "../shared";

export async function applyPushTokensStage(execute: SqlExecutor = defaultExecutor): Promise<void> {
  // 1. The table — existence-probed (V1-M13 idiom): a converged database
  //    sends no DDL. The UNIQUE + CHECK constraints ride the CREATE so the
  //    runtime shape and the drizzle chain's CREATE converge exactly.
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'push_tokens'
      ) THEN
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
      END IF;
    END $$;
  `);

  // 2. The user FK — named to match the drizzle mirror
  //    (push_tokens_user_id_users_id_fk), duplicate_object-swallowed so a
  //    partially-converged database (table present, FK absent) converges
  //    without a 42710 (the V1-M16 fkStatements idiom).
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE push_tokens
        ADD CONSTRAINT push_tokens_user_id_users_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
  `);

  // 3. The user_id index (V1-M21/B8-10 IF NOT EXISTS idiom — steady-state
  //    boots send nothing; sendPushToUser reads by user_id).
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens (user_id);
  `);

  logger.info(
    { category: "storage" },
    "V1-M37: push_tokens converged (Expo push-token registrations, R191)",
  );
}
