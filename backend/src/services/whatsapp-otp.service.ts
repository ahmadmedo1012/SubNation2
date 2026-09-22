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

import { db, referralEventsTable, usersTable, whatsappOtpsTable } from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { createHmac } from "crypto";

import { logAuthActivity } from "../lib/auth-activity";
import { generateReferralCode, normalizeLibyanPhone } from "../lib/crypto";
import { createUserSession } from "../lib/session";
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
import { insertReferralSignupLedger } from "../lib/ledger";
import { fireThrottledMaintenance } from "../lib/opportunistic";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Exported for the pglite test seams (hashOtp calls must use the SAME derived key). */
export function getServerSecret(): string {
  // A8-07 (round-94): the OTP HMAC key used to BE SESSION_SECRET — key
  // reuse across purpose classes. A DB dump (codeHash rows) + a
  // SESSION_SECRET leak would let an attacker brute the 10^6 OTP space
  // offline for LIVE codes. A purpose-scoped derivation
  // HMAC(SESSION_SECRET, "whatsapp-otp-v1") gives a distinct key that
  // costs the attacker an extra HMAC oracle even with the session secret
  // in hand, and makes the OTP domain independent from the JWT domain.
  // (OTP_HMAC_KEY env override for future rotation; zero rows exist in
  // the live DB today — 2026-09-08 inspection — so no in-flight codes
  // are invalidated by the derivation change.)
  const explicit = (process.env.OTP_HMAC_KEY ?? "").trim();
  if (explicit.length >= 32) return explicit;
  const s = (process.env.SESSION_SECRET ?? "").trim();
  if (!s) {
    // Fail loud at runtime — production must have SESSION_SECRET.
    // This matches the rest of the auth surface (signUserToken would
    // already throw too).
    throw new Error("SESSION_SECRET is required for WhatsApp OTP");
  }
  return createHmac("sha256", s).update("whatsapp-otp-v1").digest("hex");
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
        | "whatsapp_not_paired"
        // 96-F1 (R96-A4 §1.3C): the session was just linked and is still
        // inside the settle / warm-up window — retry after retryAfterSec.
        | "whatsapp_settling"
        // R102 (cold-wake, R102-B F3): the gateway itself is booting after
        // a Render-Free idle sleep — the retry loop exhausted its ~30 s
        // budget against a service that needs 30-60 s+ to boot. The honest
        // verdict is "waking, retry later" (503 + Retry-After), not a hard
        // 502 — the frontend then rides the wake with its auto-retry.
        | "gateway_waking"
        // 96-F1 (R96-A4 §4.2): the WhatsApp message WAS delivered but the
        // OTP row could not be persisted (insert failed twice). The client
        // gets a short cooldown so it does not instantly re-send a SECOND
        // WhatsApp message ("which code is mine?") while the first is live.
        | "store_failed"
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
  // 2026-09-20 (free-infrastructure round): real OTP intent is the
  // on-demand trigger for the expired-row prune (was the hourly :15
  // cron slot). Throttled 60 min, fire-and-forget — the OTP request
  // never waits on the retention DELETE.
  fireThrottledMaintenance("whatsapp-otp-prune", 60 * 60 * 1000, pruneExpiredOtps);

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
    .where(and(eq(whatsappOtpsTable.phone, phone), gte(whatsappOtpsTable.createdAt, oneHourAgo)))
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
    // Clean structure per the brief — code is isolated on its own
    // line by blank lines above and below, no markdown decoration:
    //
    //   SubNation — رمز التحقق
    //
    //   123456
    //
    //   صالح لمدة 5 دقائق.
    //   لا تشارك هذا الرمز مع أحد.
    //
    // The 6-digit numeric string is treated as a single "word" by
    // WhatsApp's text selection on Android & iOS, so triple-tap (or
    // long-press → already-correct selection) selects the entire
    // code in one gesture. A real native "copy code" button is only
    // available on the official Business Cloud API authentication
    // template, which is out of scope for whatsapp-web.js / OpenWA.
    `SubNation — رمز التحقق\n\n${code}\n\nصالح لمدة 5 دقائق.\nلا تشارك هذا الرمز مع أحد.`,
  );
  if (!send.ok) {
    // `not_configured` (env missing) / `session_not_found` are
    // "service is not available" → 503. `session_not_ready` is its own
    // HONEST state (r95): the gateway is configured but the WhatsApp
    // session has not been paired (or dropped mid-flight) — the user
    // sees "قناة واتساب غير مربوطة حاليًا" instead of a misleading
    // generic "gateway disabled". Genuine wire failures (timeouts,
    // non-2xx from a ready session) remain `delivery_failed`.
    // `recipient_not_on_whatsapp` is a client-fixable condition (wrong
    // number) — surface it as its own reason so the UI can show a
    // targeted Arabic message rather than a generic "delivery failed".
    //
    // 96-F1 (R96-A4 §1.3C): `session_settling` is the settle-gate
    // verdict — the channel was paired moments ago and WhatsApp's
    // multi-device key distribution has not propagated yet (the
    // "Waiting for this message" race). It maps to its own honest
    // reason + retryAfterSec so the route can answer 503 + Retry-After
    // and the client can auto-retry instead of burning a resend.
    const isGatewayDisabled =
      send.reason === "not_configured" || send.reason === "session_not_found";
    const isNotPaired = send.reason === "session_not_ready";
    const isSettling = send.reason === "session_settling";
    const isRecipientMissing = send.reason === "recipient_not_on_whatsapp";
    // R102 (cold-wake): the RETRYABLE wire-failure shape — network
    // error/timeout (request_failed) or a 5xx from the gateway. The
    // retry loop (3 attempts, ~30 s) already burned through, and on the
    // free tier that exhaustion almost always means the gateway is
    // mid-boot after an idle sleep — a definitive-looking 502 forced the
    // user to manually re-tap (which then succeeded once awake). 4xx
    // rejections stay `delivery_failed` — those are NOT a wake shape.
    const isGatewayWaking =
      send.reason === "request_failed" ||
      (send.reason === "non_ok_status" && (send.status ?? 0) >= 500);
    const failureReason = isGatewayDisabled
      ? "gateway_disabled"
      : isNotPaired
        ? "whatsapp_not_paired"
        : isSettling
          ? "whatsapp_settling"
          : isGatewayWaking
            ? "gateway_waking"
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
      ...(isSettling && send.readyInMs !== undefined
        ? { retryAfterSec: Math.max(1, Math.ceil(send.readyInMs / 1000)) }
        : isGatewayWaking
          ? { retryAfterSec: 30 }
          : {}),
    };
  }

  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
  const insertValues = {
    phone,
    codeHash: hashOtp(code, phone, input.purpose, getServerSecret()),
    purpose: input.purpose,
    expiresAt,
    ipAddress: input.ipAddress,
  };

  // 96-F1 (R96-A4 §4.2): the message is ALREADY on the user's phone at
  // this point — a DB blip on the insert must not 500 with no cooldown
  // (the old shape let the client instantly re-request → a SECOND
  // WhatsApp message while the first code is still valid and readable).
  // Retry the insert once; on final failure return `store_failed` with
  // retry_after_sec: 30 so the route answers 500 + Retry-After and the
  // client applies a short cooldown instead of re-sending.
  let stored = false;
  for (let attempt = 1; attempt <= 2 && !stored; attempt++) {
    try {
      await db.insert(whatsappOtpsTable).values(insertValues);
      stored = true;
    } catch (err) {
      logger.warn(
        {
          category: "whatsapp.otp",
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        attempt === 1
          ? "[whatsapp-otp] OTP row insert failed — retrying once"
          : "[whatsapp-otp] OTP row insert failed after retry",
      );
    }
  }
  if (!stored) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "store_failed",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "store_failed", retryAfterSec: 30 };
  }

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
      reason:
        | "invalid_phone"
        | "no_active_code"
        | "consumed"
        | "expired"
        | "exhausted"
        | "mismatch";
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
    // the row so it cannot be brute-forced further. Atomic SQL increment —
    // the previous JS read-modify-write let N concurrent guesses all read
    // the same count and blow past the cap.
    if (verdict.reason === "mismatch") {
      const [bumped] = await db
        .update(whatsappOtpsTable)
        .set({ attempts: sql`${whatsappOtpsTable.attempts} + 1` })
        .where(eq(whatsappOtpsTable.id, row.id))
        .returning({ attempts: whatsappOtpsTable.attempts });
      const newAttempts = bumped?.attempts ?? (row.attempts ?? 0) + 1;
      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        await db
          .update(whatsappOtpsTable)
          .set({ consumedAt: new Date() })
          .where(and(eq(whatsappOtpsTable.id, row.id), isNull(whatsappOtpsTable.consumedAt)));
      }
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
  //
  // F6 (round-94 A4): the consume is now a guarded compare-and-set. The
  // old unconditional UPDATE matched the row even when a concurrent
  // double-submit had already consumed it: both requests passed the
  // SELECT (row still unconsumed), both passed HMAC, both "succeeded",
  // and for a NEW phone both entered find-or-create → the second INSERT
  // tripped users.phone UNIQUE as an unclassified 23505 → raw 500 for a
  // registration that actually succeeded. With the isNull(consumedAt)
  // predicate, the race loser's UPDATE matches 0 rows and returns the
  // same stable, already-mapped "consumed" verdict the sequential
  // replay gets (route: 401 «تم استخدام هذا الرمز بالفعل» — the
  // OTP-already-used stable code path) instead of a 500.
  const consumed = await db
    .update(whatsappOtpsTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(whatsappOtpsTable.id, row.id), isNull(whatsappOtpsTable.consumedAt)))
    .returning({ id: whatsappOtpsTable.id });
  if (consumed.length !== 1) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "consumed",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "consumed" };
  }

  const { user, isNewUser } = await findOrCreateWhatsAppUser(
    phone,
    input.purpose,
    input.referralCode,
  );
  const { token } = await createUserSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

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
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

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
    await db.update(usersTable).set({ lastAuthAt: now }).where(eq(usersTable.id, existing.id));
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

  const [created] = await db.transaction(async (tx) => {
    const [u] = await tx
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

    // Ledger parity for the signup bonus (Constitution §I).
    if (referredById) await insertReferralSignupLedger(tx as unknown as typeof db, u.id);

    // F2 (round-94 A4): the referral EVENT row, in the same tx as the
    // user it refers. Telegram (auth-settings.ts) and Firebase
    // (firebase-auth.service.ts) both insert { referrer, referee,
    // status: 'pending' } at signup; this WhatsApp path was the only
    // channel that skipped it — user.referredBy was set and the 5 LYD
    // welcome bonus + ledger landed, but TopupService.approve (the
    // sole consumer) requires the event row to award the referrer's
    // +50 points on the first topup, so the promise silently never
    // paid on this channel (/admin/referrals showed pending: 0).
    // Same value shape + onConflictDoNothing as the sibling channels;
    // in-tx (stronger than they are) so the event can never exist
    // without the user row it belongs to.
    if (referredById && referredById !== u.id) {
      await tx
        .insert(referralEventsTable)
        .values({ referrerId: referredById, refereeId: u.id, status: "pending" })
        .onConflictDoNothing();
    }

    return [u];
  });

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
 * Best-effort pruning helper. TRIGGERS (2026-09-20 free-infrastructure
 * round): the leader boot one-shot (jobs/boot-one-shots.ts) + a throttled
 * 60-min opportunistic fire at the top of startOtp() (was the hourly
 * :15 cron slot) — deletes rows older than 24 h, well past the
 * 5-minute TTL and any verify window, so no active session is at risk.
 * Idempotent. Returns the number of rows deleted.
 */

// R110-H: ctid-batch ceiling per DELETE statement — same 1000-row shape
// as every other retention job (B7-P2-5 family). The 24 h window bounds
// the steady-state table, but a boot one-shot catch-up after an extended
// outage must not hold one unbounded statement lock on the shared pooler.
const OTP_PRUNE_BATCH_SIZE = 1000;

export async function pruneExpiredOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let deleted = 0;
  // Bounded batch loop (notifications-retention.ts shape): `ctid IN
  // (SELECT … LIMIT n)` until a batch comes back short, so each
  // statement's lock footprint stays tiny. Predicate embedded verbatim
  // per batch — idempotent.
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM whatsapp_otps
      WHERE ctid IN (
        SELECT ctid FROM whatsapp_otps
        WHERE created_at < ${cutoff}
        LIMIT ${OTP_PRUNE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < OTP_PRUNE_BATCH_SIZE) break;
  }
  return deleted;
}
