/**
 * Test-only database harness — in-process pglite, NEVER the Neon pool.
 *
 * The production `@workspace/db` opens a `pg.Pool` to the live Neon URL at
 * import time. During tests, `vitest.config.ts` aliases `@workspace/db` to
 * THIS module, so the Neon driver is never even imported — guaranteeing no
 * test query can reach production.
 *
 * It exports `db` (drizzle bound to pglite) + re-exports every schema object,
 * so production code importing `{ db, usersTable, ... }` is satisfied
 * unchanged. The drizzle query API over pglite is identical to node-postgres,
 * including `db.transaction()` rollback semantics — which is exactly what the
 * checkout/top-up atomicity tests rely on.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import type { db as ProdDb } from "@workspace/db";

const client = new PGlite(); // ephemeral, in-memory
// The pglite + node-postgres drizzle query APIs are runtime-compatible for
// everything the app uses (select/insert/update/delete/transaction). They
// differ only in the QueryResultHKT generic, so we present `db` with the
// production node-pg type — letting test code pass `tx`/`db` to the same
// helpers (insertLedgerEntry, services) without per-call casts.
export const db = drizzle(client, { schema }) as unknown as typeof ProdDb;

// Re-export every table/enum/type so `@workspace/db` consumers resolve here.
export * from "@workspace/db/schema";

/**
 * Minimal DDL for the tables the checkout + top-up flows touch. Mirrors the
 * current Drizzle schema (not the stale drizzle/*.sql migrations, which
 * predate later ALTERs like products.slug / users.google_id). Kept to the
 * 8 tables under test so the harness stays readable and fast.
 *
 * A10 (round-93 audit §2 P0): the harness ALSO carries the V1-M9 + V1-M10
 * money constraints/indexes exactly as production's applyMoneyConstraintStage
 * + applyLedgerAmountNonzeroStage create them (same names, same definitions).
 * The old hand-written subset silently certified prod-forbidden behavior —
 * signed debit adjustments passed here while chk_ledger_amount_pos 500'd in
 * production, and the partial unique payment_reference index was invisible
 * to every service test. Tests must certify the REAL schema.
 */
