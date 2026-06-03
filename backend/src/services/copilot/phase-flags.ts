/**
 * Phase-flag service (010-ai-admin-copilot, T140-T142).
 *
 * Reads four boolean flags from `system_settings` (existing key/value
 * table) under the key `copilot.phases`:
 *   - phase1_enabled        — read/explain (US1)
 *   - phase2_enabled        — draft + preview (US2)
 *   - phase3_enabled        — execute low-risk (US3)
 *   - phase3_high_risk_enabled — execute high-risk (US4+)
 *
 * Cached in-process for 30 seconds. Cache invalidates immediately when
 * `setPhaseFlags()` is called. Without a row, all flags default to false
 * (production-safe default).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";

export interface CopilotPhaseFlags {
  phase1_enabled: boolean;
  phase2_enabled: boolean;
  phase3_enabled: boolean;
  phase3_high_risk_enabled: boolean;
}

const KEY = "copilot.phases";
const CACHE_TTL_MS = 30_000;
const DEFAULT_FLAGS: CopilotPhaseFlags = {
  phase1_enabled: false,
  phase2_enabled: false,
  phase3_enabled: false,
  phase3_high_risk_enabled: false,
};

let cache: { flags: CopilotPhaseFlags; loadedAt: number } | null = null;

function parseFlags(json: unknown): CopilotPhaseFlags {
  try {
    const obj =
      typeof json === "string"
        ? (JSON.parse(json) as Record<string, unknown>)
        : (json as Record<string, unknown>);
    return {
      phase1_enabled: obj.phase1_enabled === true,
      phase2_enabled: obj.phase2_enabled === true,
      phase3_enabled: obj.phase3_enabled === true,
      phase3_high_risk_enabled: obj.phase3_high_risk_enabled === true,
    };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export async function getPhaseFlags(): Promise<CopilotPhaseFlags> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.flags;
  }
  try {
    const result = await db.execute(
      sql`SELECT value FROM system_settings WHERE key = ${KEY} LIMIT 1`,
    );
    // drizzle-orm/node-postgres surfaces the underlying pg QueryResult
    // shape, but in this project's existing migrate.ts we observe rows
    // landing as either `result.rows[0]` OR `result[0]` depending on the
    // driver/version in flight. Match the existing defensive pattern so
    // a future driver swap doesn't silently revert phase flags to the
    // all-off default.
    const r = result as unknown as
      | { rows?: Array<{ value: unknown }> }
      | Array<{ value: unknown }>;
    const rows = Array.isArray(r) ? r : (r.rows ?? []);
    const flags = rows.length > 0 ? parseFlags(rows[0]!.value) : { ...DEFAULT_FLAGS };
    cache = { flags, loadedAt: Date.now() };
    return flags;
  } catch (err) {
    logger.warn({ err }, "copilot phase-flags read failed; defaulting to all-off");
    return { ...DEFAULT_FLAGS };
  }
}

export async function setPhaseFlags(next: CopilotPhaseFlags): Promise<void> {
  if (next.phase3_high_risk_enabled && !next.phase3_enabled) {
    throw new Error("phase3_high_risk_enabled requires phase3_enabled");
  }
  const json = JSON.stringify(next);
  await db.execute(sql`
    INSERT INTO system_settings (key, value)
    VALUES (${KEY}, ${json})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  cache = { flags: { ...next }, loadedAt: Date.now() };
}

export function clearPhaseFlagsCache(): void {
  cache = null;
}
