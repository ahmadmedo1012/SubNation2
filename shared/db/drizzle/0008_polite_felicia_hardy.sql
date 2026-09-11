CREATE TABLE "account_link_consents" (
	"token" text PRIMARY KEY NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"firebase_uid_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_leader_lease" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scheduler_leader_lease_id_check" CHECK (id = 1)
);
--> statement-breakpoint
DROP INDEX "idx_users_firebase_uid";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_amount" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_phone_trgm" ON "users" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_wallet_topups_payment_reference" ON "wallet_topups" USING btree ("payment_reference") WHERE payment_reference IS NOT NULL AND btrim(payment_reference) <> '' AND status = 'approved';