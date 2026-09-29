CREATE TYPE "public"."points_ledger_type" AS ENUM('purchase_award', 'refund_reversal', 'referral_credit', 'conversion_out', 'admin_set', 'correction');--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "points_ledger_type" NOT NULL,
	"points_delta" integer NOT NULL,
	"points_before" integer NOT NULL,
	"points_after" integer NOT NULL,
	"lyd_credited" numeric(10, 2),
	"reference_id" integer,
	"reference_type" varchar(50),
	"actor_admin_id" integer,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_by_admin_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_bonus_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_points_ledger_user" ON "points_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_points_ledger_type" ON "points_ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_points_ledger_user_created" ON "points_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "uniq_points_ledger_type_reference" ON "points_ledger" USING btree ("type","reference_id") WHERE reference_id IS NOT NULL;