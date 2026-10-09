/**
 * Telegram auth flows — the business-logic core behind the public
 * /api/auth/telegram* endpoints (R126-L9 split, A3 plan E).
 *
 * Extracted verbatim from routes/auth-settings.ts (the services/
 * firebase-auth.service.ts template): user find-or-create + linkage,
 * the widget/redirect verification flow, and the Mini App (WebApp)
 * auto-login flow — referral recording, session minting, replay-hash
 * claiming, risk emission, and auth-activity telemetry included.
 * The routes in routes/auth-settings.ts now only own transport
 * (cookies, redirects, response envelopes) and delegate here.
 * Byte-move: zero behavior change; the module depends only on lib/ +
 * @workspace/db (+ the auth-settings store for provider config reads).
 */
import { db, referralEventsTable, userAuthIdentitiesTable, usersTable } from "@workspace/db";
import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { generateReferralCode } from "../lib/crypto";
import { createUserSession } from "../lib/session";
import { logAuthActivity } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { scoreEventFireAndForget } from "../lib/risk-emit";
// 93-A1 S3 (round-93): replay-hash claim + per-flow TTLs moved to
// lib/telegram-replay.ts (TTL ≥ freshness + bounded no-Redis fallback).
import {
  TELEGRAM_WEBAPP_REPLAY_TTL_SEC,
  TELEGRAM_WIDGET_REPLAY_TTL_SEC,
  claimTelegramReplayHash,
} from "../lib/telegram-replay";
import {
  type TelegramAuthFields,
  verifyTelegramAuth,
  verifyTelegramWebAppData,
} from "../lib/telegram-auth";
import { getSetting } from "./auth-settings-store";

/**
 * Find or create the user record for the verified Telegram identity.
 * Mirrors the linkage semantics of services/firebase-auth.service.ts:
 *   1. Match by `telegram_id` (existing Telegram-linked account).
 *   2. Otherwise insert a fresh user with `telegram_id` set. Referral
 *      signup bonuses are granted on the first approved topup —
 *      uniformly with every other channel (R115 policy B, see below).
 */

/**
 * R115 (welcome-bonus policy B) — superscedes the F-16 / 93-A2 P1-3 gate.
 *
 * History: the instant 5.00 LYD referee credit was once granted at
 * signup (farmable on free Telegram accounts — 93-A2 P1-3), then gated
 * behind phone verification for Telegram ONLY (F-16), which silently
 * broke the promise for every Telegram referred signup — the deferred
 * credit was never implemented (the "C1 follow-up").
 *
 * Policy now (all channels — Google, WhatsApp, Telegram alike):
 *   signup records the relationship (users.referred_by + a pending
 *   referral_events row) and grants NOTHING; the FIRST APPROVED TOPUP
 *   grants the referee's WELCOME_BONUS_LYD wallet credit AND the
 *   referrer's POINTS_PER_REFERRAL in one transaction
 *   (services/topup.service.ts), guarded exactly-once by
 *   users.welcome_bonus_granted. Abuse economics: a farmed account must
 *   now pass a manually-approved paid topup before any credit lands.
 */

