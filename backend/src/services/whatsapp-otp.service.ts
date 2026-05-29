/**
 * WhatsApp OTP — orchestration.
 *
 * Bridges the pure crypto lib (`lib/whatsapp-otp.ts`) and the OpenWA
 * gateway (`services/openwa.service.ts`) with the database + audit
 * + JWT layers.
 *
 * Phase 1 wires the `registration` purpose only. `login` and `2fa`
 * are reserved for future phases and are NOT mounted as routes today
 * — but the schema, lib, and orchestration layer all already accept
 * those purposes so future phases will be additive.
 */

import {
  db,
  usersTable,
  whatsappOtpsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { logAuthActivity } from "../lib/auth-activity";
import { generateReferralCode, normalizeLibyanPhone } from "../lib/crypto";
import { signUserToken } from "../lib/jwt";
import { logger } from "../lib/logger";
import {
  generateOtp,
  hashOtp,
  OTP_HOURLY_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_SEC,
  type OtpPurpose,
  verifyOtp as verifyOtpPure,
} from "../lib/whatsapp-otp";
import { buildChatId, sendWhatsAppMessage } from "./openwa.service";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

function getServerSecret(): string {
  const s = (process.env.SESSION_SECRET ?? "").trim();
  if (!s) {
    // Fail loud at runtime — production must have SESSION_SECRET.
    // This matches the rest of the auth surface (signUserToken would
    // already throw too).
    throw new Error("SESSION_SECRET is required for WhatsApp OTP");
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// startOtp — generate + send
// ─────────────────────────────────────────────────────────────────────────────

export type StartOtpResult =
  | { ok: true; expiresAt: Date }
  | {
      ok: false;
      reason:
        | "invalid_phone"
        | "cooldown"
        | "hourly_limit"
        | "delivery_failed"
        | "recipient_not_on_whatsapp"
        | "gateway_disabled";
      retryAfterSec?: number;
    };

interface StartOtpInput {
  rawPhone: string;
  purpose: OtpPurpose;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Issue a WhatsApp OTP for the given phone.
 *
 * Rate limits (anti-abuse):
 *   - One send per OTP_RESEND_COOLDOWN_SEC seconds per phone
 *   - At most OTP_HOURLY_LIMIT sends per phone per rolling hour
 *
 * On gateway delivery failure the row is NOT created — that prevents
 * a downed gateway from accumulating dead rows that otherwise count
 * toward the hourly limit.
 */
export async function startOtp(input: StartOtpInput): Promise<StartOtpResult> {
  const phone = normalizeLibyanPhone(input.rawPhone);
  if (!phone) {
    await safeLog({
      identifier: `wa:${input.rawPhone.slice(0, 4)}…`,
      action: "register",
      success: false,
      failureReason: "invalid_phone",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "invalid_phone" };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const cooldownStart = new Date(Date.now() - OTP_RESEND_COOLDOWN_SEC * 1000);

  // Hourly limit + cooldown probe in a single round-trip.
  const recent = await db
    .select({
      createdAt: whatsappOtpsTable.createdAt,
    })
    .from(whatsappOtpsTable)
    .where(
      and(eq(whatsappOtpsTable.phone, phone), gte(whatsappOtpsTable.createdAt, oneHourAgo)),
    )
    .orderBy(desc(whatsappOtpsTable.createdAt));

  if (recent.length > 0 && recent[0].createdAt >= cooldownStart) {
    const retry = Math.max(
      1,
      Math.ceil(
        (recent[0].createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000 - Date.now()) / 1000,
      ),
    );
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "cooldown",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "cooldown", retryAfterSec: retry };
  }

  if (recent.length >= OTP_HOURLY_LIMIT) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "hourly_limit",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "hourly_limit" };
  }

  // Generate + send BEFORE inserting, so a delivery failure doesn't
  // leave a dead row that throttles the user's next attempt.
  const code = generateOtp();
  const send = await sendWhatsAppMessage(
    buildChatId(phone),
    // Layout per the brief — code on its own isolated line, prominent,
    // easy to long-press-copy. The triple-backtick block in WhatsApp is
    // visually a monospace chunk AND selectable as a single unit on
    // long-press, which is the closest WhatsApp gets to a native
    // "copy code" button (only available on the official Business
    // Cloud API authentication template, not on whatsapp-web.js).
    //
    //   *SubNation — رمز التحقق*
    //
    //   ```123456```
    //
    //   صالح لمدة 5 دقائق
    //   ⚠️ لا تشاركه مع أحد
    `*SubNation — رمز التحقق*\n\n\`\`\`${code}\`\`\`\n\nصالح لمدة 5 دقائق\n⚠️ لا تشاركه مع أحد`,
  );
  if (!send.ok) {
    // `not_configured` (env missing) and `session_not_*` (operator
    // hasn't scanned the QR yet / session disconnected) are both
    // "service is not currently available" — surface as 503 to the
    // client instead of 502 so retry semantics + UX copy match the
    // existing gateway-disabled story. Genuine wire failures
    // (timeouts, non-2xx from a ready session) remain `delivery_failed`.
    // `recipient_not_on_whatsapp` is a client-fixable condition (wrong
    // number) — surface it as its own reason so the UI can show a
    // targeted Arabic message rather than a generic "delivery failed".
    const isGatewayDisabled =
      send.reason === "not_configured" ||
      send.reason === "session_not_found" ||
      send.reason === "session_not_ready";
    const isRecipientMissing = send.reason === "recipient_not_on_whatsapp";
    const failureReason = isGatewayDisabled
      ? "gateway_disabled"
      : isRecipientMissing
        ? "recipient_not_on_whatsapp"
        : "delivery_failed";
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return {
      ok: false,
      reason: failureReason,
    };
  }

  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
  await db.insert(whatsappOtpsTable).values({
    phone,
    codeHash: hashOtp(code, phone, input.purpose, getServerSecret()),
    purpose: input.purpose,
    expiresAt,
    ipAddress: input.ipAddress,
  });

  await safeLog({
    identifier: `wa:${phone}`,
    action: "register",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { ok: true, expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyOtp — verify + finds-or-creates user + JWT
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyOtpResult =
  | {
      ok: true;
      token: string;
      isNewUser: boolean;
      user: typeof usersTable.$inferSelect;
    }
  | {
      ok: false;
      reason: "invalid_phone" | "no_active_code" | "consumed" | "expired" | "exhausted" | "mismatch";
    };

interface VerifyOtpInput {
  rawPhone: string;
  code: string;
  purpose: OtpPurpose;
  ipAddress?: string;
  userAgent?: string;
  /** Optional — propagated to new-user creation when set. */
  referralCode?: string;
}

/**
 * Verify a submitted OTP. On success, finds-or-creates the user and
 * returns a signed JWT.
 *
 * Failed attempts increment the row's `attempts` counter; once the
 * cap is hit, `consumedAt` is set so the same code can never be
 * brute-forced piecewise. Successful verifies also set `consumedAt`,
 * preventing replay even by the legitimate user.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const phone = normalizeLibyanPhone(input.rawPhone);
  if (!phone) return { ok: false, reason: "invalid_phone" };

  // Latest unconsumed OTP for this (phone, purpose).
  const [row] = await db
    .select()
    .from(whatsappOtpsTable)
    .where(
      and(
        eq(whatsappOtpsTable.phone, phone),
        eq(whatsappOtpsTable.purpose, input.purpose),
        isNull(whatsappOtpsTable.consumedAt),
      ),
    )
    .orderBy(desc(whatsappOtpsTable.createdAt))
    .limit(1);

  if (!row) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "no_active_code",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "no_active_code" };
  }

  const verdict = verifyOtpPure(
    input.code,
    { ...row, purpose: row.purpose as OtpPurpose },
    getServerSecret(),
  );
  if (!verdict.ok) {
    // Increment attempts on a real mismatch; if we hit the cap, hard-consume
    // the row so it cannot be brute-forced further.
    if (verdict.reason === "mismatch") {
      const newAttempts = row.attempts + 1;
      await db
        .update(whatsappOtpsTable)
        .set({
          attempts: newAttempts,
          consumedAt: newAttempts >= OTP_MAX_ATTEMPTS ? new Date() : null,
        })
        .where(eq(whatsappOtpsTable.id, row.id));
    }
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: verdict.reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: verdict.reason };
  }

  // Successful verify — consume the row (replay protection) then
  // finds-or-creates the user.
  await db
    .update(whatsappOtpsTable)
    .set({ consumedAt: new Date() })
    .where(eq(whatsappOtpsTable.id, row.id));

  const { user, isNewUser } = await findOrCreateWhatsAppUser(
    phone,
    input.purpose,
    input.referralCode,
  );
  const token = signUserToken({ userId: user.id });

  await safeLog({
    userId: user.id,
    identifier: `wa:${phone}`,
    action: isNewUser ? "register" : "login",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { ok: true, token, isNewUser, user };
}

// ─────────────────────────────────────────────────────────────────────────────
// findOrCreateWhatsAppUser
// ─────────────────────────────────────────────────────────────────────────────

async function findOrCreateWhatsAppUser(
  phone: string,
  _purpose: OtpPurpose,
  referralCode: string | undefined,
): Promise<{ user: typeof usersTable.$inferSelect; isNewUser: boolean }> {
  const now = new Date();

  // Existing user with this phone — login path.
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  if (existing) {
    // Lift phoneVerified=true if it wasn't already (e.g. user previously
    // signed in via Google with the same phone but never verified it).
    if (!existing.phoneVerified) {
      await db
        .update(usersTable)
        .set({ phoneVerified: true, lastAuthAt: now })
        .where(eq(usersTable.id, existing.id));
      return { user: { ...existing, phoneVerified: true, lastAuthAt: now }, isNewUser: false };
    }
    await db
      .update(usersTable)
      .set({ lastAuthAt: now })
      .where(eq(usersTable.id, existing.id));
    return { user: existing, isNewUser: false };
  }

  // Apply referral code if it resolves.
  let referredById: number | undefined;
  if (referralCode) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, referralCode))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      phone,
      phoneVerified: true,
      authProvider: "whatsapp_phone",
      referralCode: generateReferralCode(),
      referredBy: referredById,
      walletBalance: referredById ? "5.00" : "0.00",
      lastAuthAt: now,
    })
    .returning();

  return { user: created, isNewUser: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function safeLog(params: {
  userId?: number;
  identifier: string;
  action: "register" | "login";
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await logAuthActivity({ ...params, provider: "whatsapp" });
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.otp",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] auth-activity log failed (non-fatal)",
    );
  }
}

/**
 * Best-effort pruning helper. Not wired to a cron job in this commit
 * — exposed so a future job can call `pruneExpiredOtps()` periodically.
 * Idempotent. Returns the number of rows deleted.
 */
export async function pruneExpiredOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db.execute(
    sql`DELETE FROM whatsapp_otps WHERE created_at < ${cutoff}`,
  );
  // pg returns affected count via `rowCount`.
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
