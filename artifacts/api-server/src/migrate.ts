import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";

export async function runMigrations() {
  try {
    // Coupons table
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_type') THEN
          CREATE TYPE coupon_type AS ENUM ('percentage', 'fixed');
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id            SERIAL PRIMARY KEY,
        code          VARCHAR(50) NOT NULL UNIQUE,
        type          coupon_type NOT NULL DEFAULT 'percentage',
        value         NUMERIC(10,2) NOT NULL,
        min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        max_uses      INTEGER,
        used_count    INTEGER NOT NULL DEFAULT 0,
        expires_at    TIMESTAMPTZ,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        description   VARCHAR(255),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Add coupon columns to orders if they don't exist
    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS coupon_code    VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;
    `);

    // Admin alerts inbox
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id         SERIAL PRIMARY KEY,
        type       VARCHAR(30) NOT NULL DEFAULT 'system',
        title      VARCHAR(255) NOT NULL,
        message    TEXT,
        is_read    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    logger.info("Migrations completed");
  } catch (err) {
    logger.error({ err }, "Migration failed");
    throw err;
  }
}
