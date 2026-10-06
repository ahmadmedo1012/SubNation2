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
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { generateReferralCode } from "../lib/crypto";
import { stringParam } from "../lib/http";
import { createUserSession } from "../lib/session";
import { logAuthActivity, getClientInfo } from "../lib/auth-activity";
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
import { requireAdmin } from "../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import {
  getWhatsAppGatewayReadiness,
  isWhatsAppGatewayConfigured,
} from "../services/openwa.service";
import { getAuthCookieOptions } from "../lib/cookie-options";
import { getConfiguredOrigins } from "../lib/origins";
import { cacheWrap } from "../lib/cache";

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

/**
 * 98-F3 (R98-A4 P3-3 — mirror of R97-02): the raw user JWT is no longer
 * returned in the Telegram mint response bodies (POST /telegram,
 * POST /telegram/webapp). The httpOnly `auth_token` cookie each sets is
 * the sole session transport (requireUser reads the cookie first); the
 * body `token` field is kept as this SENTINEL so the SPA's success-check
 * (`if (!json.token)`) and `setToken(...)` keep working — the value is
 * truthy but carries no credential, and the frontend's auth-token-holder
 * filters it out of Authorization headers by exact string match. Same
 * value the boot probe and the other mint routes use (routes/auth.ts,
 * routes/auth-whatsapp.ts). The redirect-mode GET /telegram/callback
 * already ships no token at all (F-010).
 */
const COOKIE_SESSION_SENTINEL = "__cookie_session__";

// GET /api/auth/providers
const authProviderCache = (_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  next();
};

