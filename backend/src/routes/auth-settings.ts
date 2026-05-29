/**
 * Auth Provider Settings Routes
 *
 * Public (mount at /auth):
 *   GET  /providers          → /api/auth/providers
 *   POST /telegram           → verify Telegram widget data (callback mode)
 *   GET  /telegram/callback  → verify Telegram widget data (redirect mode,
 *                              for mobile / in-app browsers where popups
 *                              + cross-window postMessage are blocked)
 *
 * Admin (mount at /admin/settings):
 *   GET   /auth              → list all providers (masked secrets)
 *   PATCH /auth/:id          → update provider config
 */

import { db, referralEventsTable, userAuthIdentitiesTable, usersTable } from "@workspace/db";
import * as Sentry from "@sentry/node";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { generateReferralCode } from "../lib/crypto";
import { stringParam } from "../lib/http";
import { signUserToken } from "../lib/jwt";
import { logAuthActivity, getClientInfo } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { getRedisClient } from "../lib/redis-client";
import {
  TELEGRAM_AUTH_FRESHNESS_SEC,
  type TelegramAuthFields,
  verifyTelegramAuth,
  verifyTelegramWebAppData,
} from "../lib/telegram-auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { isWhatsAppGatewayConfigured } from "../services/openwa.service";

// ── Provider metadata ──────────────────────────────────────────────────────────

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

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "google",
    label: "Google",
    color: "#4285F4",
    icon: "google",
    auth_type: "client_side",
    description: "تسجيل الدخول عبر Firebase Google (مستحسن)",
    setup_url: "https://console.firebase.google.com/project/_/authentication/providers",
    fields: [
      {
        key: "firebase_enabled",
        label: "Firebase مفعّل",
        isSecret: false,
        placeholder: "true/false",
      },
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    color: "#2AABEE",
    icon: "telegram",
    auth_type: "widget",
    description: "تسجيل الدخول عبر Telegram Login Widget",
    setup_url: "https://core.telegram.org/widgets/login",
    fields: [
      {
        key: "bot_username",
        label: "اسم البوت",
        isSecret: false,
        placeholder: "MyAppBot (بدون @)",
      },
      {
        key: "bot_token",
        label: "Bot Token",
        isSecret: true,
        placeholder: "1234567890:ABC-DEF...",
      },
    ],
  },
  {
    id: "apple",
    label: "Apple",
    color: "#000000",
    icon: "apple",
    auth_type: "client_side",
    description: "Sign In with Apple — يتطلب Apple Developer Program",
    setup_url: "https://developer.apple.com/account/resources/identifiers",
    fields: [
      {
        key: "client_id",
        label: "Services ID (Bundle ID)",
        isSecret: false,
        placeholder: "com.yourapp.signin",
      },
      { key: "team_id", label: "Team ID", isSecret: false, placeholder: "ABCD1234EF" },
      { key: "key_id", label: "Key ID", isSecret: false, placeholder: "ABCDE12345" },
      {
        key: "private_key",
        label: "Private Key (.p8)",
        isSecret: true,
        placeholder: "-----BEGIN PRIVATE KEY-----\n...",
      },
    ],
  },
];

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<Record<string, any>> {
  const result = await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${key} LIMIT 1`,
  );
  const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
  const row = rows[0] as any;
  if (!row?.value) return {};
  try {
    return JSON.parse(String(row.value));
  } catch {
    return {};
  }
}

async function getAllAuthSettings(): Promise<Map<string, Record<string, any>>> {
  const result = await db.execute(
    sql`SELECT key, value FROM system_settings WHERE key LIKE 'auth.%'`,
  );
  const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
  const map = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const r = row as any;
    try {
      map.set(r.key, JSON.parse(String(r.value ?? "{}")));
    } catch {
      map.set(r.key, {});
    }
  }
  return map;
}

async function upsertSetting(key: string, value: Record<string, any>) {
  const json = JSON.stringify(value);
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, ${json}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
  `);
}

function maskSecret(v: string | undefined): string {
  return v ? "[SET]" : "";
}

