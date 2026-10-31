-- R191 (backend mobile contracts): Drizzle 0028 — the mirror of boot stage
-- V1-M37 (migrate/stages/05-push-tokens-r191.ts applyPushTokensStage):
-- the push_tokens table — one row per DEVICE Expo push registration
-- (expo_push_token is the natural key; re-registration upserts ownership,
-- logout soft-revokes via revoked_at; the user FK follows the sessions
-- table's ON DELETE CASCADE style, NOT the money RESTRICT family).
--
-- Same conventions as 0013/0016/0017/0018/0019/0020/0021/0022/0023/0026/
-- 0027 (r110 idiom): the file as emitted by `drizzle-kit generate` is
-- DECLARATIVE-ONLY — nothing in the repo executes it at runtime (prod
-- schema flows exclusively through migrate.ts: V1-M37 creates the table
-- probe-gated at boot), and CI only regenerates + diffs. The statements
-- below are hand-hardened so the chain is ALSO safe the day it IS applied
-- (manual `drizzle-kit migrate`, a chain-built fresh environment, or a
-- future wiring):
--
--   - CREATE TABLE carries IF NOT EXISTS — on the runtime shape the boot
--     twin has already created the table, so the CREATE no-ops;
--   - the FK ADD CONSTRAINT is wrapped in the migrate.ts
--     duplicate_object-swallowing DO block (V1-M9/V1-M16 idiom) — the
--     runtime twin creates it under this exact name inline;
--   - CREATE INDEX carries IF NOT EXISTS (V1-M21/B8-10 idiom).
CREATE TABLE IF NOT EXISTS "push_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" integer NOT NULL,
        "expo_push_token" varchar(255) NOT NULL,
        "platform" varchar(16) NOT NULL,
        "device_label" varchar(255),
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone,
        CONSTRAINT "push_tokens_expo_push_token_unique" UNIQUE("expo_push_token"),
        CONSTRAINT "chk_push_tokens_platform" CHECK ("push_tokens"."platform" IN ('android','ios'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user_id" ON "push_tokens" USING btree ("user_id");