authProviderPublicRouter.get("/providers", authProviderCache, async (_req, res) => {
  const settingsMap = await cacheWrap("auth:providers:settings", 60, getAllAuthSettings);

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

  // r95 (honest UX): `whatsapp_enabled` stays config-only (backward
  // compat — button visibility). `whatsapp_status` adds the LIVE
  // pairing state from a 30s-cached gateway probe so clients can hint
  // "قيد الربط مؤقتاً" instead of letting the user fail at code-send.
  // Status strings are the OpenWA lifecycle values (ready/qr_ready/…)
  // or null when the probe fails — never a fabricated "ready".
  //
  // 96-F1 (R96-A4 §1.3C): a paired-but-settling session (the post-link
  // settle / warm-up window behind the "Waiting for this message"
  // incident) now reports the dedicated "settling" value so the login
  // hint can tell the truth during the window. Additive — older clients
  // treat it as just another not-"ready" status.
  //
  // 97-F3 (R97-WA-08 contract, verified — NO server-side softening):
  // "failed" (pairing revoked — permanent until an operator re-pairs)
  // and "qr_ready" (pairing pending a scan) are passed through VERBATIM
  // below. The only values this route ever synthesizes are "ready"
  // (settled + warm) and "settling" (inside the gate window); everything
  // else is the raw gateway lifecycle status (or null when the gateway
  // is unreachable). The FRONTEND owns honest per-status copy (agent
  // 97-F5): failed renders «القناة غير مرتبطة حاليًا — استخدم
  // Google/Telegram» instead of the misleading "قيد الربط مؤقتاً" hint —
  // the backend must never hide a dead channel behind "temporary" wording.
  const readiness = await getWhatsAppGatewayReadiness();

  return res.json({
    providers,
    // Boolean only — never exposes the API key. Clients gate the
    // <WhatsAppPhoneSignIn /> render on this flag.
    whatsapp_enabled: isWhatsAppGatewayConfigured(),
    whatsapp_status: readiness.ready ? "ready" : readiness.settling ? "settling" : readiness.status,
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
// The replay-hash store lives in lib/telegram-replay.ts (93-A1 S3) — one
// implementation shared by the widget and Mini App flows, with per-flow
// TTLs that are never shorter than the freshness window they guard and a
// bounded in-memory fallback for the no-Redis production shape.

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
 * grants the referee's WELCOME_BONUS_LYD wallet credit AND the
 * referrer's POINTS_PER_REFERRAL in one transaction
 * (services/topup.service.ts), guarded exactly-once by
 * users.welcome_bonus_granted. Abuse economics: a farmed account must
 * now pass a manually-approved paid topup before any credit lands.
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
      // Round-3 envelope drift fix: `reason` → `code` (keep `reason` for
      // backward compatibility with any client reading the old field).
      return res
        .status(result.status)
        .json({ error: result.error, code: result.reason, reason: result.reason });
    }
    // Set httpOnly cookie so the session survives page refresh. Same
    // config as /api/auth/firebase/session (auth.ts line ~915):
    //   sameSite="lax" — required for cross-site OAuth redirect flows;
    //                    "strict" would drop the cookie on the redirect
    //                    back from oauth.telegram.org.
    //   secure — prod only (Render terminates TLS, browser sees https).
    //   maxAge — 30 days, matches the JWT expiry signed in signUserToken.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    // 98-F3 (see COOKIE_SESSION_SENTINEL above): sentinel, not the JWT —
    // the httpOnly cookie is the sole session transport.
    return res.json({ token: COOKIE_SESSION_SENTINEL, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-auth] internal error",
    );
    return res.status(500).json(
      createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
        reason: "server_error",
      }),
    );
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
      // Round-3 envelope drift fix: `reason` → `code` (old field kept).
      return res
        .status(result.status)
        .json({ error: result.error, code: result.reason, reason: result.reason });
    }
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    // 98-F3 (see COOKIE_SESSION_SENTINEL above): sentinel, not the JWT —
    // the httpOnly cookie is the sole session transport.
    return res.json({ token: COOKIE_SESSION_SENTINEL, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-webapp] internal error",
    );
    return res.status(500).json(
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
// set the auth_token httpOnly cookie and 302 the user to /auth/callback
// (no `?token=` — F-010 / security audit 004; the cookie is the sole
// transport now). On failure we 302 to /login with an error code that
// the LoginPage maps to a localised banner.
//
// Cancellation: when the user dismisses the Telegram auth screen
// (closes the tab, taps "Cancel"), Telegram redirects back to
// return_to with NO auth payload. We detect that empty redirect
// here and surface a dedicated `cancelled` reason so the user sees
// "تم إلغاء تسجيل الدخول" instead of the technical "missing_hash".
//
// ── B1-1 (R111, round-111 B1 audit): login-CSRF same-origin gate ──────
//
// This GET was the only session-MINT endpoint outside the CSRF Origin
// gate (createCsrfGate in app.ts is POST/PUT/DELETE/PATCH-only). The
// Telegram payload is signed with the BOT's key — an attacker can mint
// a validly-signed payload for their OWN Telegram account, host it
// behind an <img>/fetch on any page, and the victim's browser silently
// Set-Cookies an auth_token bound to the ATTACKER's account (the exact
// 98-F3 class: the victim then tops up the attacker's wallet).
//
// Chosen fix — server-side same-origin gate, no frontend change needed:
// the CURRENT frontend never sends a browser here with a payload. The
// TelegramLoginButton sets return_to to the SPA route
// /auth/telegram-callback (frontend/src/pages/telegram-callback.tsx),
// which reads the #tgAuthResult fragment (fragments never reach the
// server) and POSTs the payload to /api/auth/telegram — a POST that is
// already behind the CSRF Origin gate. A payload-bearing GET on THIS
// endpoint therefore has no legitimate browser caller today, and
// gating it same-origin breaks nothing in the product.
//
// Verdict rules (fail closed):
//   - `Sec-Fetch-Site` present → allow ONLY `same-origin`. `cross-site`
//     blocks the <img>/link attack; `same-site` is still cross-ORIGIN
//     for our apex/www pair; `none` is attacker-influenceable via a
//     link pasted in a chat/email (the link-click login-CSRF shape), so
//     it blocks too.
//   - No Sec-Fetch-Site (legacy browser / non-browser client) → fall
//     back to Referer: allow only when the Referer origin is in the
//     configured origin allow-list (exact scheme+host+port match, the
//     same comparison createCsrfGate uses — no string-prefix matches).
//   - Neither header → block. Headerless API clients have no ambient
//     browser authority and no business on a browser-redirect endpoint;
//     the POST /api/auth/telegram JSON transport serves them and is
//     gated by the standard CSRF layer.
//
// Blocked requests redirect to /login?error=csrf_blocked (the
// endpoint's failure envelope family — a redirect, never a mint).
//
// UPGRADE PATH (state nonce — the audit's preferred long-term fix):
// issue a signed `state` nonce when the SPA starts Telegram login
// (sessionStorage + a server-side issuance endpoint or a signed
// short-TTL token), append it to the oauth.telegram.org URL, and
// require + validate it here. That would allow re-opening a
// cross-site redirect transport (return_to pointed at this endpoint)
// safely; until such a client exists, same-origin-only is strictly
// tighter and correct.
const TELEGRAM_CALLBACK_CSRF_ERROR = "csrf_blocked";

/** B1-1: resolve the same allow-list shape app.ts's CSRF gate uses. */
function telegramCallbackAllowedOrigins(): string[] {
  const explicit = process.env.CSRF_ALLOWED_ORIGINS;
  const fromCors = getConfiguredOrigins();
  const raw = explicit ?? (fromCors.length > 0 ? fromCors.join(",") : (process.env.APP_URL ?? ""));
  const parsed = raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  // Non-production fallback mirrors app.ts's dev defaults so local
  // round-trips keep working; production boots fail-fast on an empty
  // CSRF allow-list long before this branch could weaken anything.
  if (process.env.NODE_ENV !== "production") {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }
  return [];
}

/** B1-1: same-origin predicate for the session-mint shape of the callback. */
export function isTelegramCallbackSameOrigin(
  headers: { "sec-fetch-site"?: unknown; referer?: unknown },
  allowedOrigins: string[],
): boolean {
  // Express types header values as string | string[] | undefined — accept
  // any of those and normalize to the first string (browsers never send
  // these as arrays; the normalization is purely type-safe).
  const header = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return null;
  };
  const secFetchSite = header(headers["sec-fetch-site"]);
  if (secFetchSite !== null && secFetchSite.length > 0) {
    return secFetchSite === "same-origin";
  }
  const referer = header(headers["referer"]);
  if (referer !== null && referer.length > 0 && allowedOrigins.length > 0) {
    // Exact-origin comparison only (F-009 discipline): parse both sides
    // and compare protocol+host — never string prefixes.
    return allowedOrigins.some((allowed) => {
      try {
        const r = new URL(referer);
        const a = new URL(allowed);
        return r.protocol === a.protocol && r.host === a.host;
      } catch {
        return false;
      }
    });
  }
  // No modern header AND no Referer (or no allow-list to check against):
  // fail closed — see the verdict rules above.
  return false;
}

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

    // B1-1: from here on the request carries a session-MINT payload —
    // apply the same-origin gate before any verification or cookie write.
    if (!isTelegramCallbackSameOrigin(req.headers, telegramCallbackAllowedOrigins())) {
      logger.warn(
        {
          category: "security",
          audit_finding: "B1-1",
          secFetchSite: req.headers["sec-fetch-site"] ?? null,
          referer: req.headers["referer"] ?? null,
        },
        "[telegram-auth] callback session-mint blocked by same-origin CSRF gate",
      );
      return res.redirect(`/login?error=${encodeURIComponent(TELEGRAM_CALLBACK_CSRF_ERROR)}`);
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
    // route. F-010 (security audit 004): the JWT is NOT also placed in
    // the redirect query string. Putting it there leaked the token into
    // browser history, the Referer header on the next outbound
    // navigation, and any HTTP-access logs along the path. The cookie
    // is the sole transport now; AuthCallbackPage detects the cookie
    // session via the existing /api/auth/probe endpoint.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    return res.redirect("/auth/callback");
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
//
// A5-11 (round-94): the body used to be read raw — `String(val).trim()`
// stored "[object Object]" for an object-valued bot_token, there was no
// length bound (up to the 1 MB JSON limit), and the route had no audit
// row despite flipping provider enablement + credentials. Values are
// schema-validated per provider field now (strings, bounded), and every
// write is audited (secret values are never logged — keys only).
const MAX_PROVIDER_FIELD_LENGTH: Record<string, number> = {
  // A .p8 private key is multi-line PEM (~1.7 KB); everything else is a
  // short token/identifier.
  private_key: 4000,
};

function providerFieldSchema(field: ProviderField): z.ZodString {
  const max = MAX_PROVIDER_FIELD_LENGTH[field.key] ?? 500;
  return z.string().trim().min(1).max(max);
}

function buildProviderPatchSchema(meta: ProviderMeta) {
  const shape: Record<string, z.ZodTypeAny> = { enabled: z.boolean().optional() };
  for (const field of meta.fields) {
    shape[field.key] = providerFieldSchema(field);
  }
  return z.object(shape).strict();
}

authProviderAdminRouter.patch("/auth/:id", requireAdmin, async (req, res) => {
  const meta = PROVIDERS.find((p) => p.id === stringParam(req, "id"));
  if (!meta)
    return res.status(404).json(createErrorResponse("مزود غير موجود", ErrorCode.NOT_FOUND));

  const parse = buildProviderPatchSchema(meta).safeParse(req.body ?? {});
  if (!parse.success) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "قيمة غير صالحة لإعدادات المزوّد (نصوص فقط ضمن الحدود المسموحة)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const { enabled, ...incoming } = parse.data;

  const key = `auth.${meta.id}`;
  const existing = await getSetting(key);

  const updated: Record<string, any> = { ...existing };
  if (typeof enabled === "boolean") updated.enabled = enabled;

  const changedFields: string[] = [];
  for (const field of meta.fields) {
    const val = incoming[field.key];
    if (val === undefined) continue;
    if (field.isSecret && (val === "[SET]" || val === "")) continue;
    updated[field.key] = val;
    changedFields.push(field.key);
  }

  await upsertSetting(key, updated);

  void writeAuditLog(req, "settings.auth_provider.update", "settings", null, {
    provider: meta.id,
    enabled: !!updated.enabled,
    // Keys only — secret VALUES (bot_token / private_key) never enter the
    // audit trail; "[SET]" markers are skipped client-side already.
    fields_changed: changedFields,
  });

  return res.json({
    id: meta.id,
    enabled: !!updated.enabled,
    config: buildMaskedConfig(meta, updated),
  });
});
