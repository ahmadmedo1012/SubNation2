import crypto from "node:crypto";
import { db, sessionsTable } from "@workspace/db";
import { signUserToken } from "./jwt";
import { logger } from "./logger";

/** 30 days — matches the JWT expiry in signUserToken + the auth_token cookie maxAge. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CreateSessionInput {
  userId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Unified session initialization for ALL auth channels (Google/Firebase,
 * Telegram widget + Mini App, WhatsApp OTP).
 *
 * Single source of truth so every provider produces an identical session:
 *   1. a uniform UUID `sessionId`,
 *   2. a `sessions` row (device + IP + 30-day expiry) — the server-side
 *      record that powers "log out all devices" + session listing,
 *   3. a JWT carrying BOTH `{ userId, sessionId }` so the token can be
 *      tied back to its row.
 *
 * Before this, only the Firebase path created a `sessions` row; Telegram
 * and WhatsApp signed `{ userId }` only, so their sessions were invisible
 * to the store. This unifies them.
 *
 * The DB insert is best-effort: an audit/telemetry row must never block a
 * successful login. On insert failure we still return a valid token (the
 * sessionId is embedded either way), and log for triage.
 */
export async function createUserSession(input: CreateSessionInput): Promise<{
  token: string;
  sessionId: string;
}> {
  const sessionId = crypto.randomUUID();

  try {
    await db.insert(sessionsTable).values({
      id: sessionId,
      userId: input.userId,
      userAgent: input.userAgent?.substring(0, 255),
      ipAddress: input.ipAddress?.substring(0, 45),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
  } catch (err) {
    logger.warn(
      { category: "auth.session", err: err instanceof Error ? err.message : String(err), userId: input.userId },
      "[session] row insert failed (non-fatal — token still issued)",
    );
  }

  const token = signUserToken({ userId: input.userId, sessionId });
  return { token, sessionId };
}
