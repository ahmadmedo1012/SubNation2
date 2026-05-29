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

CREATE TABLE inventory (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  account_email varchar(255),
  account_password varchar(512),
  extra_details text,
  is_sold boolean NOT NULL DEFAULT false,
  sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  order_code varchar(50) NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id),
  inventory_id integer REFERENCES inventory(id),
  amount numeric(10,2) NOT NULL,
  wallet_balance_before numeric(10,2) NOT NULL DEFAULT '0.00',
  wallet_balance_after numeric(10,2) NOT NULL DEFAULT '0.00',
  status order_status NOT NULL DEFAULT 'pending',
  delivered_email varchar(255),
  delivered_password varchar(255),
  delivered_extra_details text,
  delivered_usage_terms text,
  delivered_at timestamptz,
  coupon_code varchar(50),
  discount_amount numeric(10,2) DEFAULT '0.00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_ledger (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type ledger_entry_type NOT NULL,
  amount numeric(10,2) NOT NULL,
  balance_before numeric(10,2) NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  reference_id integer,
  reference_type varchar(50),
  description varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_topups (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
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

CREATE TABLE coupons (
  id serial PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  type coupon_type NOT NULL DEFAULT 'percentage',
  value numeric(10,2) NOT NULL,
  min_order_amount numeric(10,2) NOT NULL DEFAULT '0.00',
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
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
`;

const TABLES = [
  "wallet_ledger",
  "orders",
  "inventory",
  "wallet_topups",
  "referral_events",
  "coupons",
  "products",
  "users",
];

/** Build the fresh schema once. Call in a global beforeAll. */
export async function initTestDb(): Promise<void> {
  await client.exec(DDL);
}

/** Wipe all rows + reset identity sequences between tests for pure isolation. */
export async function resetTestDb(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE;`));
}
