import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * R104 (AG4-2) — Neon-persisted pairing-epoch marker for the WhatsApp
 * OTP settle/warm gate.
 *
 * WHY: the settle gate's ready-since/warmed bookkeeping is in-process
 * (+ an optional Redis mirror). Production runs WITHOUT Redis, and the
 * Render free tier SLEEPS the backend after 15 idle minutes — every
 * wake started the 45 s post-link settle window and re-scheduled the
 * warm-up self-message from scratch, even though the session's pairing
 * epoch (stable pairingId) had ALREADY been proven settled+warm before
 * the sleep. First-OTP-after-wake paid ~75-80 s of ceremony for a
 * session that needed none of it.
 *
 * This tiny store mirrors the CURRENT epoch's gate state into
 * system_settings so a cold process ADOPTS the proven state when the
 * gateway reports the SAME pairingId (a routine restore), and starts
 * fresh when the epoch actually changed (a true re-pair — the marker
 * key is per-session and simply overwritten).
 *
 * Failure semantics: reads resolve null on ANY error (fall back to the
 * fresh-window behavior — always safe); writes are fire-and-forget and
 * never throw. Kill switch: WHATSAPP_OTP_DISABLE_EPOCH_MEMORY=true
 * reverts to pure per-process bookkeeping.
 */

export interface EpochMarker {
  /** The pairing-epoch token this marker was recorded under. */
  epoch: string;
  /** readySince timestamp (ms) recorded for that epoch. */
  readySince: number;
  /** Whether the warm-up self-check DELIVERED for this epoch. */
  warmed: boolean;
}

function markerKey(sessionId: string): string {
  return `openwa:epoch:${sessionId}`;
}

export function epochMemoryEnabled(): boolean {
  return (process.env.WHATSAPP_OTP_DISABLE_EPOCH_MEMORY ?? "").toLowerCase() !== "true";
}

export async function readEpochMarker(sessionId: string): Promise<EpochMarker | null> {
  if (!epochMemoryEnabled()) return null;
  try {
    const [row] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, markerKey(sessionId)))
      .limit(1);
    if (!row) return null;
    const parsed = JSON.parse(row.value) as Partial<EpochMarker> | null;
    if (
      parsed &&
      typeof parsed.epoch === "string" &&
      parsed.epoch.length > 0 &&
      Number.isFinite(parsed.readySince) &&
      (parsed.readySince as number) > 0 &&
      typeof parsed.warmed === "boolean"
    ) {
      return { epoch: parsed.epoch, readySince: parsed.readySince as number, warmed: parsed.warmed };
    }
    return null;
  } catch {
    // Missing table / transient DB window / malformed value — degrade to
    // the fresh-window behavior (never fail the OTP path on this).
    return null;
  }
}

export function writeEpochMarker(sessionId: string, marker: EpochMarker): void {
  if (!epochMemoryEnabled()) return;
  void db
    .execute(
      sql`INSERT INTO system_settings (key, value, updated_at)
          VALUES (${markerKey(sessionId)}, ${JSON.stringify(marker)}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    )
    .catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), category: "whatsapp.gateway" },
        "[whatsapp-otp] epoch marker write skipped (non-fatal)",
      );
    });
}