function buildMaskedConfig(
  meta: ProviderMeta,
  config: Record<string, any>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const field of meta.fields) {
    masked[field.key] = field.isSecret ? maskSecret(config[field.key]) : (config[field.key] ?? "");
  }
  return masked;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTER  (mount at /auth in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const authProviderPublicRouter = Router();

// GET /api/auth/providers
authProviderPublicRouter.get("/providers", async (_req, res) => {
  const settingsMap = await getAllAuthSettings();

  // Google: fall back to env var if not configured in DB
  const googleConfig = { ...(settingsMap.get("auth.google") ?? {}) };
  if (!googleConfig.client_id && process.env.GOOGLE_CLIENT_ID) {
    googleConfig.enabled = true;
    googleConfig.client_id = process.env.GOOGLE_CLIENT_ID;
  }

  // Firebase Google: always include if Firebase is enabled (regardless of GOOGLE_CLIENT_ID)
  const firebaseEnabled = process.env.FIREBASE_AUTH_ENABLED === "true";

  const providers = PROVIDERS.map((meta) => {
    const cfg = meta.id === "google" ? googleConfig : (settingsMap.get(`auth.${meta.id}`) ?? {});
    const enabled = !!cfg.enabled;
    // "has_config" = at least one non-secret public field is filled
    const hasConfig = meta.fields.some((f) => !f.isSecret && !!cfg[f.key]);

    // Telegram needs a numeric bot_id (the prefix of bot_token) to
    // build the redirect URL on the client. Parse it server-side so
    // we never expose the full bot_token to the browser. The full
    // token stays in the database and is only used by the verify
    // handler to compute the HMAC.
    let bot_id: string | null = null;
    if (meta.id === "telegram" && typeof cfg.bot_token === "string") {
      const prefix = cfg.bot_token.split(":")[0];
      if (/^\d{6,}$/.test(prefix)) bot_id = prefix;
    }

    return {
      id: meta.id,
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      auth_type: meta.auth_type,
      enabled,
      has_config: hasConfig,
      // non-secret fields only
      client_id: cfg.client_id ?? null,
      app_id: cfg.app_id ?? null,
      bot_username: cfg.bot_username ?? null,
      bot_id,
    };
  }).filter((p) => {
    if (!p.enabled || !p.has_config) return false;
    // Telegram is only usable when BOTH bot_username AND a derivable
    // bot_id are present. Skip the entry otherwise — surfacing it
    // would render a button that 404s on click.
    if (p.id === "telegram" && (!p.bot_username || !p.bot_id)) return false;
    return true;
  });

  // Add Firebase Google provider if Firebase is enabled (even without GOOGLE_CLIENT_ID)
  if (firebaseEnabled) {
    const firebaseGoogle = providers.find((p) => p.id === "google");
    if (!firebaseGoogle) {
      providers.push({
        id: "google",
        label: "Google",
        color: "#4285F4",
        icon: "google",
        auth_type: "client_side",
        enabled: true,
        has_config: true,
        client_id: null,
        app_id: null,
        bot_username: null,
        bot_id: null,
      });
    }
  }

  return res.json({
    providers,
    // Boolean only — never exposes the API key. Clients gate the
    // <WhatsAppPhoneSignIn /> render on this flag.
    whatsapp_enabled: isWhatsAppGatewayConfigured(),
  });
});

// ── Telegram Login (legacy widget) ─────────────────────────────────────────────
//
// Spec: https://core.telegram.org/widgets/login
//
// Two transports are supported, BOTH using the same hash verification:
//
//   POST /api/auth/telegram          (callback mode — desktop, iframe-ok)
//   GET  /api/auth/telegram/callback (redirect mode — mobile, in-app browsers,
//                                      WebView, COOP-strict origins)
//
// Owner setup, in @BotFather:  /setdomain → bot → "subnation.ly"
// Owner setup, in admin UI:    /admin/settings → Telegram → bot_username +
//                                                 bot_token + enable
//
// The hash-verification algorithm itself lives in lib/telegram-auth.ts so
// it can be unit-tested in isolation without standing up Express + the DB.

const TELEGRAM_REPLAY_TTL_SEC = TELEGRAM_AUTH_FRESHNESS_SEC; // mirror freshness

/**
 * Single-use replay protection. Record the hash in Redis with TTL
 * matching the freshness window. If Redis is unavailable we degrade
 * to "no replay protection beyond the auth_date window" — same as
 * before this hardening, so the path remains compatible with
 * dev-without-Redis.
 *
 * Returns `false` (replay rejected) if the hash was already seen.
 */
async function claimTelegramReplayHash(hash: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true; // dev or degraded — accept
  try {
    const result = await redis.set(`tg-login:hash:${hash}`, "1", {
      NX: true,
      EX: TELEGRAM_REPLAY_TTL_SEC,
    });
    return result === "OK";
  } catch (err) {
    // Don't fail-closed on transient Redis errors. The auth_date window
    // is the primary defense; replay-tracking is defense-in-depth.
    logger.warn(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-auth] replay-store check failed — accepting payload",
    );
    return true;
  }
}