const DDL = `
CREATE TYPE order_status AS ENUM ('pending','completed','failed','refunded');
CREATE TYPE ledger_entry_type AS ENUM ('topup','purchase','refund','adjustment','referral_credit');
CREATE TYPE topup_status AS ENUM ('pending','approved','rejected');
CREATE TYPE coupon_type AS ENUM ('percentage','fixed');

CREATE TABLE users (
  id serial PRIMARY KEY,
  organization_id integer,
  phone varchar(20) NOT NULL UNIQUE,
  google_id varchar(255) UNIQUE,
  telegram_id varchar(255) UNIQUE,
  firebase_uid varchar(255) UNIQUE,
  email varchar(255),
  email_verified boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  display_name varchar(255),
  photo_url text,
  auth_provider varchar(50) NOT NULL DEFAULT 'firebase_phone',
  last_auth_at timestamptz,
  wallet_balance numeric(10,2) NOT NULL DEFAULT '0.00',
  -- V1-M9 (B8-03): money invariants, mirrored from applyMoneyConstraintStage
  CONSTRAINT chk_users_wallet_balance_nonneg CHECK (wallet_balance >= 0),
  loyalty_points integer NOT NULL DEFAULT 0,
  loyalty_tier varchar(50) NOT NULL DEFAULT 'bronze',
  lifetime_spend numeric(10,2) NOT NULL DEFAULT '0.00',
  referral_code varchar(20) UNIQUE,
  referred_by integer REFERENCES users(id),
  onboarded_at timestamptz,
  onboarding_step integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  slug varchar(160),
  description text,
  description_long text,
  faq jsonb,
  seo_title varchar(200),
  seo_description varchar(320),
  features jsonb,
  image_url varchar(1000),
  price numeric(10,2) NOT NULL,
  cost_price numeric(10,2),
  category varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  usage_terms text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_label varchar(120),
  duration_label varchar(120),
  duration_days integer,
  cost_price numeric(10,2) NOT NULL,
  price_lyd numeric(10,2) NOT NULL,
  sku varchar(160),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- V1-M16/V1-M17 (migrate.ts applyProductVariantsStage +
-- applyProductVariantsNullsNotDistinctStage): one (plan, duration) pair per
-- product, NULL axes included — NULLS NOT DISTINCT is what makes
-- (product, 'Family', NULL) dedup at the DB level (R98-DB-05).
CREATE UNIQUE INDEX uniq_product_variants_plan_duration
  ON product_variants (product_id, plan_label, duration_label)
  NULLS NOT DISTINCT;

CREATE TABLE inventory (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id integer REFERENCES product_variants(id) ON DELETE SET NULL,
  account_email varchar(255),
  account_password varchar(512),
  extra_details text,
  is_sold boolean NOT NULL DEFAULT false,
  sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- V1-M16 (R98-DB-01): live-only in boot SQL until round-98 — mirrored so
-- the harness matches production's post-boot shape.
CREATE INDEX idx_inventory_variant ON inventory (variant_id);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  order_code varchar(50) NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT, -- AUD103-1-F9 (r103): prod parity
  variant_id integer REFERENCES product_variants(id) ON DELETE SET NULL,
  variant_label varchar(240),
  inventory_id integer REFERENCES inventory(id) ON DELETE SET NULL, -- AUD103-1-F9 (r103): prod parity
  amount numeric(10,2) NOT NULL,
  wallet_balance_before numeric(10,2) NOT NULL DEFAULT '0.00',
  wallet_balance_after numeric(10,2) NOT NULL DEFAULT '0.00',
  status order_status NOT NULL DEFAULT 'pending',
  delivered_email varchar(255),
  delivered_password varchar(512),
  delivered_extra_details text,
  delivered_usage_terms text,
  delivered_at timestamptz,
  coupon_code varchar(50),
  discount_amount numeric(10,2) DEFAULT '0.00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- V1-M16 (R98-DB-01): live-only in boot SQL until round-98 — mirrored so
-- the harness matches production's post-boot shape.
CREATE INDEX idx_orders_variant ON orders (variant_id);

-- V1-M18 (R102, provider-readiness): fulfillment relation — one row per
-- attempt per order. Mirrored so purchase tests certify the provider
-- record writes atomically with the order. PLAIN UNIQUE (default NULLS
-- DISTINCT): non-null provider orders dedup (idempotency anchor);
-- manual rows (NULL) coexist freely — NULLS NOT DISTINCT collided on
-- the second manual purchase (caught by this very suite).
CREATE TYPE provider_fulfillment_status AS ENUM ('pending','succeeded','failed');
CREATE TABLE provider_fulfillments (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL DEFAULT 'manual',
  attempt integer NOT NULL DEFAULT 1,
  status provider_fulfillment_status NOT NULL,
  provider_order_id varchar(255),
  error_code varchar(64),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_provider_fulfillments_order ON provider_fulfillments (order_id);
CREATE UNIQUE INDEX uniq_provider_fulfillments_provider_order
  ON provider_fulfillments (provider, provider_order_id);

CREATE TABLE wallet_ledger (
  id serial PRIMARY KEY,
  -- V1-M9 (B8-02): named FK (ON DELETE CASCADE) — prod name/definition,
  -- not an auto-generated inline one, so parity tests can pin it.
  user_id integer NOT NULL,
  CONSTRAINT fk_wallet_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  type ledger_entry_type NOT NULL,
  amount numeric(10,2) NOT NULL,
  -- V1-M10 (round-93 A2/A7): sign-free nonzero — adjustments store SIGNED
  -- deltas, so the original V1-M9 form (amount > 0) broke every admin
  -- debit with a 23514 rollback + 500. amount = 0 stays forbidden.
  CONSTRAINT chk_ledger_amount_nonzero CHECK (amount <> 0),
  balance_before numeric(10,2) NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  reference_id integer,
  reference_type varchar(32), -- AUD103-8 (r103): align with schema/migrate varchar(32)
  description varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_topups (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  CONSTRAINT chk_topups_amount_pos CHECK (amount > 0),
  payment_method varchar(50) NOT NULL DEFAULT 'mobile_transfer',
  payment_network varchar(50),
  sender_phone varchar(20),
  sender_account varchar(255),
  payment_reference varchar(255),
  status topup_status NOT NULL DEFAULT 'pending',
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- V1-M9 (B8-01): one APPROVED topup per non-blank payment_reference — the
-- authoritative duplicate-transfer guard. Partial predicate copied verbatim
-- from applyMoneyConstraintStage (blank/NULL refs are the exempt legacy class).
CREATE UNIQUE INDEX uniq_wallet_topups_payment_reference
  ON wallet_topups(payment_reference)
  WHERE payment_reference IS NOT NULL AND btrim(payment_reference) <> '' AND status='approved';

CREATE TABLE coupons (
  id serial PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  type coupon_type NOT NULL DEFAULT 'percentage',
  value numeric(10,2) NOT NULL,
  min_order_amount numeric(10,2) NOT NULL DEFAULT '0.00',
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  -- V1-M9 (B8-03): used_count can never exceed max_uses.
  CONSTRAINT chk_coupons_used_le_max CHECK (max_uses IS NULL OR used_count <= max_uses),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  description varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referral_events (
  id serial PRIMARY KEY,
  referrer_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  credited_at timestamptz
);

CREATE TABLE flash_sales (
  id serial PRIMARY KEY,
  title varchar(255) NOT NULL DEFAULT 'Flash Sale',
  discount_percent numeric(5,2) NOT NULL DEFAULT '0.00',
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  product_id integer NOT NULL,
  variant_id integer REFERENCES product_variants(id) ON DELETE CASCADE,
  variant_label varchar(240),
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- migrate.ts cart_items CREATE TABLE ships this FK live (R98-DB-02
  -- mirror); named like the boot SQL so parity tests can pin it.
  CONSTRAINT fk_cart_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id varchar(255) PRIMARY KEY,
  user_id integer NOT NULL,
  user_agent varchar(255),
  ip_address varchar(45),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

CREATE TABLE admin_alerts (
  id serial PRIMARY KEY,
  type varchar(30) NOT NULL DEFAULT 'system',
  title varchar(255) NOT NULL,
  message text,
  is_read boolean NOT NULL DEFAULT false,
  dedupe_key varchar(100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_alerts_dedupe_key ON admin_alerts (dedupe_key, created_at);

CREATE TABLE admin_users (
  id serial PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  display_name varchar(100) NOT NULL DEFAULT 'Admin',
  role varchar(50) NOT NULL DEFAULT 'admin',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  totp_secret varchar(255),
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- V1-M13 (round-94 A8): revocable admin sessions — login inserts a row,
-- requireAdmin re-validates it, logout/change-password revoke.
CREATE TABLE admin_sessions (
  id varchar(64) PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason varchar(100),
  last_seen_at timestamptz,
  user_agent varchar(255),
  ip_address varchar(45)
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions (admin_id);

CREATE TYPE ticket_status AS ENUM ('open','in_progress','closed');
CREATE TABLE support_tickets (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  category varchar(50),
  status ticket_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_user ON support_tickets (user_id);
CREATE TABLE ticket_replies (
  id serial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type varchar(10) NOT NULL DEFAULT 'user',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_replies_ticket ON ticket_replies (ticket_id, created_at);

-- V1-M9 (B8-10) composites for the admin "status + newest-first" lists,
-- declared by the schema TS and created by applyMoneyConstraintStage.
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
CREATE INDEX idx_topups_status_created ON wallet_topups(status, created_at);
CREATE INDEX idx_inventory_product_sold ON inventory(product_id, is_sold);
CREATE INDEX idx_cart_items_user ON cart_items(user_id);
`;

const TABLES = [
  "admin_alerts",
  "sessions",
  "admin_users",
  "admin_sessions",
  "wallet_ledger",
  "orders",
  "inventory",
  "wallet_topups",
  "referral_events",
  "coupons",
  "flash_sales",
  "cart_items",
  "product_variants",
  "products",
  "users",
  "ticket_replies",
  "support_tickets",
];

/** Build the fresh schema once. Call in a global beforeAll. */
export async function initTestDb(): Promise<void> {
  await client.exec(DDL);
}

/**
 * Run one-or-many raw SQL statements through pglite's exec path.
 * Multi-statement strings (e.g. a table's CREATE TYPE + CREATE TABLE)
 * MUST go through here — drizzle's db.execute() uses the prepared-query
 * path (exec_parse_message) which rejects multiple statements with a
 * 42601 syntax error. Round-94 C5 follow-up.
 */
export async function execTestSql(statements: string): Promise<void> {
  await client.exec(statements);
}

/** Wipe all rows + reset identity sequences between tests for pure isolation. */
export async function resetTestDb(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE;`));
}
