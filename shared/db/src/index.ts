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
const poolMax = Number(process.env.DB_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 5 : 10));
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000);
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10_000);

const poolConfig: pg.PoolConfig & { enableChannelBinding?: boolean } = {
  connectionString: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 5,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30_000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
    ? connectionTimeoutMillis
    : 10_000,
  ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
};

if (parsedDatabaseUrl.searchParams.get("channel_binding") === "require") {
  poolConfig.enableChannelBinding = true;
}

export const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[db] PostgreSQL pool error", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
