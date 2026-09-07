import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it in your host's environment (e.g. Render Dashboard → Environment → " +
      "DATABASE_URL with your Neon connection string). If you use a Blueprint with sync: false for this key, " +
      "the value is never read from render.yaml—you must set it on the service manually.",
  );
}

const parsedDatabaseUrl = new URL(databaseUrl);
const sslMode = parsedDatabaseUrl.searchParams.get("sslmode");
const requiresSsl =
  sslMode === "require" ||
  sslMode === "verify-ca" ||
  sslMode === "verify-full" ||
  parsedDatabaseUrl.hostname.endsWith(".neon.tech");
// Default pool sizes:
//   - production: 15  (matches render.yaml; sized for one starter dyno
//                       under moderate concurrency. With Neon pooler the
//                       upstream limit is much higher, so this is the
//                       per-instance bound.)
//   - dev:        10
// The env var DB_POOL_MAX always wins. The default exists only as a
// safety net so a missing/typo'd env doesn't silently cap us at 5
// connections (which causes connection-starvation under ~50 concurrent
// users — that was the symptom the May 2026 load test surfaced).
const poolMax = Number(
  process.env.DB_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 15 : 10),
);
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000);
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10_000);

// ── R4 (round-93 A3): server-side statement timeout ─────────────────────────
//
// Previously NOTHING bounded an individual query: pg's
// connectionTimeoutMillis only covers POOL ACQUISITION, and a Neon
// AZ/pooler stall with silent packet drops left each of the 15 clients
// stuck mid-query forever — pool exhausted, every DB-touching request
// hung, liveness still 200 ("green while dead"). pg transmits
// `statement_timeout` as a per-connection startup parameter
// (lib/client.js: getStartupData), so every pooled connection now gets a
// server-side deadline: the query errors out and the client returns to
// the pool instead of pinning it.
//
// Sizing: 15 s is far above every runtime query p95 and above the
// migration statements (ctid-batched DELETEs ≤ 1000 rows, count probes,
// guarded DDL). If a future migration legitimately needs longer, set
// PG_STATEMENT_TIMEOUT_MS higher (or "0" to disable) on the service for
// the deploy — env is read per boot, so a redeploy picks it up.
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Parse PG_STATEMENT_TIMEOUT_MS. Returns the timeout in ms; 0 = disabled
 * (operator escape hatch for unusually long migrations/queries). Invalid
 * or missing values fall back to the 15 s default. Exported for unit
 * tests (R4).
 */
export function resolveStatementTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_STATEMENT_TIMEOUT_MS;
  return parsed;
}

const statementTimeoutMs = resolveStatementTimeoutMs(process.env.PG_STATEMENT_TIMEOUT_MS);

const poolConfig: pg.PoolConfig & { enableChannelBinding?: boolean } = {
  connectionString: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 15,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30_000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
    ? connectionTimeoutMillis
    : 10_000,
  // R4 (round-93 A3): server-side statement deadline per pooled
  // connection (see comment above). 0 → omit → no timeout (disabled).
  statement_timeout: statementTimeoutMs > 0 ? statementTimeoutMs : undefined,
  // R4 (round-93 A3): TCP keepalives so a silently-dropped connection
  // (AZ stall / NAT idle timeout) is detected by the OS instead of
  // black-holing the socket until the statement timeout fires. pg maps
  // keepAlive:true + keepAliveInitialDelayMillis to libpq's
  // keepalives=1 / keepalives_idle=30.
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
  ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
};

if (parsedDatabaseUrl.searchParams.get("channel_binding") === "require") {
  poolConfig.enableChannelBinding = true;
}

export const pool = new Pool(poolConfig);

// Exported for unit tests (R4) — the exact config handed to pg.Pool.
export { poolConfig as dbPoolConfig };

pool.on("error", (err) => {
  console.error("[db] PostgreSQL pool error", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