export async function findOrCreateTelegramUser(
  fields: TelegramAuthFields,
  referralCode: string | undefined,
): Promise<{ user: typeof usersTable.$inferSelect; isNewUser: boolean }> {
  const tgId = fields.id;
  const now = new Date();
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, tgId))
    .limit(1);
  if (existing) {
    // Refresh the identity row's last_seen_at so admins see recent
    // Telegram activity in /admin/security and the profile page's
    // linked-accounts list reflects it.
    await db
      .insert(userAuthIdentitiesTable)
      .values({
        userId: existing.id,
        provider: "telegram.org",
        providerUid: tgId,
        phone: existing.phone,
        email: existing.email,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [userAuthIdentitiesTable.provider, userAuthIdentitiesTable.providerUid],
        set: { userId: existing.id, lastSeenAt: now },
      });
    return { user: existing, isNewUser: false };
  }

  // Apply referral if one was supplied AND it resolves to a real user.
  let referredById: number | undefined;
  if (referralCode) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, referralCode))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const displayName = [fields.first_name, fields.last_name].filter(Boolean).join(" ").trim();

  // R115 (policy B): no instant grant on ANY channel — the referral
  // relationship is recorded here; the welcome credit + referrer points
  // both land on the first approved topup (topup.service.ts).

  const [created] = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(usersTable)
      .values({
        // Placeholder phone — Telegram doesn't expose phone via the widget.
        // Profile flow can later let the user add a real phone & link OTP.
        phone: `tg_${tgId}`,
        telegramId: tgId,
        displayName: displayName || undefined,
        photoUrl: fields.photo_url ?? undefined,
        authProvider: "telegram",
        referralCode: generateReferralCode(),
        referredBy: referredById,
        walletBalance: "0.00",
        lastAuthAt: now,
      })
      .returning();

    return [u];
  });

  // Mirror the user into user_auth_identities so /api/auth/providers/linked
  // surfaces Telegram alongside Google and Phone OTP. Provider string
  // matches migrate.ts's seeded mapping at line 736.
  await db
    .insert(userAuthIdentitiesTable)
    .values({
      userId: created.id,
      provider: "telegram.org",
      providerUid: tgId,
      phone: created.phone,
      email: created.email,
      lastSeenAt: now,
    })
    .onConflictDoNothing();

  if (referredById && referredById !== created.id) {
    await db
      .insert(referralEventsTable)
      .values({ referrerId: referredById, refereeId: created.id, status: "pending" })
      .onConflictDoNothing();
  }

  return { user: created, isNewUser: true };
}

/**
 * Shared handler used by both POST (callback mode) and GET (redirect
 * mode). The transport differs but the verification + linkage is
 * identical.
 *
 * In callback mode this returns JSON `{ token }`. In redirect mode the
 * caller sets the auth_token httpOnly cookie and 302s the user to
 * /auth/callback (no `?token=` in the URL — F-010 / security audit 004:
 * the cookie is the sole transport so the JWT does not leak into
 * browser history / Referer headers / access logs).
 */
export async function handleTelegramAuth(
  data: Record<string, unknown>,
  client: { ipAddress: string; userAgent: string },
): Promise<
  | { ok: true; token: string; isNewUser: boolean }
  | { ok: false; status: number; error: string; reason: string }
