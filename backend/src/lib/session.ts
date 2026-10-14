import crypto from "node:crypto";
import { db, sessionsTable } from "@workspace/db";
import { signUserToken } from "./jwt";

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
 * R143 (L8-1): the DB insert failure is NO LONGER swallowed. Since H1
 * (2026-09-06)/93-A1 the row IS the session — requireUser and the
 * /api/auth/probe reject any sid-bearing token whose row is missing —
 * so the old best-effort posture minted a BORN-DEAD session: 200 +
 * Set-Cookie for a session that 401s on the very next request (login
 * loop) while the log called it non-fatal. This now matches
 * createAdminSession semantics exactly: the insert error propagates and
 * the mint route answers an honest 500. Fail closed, fail loudly.
 */
export async function createUserSession(input: CreateSessionInput): Promise<{
  token: string;
  sessionId: string;
}> {
  const sessionId = crypto.randomUUID();

  await db.insert(sessionsTable).values({
    id: sessionId,
    userId: input.userId,
    userAgent: input.userAgent?.substring(0, 255),
    ipAddress: input.ipAddress?.substring(0, 45),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  const token = signUserToken({ userId: input.userId, sessionId });
  return { token, sessionId };
}