/**
 * Find or create the user record for the verified Telegram identity.
 * Mirrors the linkage semantics of services/firebase-auth.service.ts:
 *   1. Match by `telegram_id` (existing Telegram-linked account).
 *   2. Otherwise insert a fresh user with `telegram_id` set, applying
 *      the referral bonus exactly like the Firebase path.
 */
async function findOrCreateTelegramUser(
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

  const [created] = await db
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
      walletBalance: referredById ? "5.00" : "0.00",
      lastAuthAt: now,
    })
    .returning();

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
 * caller wraps the response into a 302 to /auth/callback?token=… so
 * the existing AuthCallbackPage handles the rest.
 */
async function handleTelegramAuth(
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
      identifier: typeof data.id === "string" || typeof data.id === "number" ? `tg:${String(data.id)}` : "tg:unknown",
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
      status: verification.reason === "missing_hash" || verification.reason === "missing_id" ? 400 : 401,
      error: userMsg,
      reason: verification.reason,
    };
  }

  // Replay protection — fail if the hash was already consumed.
  const claimed = await claimTelegramReplayHash(verification.fields.hash);
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
  const token = signUserToken({ userId: user.id });

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
async function handleTelegramWebAppAuth(
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
  // path so a leaked initData can't be replayed against either.
  const initParams = new URLSearchParams(initData);
  const hash = initParams.get("hash") ?? "";
  const claimed = await claimTelegramReplayHash(hash);
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
  const { user, isNewUser } = await findOrCreateTelegramUser(
    fieldsForFindOrCreate,
    referralCode,
  );
  const token = signUserToken({ userId: user.id });

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

// POST /api/auth/telegram (callback mode — primary, called from the
//                          frontend telegram-callback page after it
//                          decodes the redirect fragment)
authProviderPublicRouter.post("/telegram", async (req, res) => {
  try {
    const result = await handleTelegramAuth(
      (req.body as Record<string, unknown>) ?? {},
      getClientInfo(req),
    );
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, reason: result.reason });
    }
    // Set httpOnly cookie so the session survives page refresh. Same
    // config as /api/auth/firebase/session (auth.ts line ~915):
    //   sameSite="lax" — required for cross-site OAuth redirect flows;
    //                    "strict" would drop the cookie on the redirect
    //                    back from oauth.telegram.org.
    //   secure — prod only (Render terminates TLS, browser sees https).
    //   maxAge — 30 days, matches the JWT expiry signed in signUserToken.
    res.cookie("auth_token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    return res.json({ token: result.token, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-auth] internal error",
    );
    return res.status(500).json(createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, { reason: "server_error" }));
  }
});

// POST /api/auth/telegram/webapp (Mini App auto-login)
//
// Called by the SPA when it detects `window.Telegram.WebApp.initData`
// at boot. The user has been authenticated by Telegram itself —
// they NEVER see the oauth.telegram.org phone-number prompt. We
// verify the WebApp HMAC, run the same replay protection as the
// redirect-flow endpoint, and issue the same JWT. Existing public
// web flow (POST /telegram + GET /telegram/callback) is unchanged.
authProviderPublicRouter.post("/telegram/webapp", async (req, res) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {};
    const initData = typeof body.initData === "string" ? body.initData : "";
    const referralCode =
      typeof body.referralCode === "string"
        ? body.referralCode.trim().toUpperCase().slice(0, 16) || undefined
        : undefined;

    const result = await handleTelegramWebAppAuth(initData, referralCode, getClientInfo(req));
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, reason: result.reason });
    }
    res.cookie("auth_token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    return res.json({ token: result.token, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-webapp] internal error",
    );
    return res
      .status(500)
      .json(
        createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
          reason: "server_error",
        }),
      );
  }
});