> {
  const config = await getSetting("auth.telegram");
  if (!config.enabled || typeof config.bot_token !== "string" || !config.bot_token) {
    return {
      ok: false,
      status: 503,
      error: "تسجيل الدخول عبر Telegram غير مفعّل",
      reason: "provider_disabled",
    };
  }

  const verification = verifyTelegramAuth(data, config.bot_token);
  if (!verification.ok) {
    // Single localised message regardless of internal reason — never
    // leak whether the failure was signature vs replay vs freshness.
    const userMsg =
      verification.reason === "stale_auth_date"
        ? "انتهت صلاحية الجلسة، حاول مجدداً"
        : "فشل التحقق من Telegram";
    await logAuthActivity({
      identifier:
        typeof data.id === "string" || typeof data.id === "number"
          ? `tg:${String(data.id)}`
          : "tg:unknown",
      action: "login",
      provider: "telegram",
      success: false,
      failureReason: verification.reason,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    }).catch((err) => {
      // Non-fatal — auth-telemetry insert failed. Log + breadcrumb
      // so brute-force attempts are not silently lost.
      logger.warn(
        { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
        "logAuthActivity: failed to record telegram-auth failure",
      );
      Sentry.addBreadcrumb({
        category: "auth.telegram",
        level: "error",
        message: "logAuthActivity insert failed (failure path)",
      });
    });
    Sentry.addBreadcrumb({
      category: "auth.telegram",
      level: "warning",
      message: "telegram-auth failed",
      data: { reason: verification.reason },
    });
    logger.warn(
      { category: "auth", reason: verification.reason },
      "[telegram-auth] verification failed",
    );
    return {
      ok: false,
      status:
        verification.reason === "missing_hash" || verification.reason === "missing_id" ? 400 : 401,
      error: userMsg,
      reason: verification.reason,
    };
  }

  // Replay protection — fail if the hash was already consumed.
  // 93-A1 S3: per-flow TTL — widget payloads are only fresh for
  // TELEGRAM_AUTH_FRESHNESS_SEC, so the store key now outlives that
  // window (freshness + slack) instead of expiring with it.
  const claimed = await claimTelegramReplayHash(
    verification.fields.hash,
    TELEGRAM_WIDGET_REPLAY_TTL_SEC,
  );
  if (!claimed) {
    await logAuthActivity({
      identifier: `tg:${verification.fields.id}`,
      action: "login",
      provider: "telegram",
      success: false,
      failureReason: "replay_detected",
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    }).catch((err) => {
      // Non-fatal — but a replay-detection attempt that failed to
      // record is the LEAST tolerable telemetry loss. Surface loudly.
      logger.warn(
        { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
        "logAuthActivity: failed to record telegram-auth replay-detected event",
      );
      Sentry.addBreadcrumb({
        category: "auth.telegram",
        level: "error",
        message: "logAuthActivity insert failed (replay-detected path)",
      });
    });
    Sentry.addBreadcrumb({
      category: "auth.telegram",
      level: "error",
      message: "telegram-auth replay detected",
    });
    logger.error(
      { category: "auth", tgId: verification.fields.id },
      "[telegram-auth] replay rejected",
    );
    return {
      ok: false,
      status: 401,
      error: "تم استخدام هذه الجلسة من قبل، حاول مجدداً",
      reason: "replay_detected",
    };
  }

  // Referral code may live alongside the widget data on POST, or in
  // the query string on GET — both paths normalise via this key.
  const rawRef = data.referralCode;
  const referralCode =
    typeof rawRef === "string" ? rawRef.trim().toUpperCase().slice(0, 16) || undefined : undefined;

  const { user, isNewUser } = await findOrCreateTelegramUser(verification.fields, referralCode);
  const { token } = await createUserSession({
    userId: user.id,
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  // Risk pipeline (003-anomaly-detection) — emit login_success.
  scoreEventFireAndForget({
    eventType: "login_success",
    userId: user.id,
    ipAddress: client.ipAddress ?? null,
    userAgent: client.userAgent ?? null,
    phone: user.phone ?? null,
    ruleContext: {
      event: {
        eventType: "login_success",
        ipAddress: client.ipAddress ?? null,
        userAgent: client.userAgent ?? null,
      },
      user: { id: user.id },
    },
  });

  await logAuthActivity({
    userId: user.id,
    identifier: `tg:${verification.fields.id}`,
    action: isNewUser ? "register" : "login",
    provider: "telegram",
    success: true,
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  }).catch((err) => {
    // Non-fatal — successful login still proceeds. Log so the
    // success record's absence in auth_activity is auditable.
    logger.warn(
      { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
      "logAuthActivity: failed to record telegram-auth success",
    );
    Sentry.addBreadcrumb({
      category: "auth.telegram",
      level: "warning",
      message: "logAuthActivity insert failed (success path)",
    });
  });

  Sentry.addBreadcrumb({
    category: "auth.telegram",
    level: "info",
    message: isNewUser ? "telegram-auth register" : "telegram-auth login",
    data: { userId: user.id },
  });

  logger.info(
    {
      category: "auth",
      userId: user.id,
      provider: "telegram",
      isNewUser,
    },
    "[telegram-auth] succeeded",
  );

  return { ok: true, token, isNewUser };
}

/**
 * Telegram Mini App / WebApp auto-login handler.
 *
 * Parallel to `handleTelegramAuth` but for the Mini App SDK flow:
 * when the user opens the site INSIDE the Telegram client, the SDK
 * exposes `window.Telegram.WebApp.initData` carrying a verified
 * identity. The user is already authenticated by Telegram itself,
 * so they NEVER see the phone-number prompt that oauth.telegram.org
 * shows for first-time browser users.
 *
 * This handler shares the same downstream pieces (replay protection
 * via the embedded `hash`, find-or-create via `findOrCreateTelegramUser`,
 * JWT issuance via `signUserToken`, audit logging via `logAuthActivity`)
 * — only the wire-format and HMAC algorithm differ.
 */
export async function handleTelegramWebAppAuth(
  initData: string,
  referralCode: string | undefined,
  client: { ipAddress?: string; userAgent?: string },
): Promise<
  | { ok: true; token: string; isNewUser: boolean }
  | { ok: false; status: number; error: string; reason: string }
> {
  const config = await getSetting("auth.telegram");
  if (!config.enabled || typeof config.bot_token !== "string" || !config.bot_token) {
    return {
      ok: false,
      status: 503,
      error: "تسجيل الدخول عبر Telegram غير مفعّل",
      reason: "provider_disabled",
    };
  }

  const verification = verifyTelegramWebAppData(initData, config.bot_token);
  if (!verification.ok) {
    const userMsg =
      verification.reason === "stale_auth_date"
        ? "انتهت صلاحية الجلسة، حاول مجدداً"
        : "فشل التحقق من Telegram";
    await logAuthActivity({
      identifier: "tg:webapp_unknown",
      action: "login",
      provider: "telegram",
      success: false,
      failureReason: verification.reason,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    }).catch((err) => {
      logger.warn(
        { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
        "logAuthActivity: failed to record telegram-webapp failure",
      );
    });
    Sentry.addBreadcrumb({
      category: "auth.telegram",
      level: "warning",
      message: "telegram-webapp verification failed",
      data: { reason: verification.reason },
    });
    return {
      ok: false,
      status:
        verification.reason === "missing_init_data" ||
        verification.reason === "missing_hash" ||
        verification.reason === "missing_user"
          ? 400
          : 401,
      error: userMsg,
      reason: verification.reason,
    };
  }

  // Replay protection — reuse the same hash table as the redirect
  // path so a leaked initData can't be replayed against either flow.
  // 93-A1 S3: the Mini App freshness window is 24 h — the claim TTL is
  // TELEGRAM_WEBAPP_REPLAY_TTL_SEC (25 h) so the store key can NEVER
  // expire before the payload it guards goes stale (the old code used
  // the widget's 30-minute TTL, leaving a 23.5-hour replay hole).
  const initParams = new URLSearchParams(initData);
  const hash = initParams.get("hash") ?? "";
  const claimed = await claimTelegramReplayHash(hash, TELEGRAM_WEBAPP_REPLAY_TTL_SEC);
  if (!claimed) {
    Sentry.addBreadcrumb({
      category: "auth.telegram",
      level: "error",
      message: "telegram-webapp replay detected",
    });
    return {
      ok: false,
      status: 401,
      error: "تم استخدام هذه الجلسة من قبل، حاول مجدداً",
      reason: "replay_detected",
    };
  }

  // Map the WebApp user shape onto the existing TelegramAuthFields
  // contract so we can reuse findOrCreateTelegramUser unchanged.
  const fieldsForFindOrCreate = {
    id: verification.user.id,
    first_name: verification.user.first_name,
    last_name: verification.user.last_name,
    username: verification.user.username,
    photo_url: verification.user.photo_url,
    auth_date: verification.auth_date,
    hash,
  };
  const { user, isNewUser } = await findOrCreateTelegramUser(fieldsForFindOrCreate, referralCode);
  const { token } = await createUserSession({
    userId: user.id,
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  // Risk pipeline (003-anomaly-detection) — emit login_success.
  scoreEventFireAndForget({
    eventType: "login_success",
    userId: user.id,
    ipAddress: client.ipAddress ?? null,
    userAgent: client.userAgent ?? null,
    phone: user.phone ?? null,
    ruleContext: {
      event: {
        eventType: "login_success",
        ipAddress: client.ipAddress ?? null,
        userAgent: client.userAgent ?? null,
      },
      user: { id: user.id },
    },
  });

  await logAuthActivity({
    userId: user.id,
    identifier: `tg:${verification.user.id}`,
    action: isNewUser ? "register" : "login",
    provider: "telegram",
    success: true,
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  }).catch(() => {
    // Non-fatal — login proceeds even if telemetry insert fails.
  });

  Sentry.addBreadcrumb({
    category: "auth.telegram",
    level: "info",
    message: isNewUser ? "telegram-webapp register" : "telegram-webapp login",
    data: { userId: user.id },
  });

  logger.info(
    {
      category: "auth",
      userId: user.id,
      provider: "telegram",
      isNewUser,
      flow: "webapp",
    },
    "[telegram-webapp] succeeded",
  );

  return { ok: true, token, isNewUser };
}
