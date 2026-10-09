/**
 * Auth-settings store — the system_settings persistence + masking layer
 * for auth-provider configuration (R126-L9 split, A3 plan E).
 *
 * Extracted verbatim from routes/auth-settings.ts (the file's DB-helpers
 * section). Zero behavior change by construction — the only edit beyond
 * the move is the one A3's split plan prescribes: the raw `db.execute`
 * rows are typed ONCE here (system_settings rows are { key, value } —
 * value is TEXT NOT NULL per the shared schema), killing the four
 * `as any` casts the route file carried at each call site.
 *
 * Also owns the ProviderField/ProviderMeta shapes these helpers consume
 * (buildMaskedConfig walks meta.fields); routes/auth-settings.ts
 * re-exports both so its public type surface is unchanged.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Provider metadata shapes ──────────────────────────────────────────────────

export interface ProviderField {
  key: string;
  label: string;
  isSecret: boolean;
  placeholder?: string;
}

export interface ProviderMeta {
  id: string;
  label: string;
  color: string;
  icon: string;
  auth_type: "client_side" | "oauth_redirect" | "widget";
  description: string;
  setup_url: string;
  fields: ProviderField[];
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

/**
 * R126-L9 (A3 split plan E): db.execute's raw result shape is
 * driver-dependent (an array for some drivers, a pg-style
 * `{ rows: [...] }` for others) — normalize it to typed
 * system_settings rows ONCE here instead of the per-call-site
 * `as any` casts the route file carried. `value` is TEXT NOT NULL
 * (shared/db system_settings schema), so the honest row type is
 * `{ key: string; value: string }`.
 */
function settingRows(result: unknown): Array<{ key: string; value: string }> {
  const rows = Array.isArray(result)
    ? (result as Array<{ key: string; value: string }>)
    : ((result as { rows?: Array<{ key: string; value: string }> }).rows ?? []);
  return rows;
}

export async function getSetting(key: string): Promise<Record<string, any>> {
  const result = await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${key} LIMIT 1`,
  );
  const row = settingRows(result)[0];
  if (!row?.value) return {};
  try {
    return JSON.parse(String(row.value));
  } catch {
    return {};
  }
}

/**
 * R119-B2 (A3 F-2): returns a PLAIN Record, not a Map. The value this
 * produces flows through cacheWrap → cacheSet, and cacheSet persists
 * whatever the loader returned via `JSON.stringify(value)` — and
 * `JSON.stringify(new Map()) === "{}"`. The in-memory fallback stores the
 * object reference UNserialized, which is exactly why this stayed dormant
 * while production ran Redis-less: the Map round-tripped by reference. The
 * moment REDIS_URL provisions a client (the cache layer auto-activates on
 * redis ready), every cache HIT inside the 60 s TTL would parse "{}" back
 * and the provider handler's `.get(...)` below would throw a TypeError →
 * 500 on the login page's provider list for the rest of each window. A
 * plain object survives the JSON round-trip identically on both branches;
 * consumers use index access with a `?? {}` default, which preserves the
 * exact miss semantics `Map.get()` gave them.
 */
export async function getAllAuthSettings(): Promise<Record<string, Record<string, any>>> {
  const result = await db.execute(
    sql`SELECT key, value FROM system_settings WHERE key LIKE 'auth.%'`,
  );
  const settings: Record<string, Record<string, any>> = {};
  for (const row of settingRows(result)) {
    try {
      settings[row.key] = JSON.parse(String(row.value ?? "{}"));
    } catch {
      settings[row.key] = {};
    }
  }
  return settings;
}

export async function upsertSetting(key: string, value: Record<string, any>) {
  const json = JSON.stringify(value);
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, ${json}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
  `);
}

// R127-B2 (§B.3): the R126-L9 split left `export` on this module-private
// helper — keyword dropped; zero behavior change.
function maskSecret(v: string | undefined): string {
  return v ? "[SET]" : "";
}

export function buildMaskedConfig(
  meta: ProviderMeta,
  config: Record<string, any>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const field of meta.fields) {
    masked[field.key] = field.isSecret ? maskSecret(config[field.key]) : (config[field.key] ?? "");
  }
  return masked;
}
