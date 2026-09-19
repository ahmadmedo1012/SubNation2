CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"plan_label" varchar(120),
	"duration_label" varchar(120),
	"duration_days" integer,
	"cost_price" numeric(10, 2) NOT NULL,
	"price_lyd" numeric(10, 2) NOT NULL,
	"sku" varchar(160),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "variant_label" varchar(240);--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "variant_label" varchar(240);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seo_title" varchar(200);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seo_description" varchar(320);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_variants_product" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_product_variants_product_active" ON "product_variants" USING btree ("product_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_variants_plan_duration" ON "product_variants" USING btree ("product_id","plan_label","duration_label");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;