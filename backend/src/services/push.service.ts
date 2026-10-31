import { and, eq, isNull } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * R191 (backend mobile contracts) — Expo push delivery, best-effort by design.
 *
 * `sendPushToUser` reads the user's ACTIVE push_tokens rows and POSTs them
 * to the Expo push service (https://exp.host/--/api/v2/push/sendMessage) in
 * batches of ≤100 (the documented per-request cap). Every failure — no
 * tokens, a network timeout, a non-2xx, a malformed response — is logged
 * (pino, category "push") and SWALLOWED: push is a UX convenience layered
 * on top of the durable in-app notification row, never a transactional
 * invariant. NO retries (a missed push is not worth a retry loop).
 *
 * Token hygiene: Expo reports per-device errors in the response body's
 * `data[].details.error` — DeviceNotRegistered and InvalidProvider mean the
 * token is permanently dead, so the row is soft-revoked (revoked_at = now)
 * instead of being retried forever.
 *
 * M16 discipline: callers fire this AFTER commit (the same rule the
 * in-app notification inserts follow); the service itself only READS
 * token rows and writes revocations — never money state.
 *
 * Payload safety: title/body are generic Arabic notification text (the
 * SAME strings the in-app notification row carries). NEVER credentials,
 * delivered passwords, or secrets — the caller owns that invariant by
 * construction (both strings come from createNotification's title/message).
 */

/** Official Expo push endpoint (docs: expo.dev/push/servers). */
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/sendMessage";

/** The documented per-request batch cap. */
const EXPO_BATCH_LIMIT = 100;

/** Network budget for one Expo call — best-effort, never a request hang. */
const EXPO_TIMEOUT_MS = 10_000;

/** Expo per-device error statuses that mean the token is permanently dead. */
const PURGE_ERRORS = new Set(["DeviceNotRegistered", "InvalidProvider"]);

export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link/data map (e.g. { link: "/orders" }) — never secrets. */
  data?: Record<string, string>;
}

interface ExpoPushResponse {
  data?: Array<{
    status?: string;
    details?: { error?: string };
  }>;
}

async function revokeToken(tokenId: string): Promise<void> {
  try {
    await db
      .update(pushTokensTable)
      .set({ revokedAt: new Date() })
      .where(eq(pushTokensTable.id, tokenId));
  } catch (err) {
    logger.warn(
      { category: "push", err: err instanceof Error ? err.message : String(err), tokenId },
      "[push] failed to soft-revoke a dead Expo token (non-fatal)",
    );
  }
}

/**
 * Send one push to every ACTIVE device registered by the user. Never
 * throws; returns the number of Expo calls made (0 = no active tokens or
 * transport failure) purely for logging/tests.
 */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<number> {
  let tokens: Array<{ id: string; expoPushToken: string }>;
  try {
    tokens = await db
      .select({ id: pushTokensTable.id, expoPushToken: pushTokensTable.expoPushToken })
      .from(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, userId), isNull(pushTokensTable.revokedAt)))
      .limit(EXPO_BATCH_LIMIT);
  } catch (err) {
    logger.warn(
      { category: "push", err: err instanceof Error ? err.message : String(err), userId },
      "[push] token read failed (non-fatal)",
    );
    return 0;
  }
  if (tokens.length === 0) return 0;

  let calls = 0;
  try {
    for (let i = 0; i < tokens.length; i += EXPO_BATCH_LIMIT) {
      const batch = tokens.slice(i, i + EXPO_BATCH_LIMIT);
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // One message per token — Expo's batched shape: an array of
          // single-recipient messages.
          messages: batch.map((t) => ({
            to: t.expoPushToken,
            title: payload.title,
            body: payload.body,
            ...(payload.data ? { data: payload.data } : {}),
          })),
        }),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      calls += 1;
      if (!res.ok) {
        // Best-effort: log + give up on this batch (no retries).
        logger.warn(
          { category: "push", userId, status: res.status, count: batch.length },
          "[push] Expo push send rejected (non-fatal)",
        );
        continue;
      }
      // Per-device errors ride a 200 body: purge the dead tokens.
      let body: ExpoPushResponse;
      try {
        body = (await res.json()) as ExpoPushResponse;
      } catch {
        logger.warn(
          { category: "push", userId },
          "[push] Expo push response unparseable (non-fatal)",
        );
        continue;
      }
      const results = Array.isArray(body.data) ? body.data : [];
      for (let j = 0; j < results.length && j < batch.length; j += 1) {
        const error = results[j]?.details?.error;
        if (error && PURGE_ERRORS.has(error)) {
          await revokeToken(batch[j]!.id);
        }
      }
    }
  } catch (err) {
    // Timeout / network / DNS — the whole best-effort envelope.
    logger.warn(
      { category: "push", err: err instanceof Error ? err.message : String(err), userId },
      "[push] Expo push send failed (non-fatal)",
    );
  }
  return calls;
}