// GET /api/auth/telegram/callback (redirect mode — primary transport)
//
// Telegram redirects here after auth with the signed payload appended
// as URL query params. We verify the same payload as POST mode, then
// 302 the user to /auth/callback?token=… (the existing AuthCallbackPage
// stores the JWT and lands them on /). On failure we 302 to /login
// with an error code that the LoginPage maps to a localised banner.
//
// Cancellation: when the user dismisses the Telegram auth screen
// (closes the tab, taps "Cancel"), Telegram redirects back to
// return_to with NO auth payload. We detect that empty redirect
// here and surface a dedicated `cancelled` reason so the user sees
// "تم إلغاء تسجيل الدخول" instead of the technical "missing_hash".
authProviderPublicRouter.get("/telegram/callback", async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Telegram never appends `?error=` itself — but if a relay or
    // proxy injected one, forward it transparently.
    if (typeof query.error === "string" && query.error) {
      return res.redirect(`/login?error=${encodeURIComponent(query.error)}`);
    }

    // Empty / cancelled redirect: no signed payload at all.
    if (!query.hash && !query.auth_date) {
      return res.redirect("/login?error=cancelled");
    }

    const { ref, ...rest } = query;
    const payload: Record<string, unknown> = { ...rest };
    if (ref) payload.referralCode = ref;

    const result = await handleTelegramAuth(payload, getClientInfo(req));
    if (!result.ok) {
      return res.redirect(`/login?error=${encodeURIComponent(result.reason)}`);
    }
    // Set httpOnly cookie so the session survives page refresh. The
    // browser carries this cookie on the 302 to /auth/callback and on
    // every subsequent request. Same config as the Firebase session
    // route. The URL token in the redirect is kept for backward
    // compatibility but is no longer the only persistence mechanism.
    res.cookie("auth_token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    return res.redirect(`/auth/callback?token=${encodeURIComponent(result.token)}`);
  } catch (err) {
    Sentry.captureException(err);
    return res.redirect("/login?error=server_error");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTER  (mount at /admin/settings in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const authProviderAdminRouter = Router();

// GET /api/admin/settings/auth
authProviderAdminRouter.get("/auth", requireAdmin, async (_req, res) => {
  const settingsMap = await getAllAuthSettings();

  const providers = PROVIDERS.map((meta) => {
    const config = settingsMap.get(`auth.${meta.id}`) ?? {};
    return {
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      auth_type: meta.auth_type,
      description: meta.description,
      setup_url: meta.setup_url,
      fields: meta.fields,
      enabled: !!config.enabled,
      config: buildMaskedConfig(meta, config),
    };
  });

  return res.json({ providers });
});

// PATCH /api/admin/settings/auth/:id
authProviderAdminRouter.patch("/auth/:id", requireAdmin, async (req, res) => {
  const meta = PROVIDERS.find((p) => p.id === stringParam(req, "id"));
  if (!meta) return res.status(404).json(createErrorResponse("مزود غير موجود", ErrorCode.NOT_FOUND));

  const key = `auth.${meta.id}`;
  const existing = await getSetting(key);
  const { enabled, ...incoming } = req.body ?? {};

  const updated: Record<string, any> = { ...existing };
  if (typeof enabled === "boolean") updated.enabled = enabled;

  for (const field of meta.fields) {
    const val = incoming[field.key];
    if (val === undefined) continue;
    if (field.isSecret && (val === "[SET]" || val === "")) continue;
    updated[field.key] = String(val).trim();
  }

  await upsertSetting(key, updated);

  return res.json({
    id: meta.id,
    enabled: !!updated.enabled,
    config: buildMaskedConfig(meta, updated),
  });
});
