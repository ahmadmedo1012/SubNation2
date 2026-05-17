/**
 * Auth Provider Settings Routes
 *
 * Public (mount at /auth):
 *   GET  /providers          → /api/auth/providers
 *   GET  /github             → start GitHub OAuth
 *   GET  /github/callback    → GitHub OAuth callback
 *   GET  /facebook           → start Facebook OAuth
 *   GET  /facebook/callback  → Facebook OAuth callback
 *   POST /telegram           → verify Telegram widget data (callback mode)
 *   GET  /telegram/callback  → verify Telegram widget data (redirect mode,
 *                              for mobile / in-app browsers where popups
 *                              + cross-window postMessage are blocked)
 *
 * Admin (mount at /admin/settings):
 *   GET   /auth              → list all providers (masked secrets)
 *   PATCH /auth/:id          → update provider config
 */

import { db, referralEventsTable, usersTable } from "@workspace/db";
import * as Sentry from "@sentry/node";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { generateReferralCode } from "../lib/crypto";
import { stringParam } from "../lib/http";
import { signUserToken } from "../lib/jwt";
import { logAuthActivity, getClientInfo } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { getRedisClient } from "../lib/redis-client";
import { requireAdmin } from "../middlewares/requireAdmin";

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
    id: "github",
    label: "GitHub",
    color: "#24292e",
    icon: "github",
    auth_type: "oauth_redirect",
    description: "تسجيل الدخول عبر GitHub OAuth 2.0",
    setup_url: "https://github.com/settings/developers",
    fields: [
      { key: "client_id", label: "Client ID", isSecret: false, placeholder: "Ov23liXXXXXXXXXX" },
      {
        key: "client_secret",
        label: "Client Secret",
        isSecret: true,
        placeholder: "a1b2c3d4e5f6...",
      },
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    color: "#1877F2",
    icon: "facebook",
    auth_type: "oauth_redirect",
    description: "تسجيل الدخول عبر Facebook Login OAuth 2.0",
    setup_url: "https://developers.facebook.com/apps",
    fields: [
      { key: "app_id", label: "App ID", isSecret: false, placeholder: "1234567890123456" },
      { key: "app_secret", label: "App Secret", isSecret: true, placeholder: "abc123def456..." },
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

function getAppUrl(): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }

  const port = process.env.PORT ?? process.env.API_PORT ?? "8080";
  return `http://127.0.0.1:${port}`;
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
    };
  }).filter((p) => p.enabled && p.has_config);

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
      });
    }
  }

  return res.json({ providers });
});

// GET /api/auth/github  — redirect to GitHub
authProviderPublicRouter.get("/github", async (_req, res) => {
  const config = await getSetting("auth.github");
  if (!config.enabled || !config.client_id) {
    return res.redirect("/?auth_error=provider_disabled");
  }
  const callbackUrl = `${getAppUrl()}/api/auth/github/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.client_id);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  return res.redirect(url.toString());
});

// GET /api/auth/github/callback
authProviderPublicRouter.get("/github/callback", async (req, res) => {
  const { code } = req.query as { code?: string };
  if (!code) return res.redirect("/?auth_error=missing_code");

  const config = await getSetting("auth.github");
  if (!config.enabled || !config.client_id || !config.client_secret) {
    return res.redirect("/?auth_error=provider_disabled");
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.client_id,
        client_secret: config.client_secret,
        code,
      }),
    });
    const { access_token } = (await tokenRes.json()) as any;
    if (!access_token) return res.redirect("/?auth_error=token_failed");

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    const ghUser = (await userRes.json()) as any;
    if (!ghUser.id) return res.redirect("/?auth_error=user_failed");

    const githubId = String(ghUser.id);
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.githubId, githubId))
      .limit(1);
    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({
          phone: `gh_${githubId}`,
          passwordHash: "",
          githubId,
          referralCode: generateReferralCode(),
          walletBalance: "0.00",
        })
        .returning();
    }

    const token = signUserToken({ userId: user.id });
    return res.redirect(`/auth/callback?token=${encodeURIComponent(token)}`);
  } catch {
    return res.redirect("/?auth_error=server_error");
  }
});

// GET /api/auth/facebook  — redirect to Facebook
authProviderPublicRouter.get("/facebook", async (_req, res) => {
  const config = await getSetting("auth.facebook");
  if (!config.enabled || !config.app_id) {
    return res.redirect("/?auth_error=provider_disabled");
  }
  const callbackUrl = `${getAppUrl()}/api/auth/facebook/callback`;
  const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  url.searchParams.set("client_id", config.app_id);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", "email,public_profile");
  return res.redirect(url.toString());
});

// GET /api/auth/facebook/callback
authProviderPublicRouter.get("/facebook/callback", async (req, res) => {
  const { code } = req.query as { code?: string };
  if (!code) return res.redirect("/?auth_error=missing_code");

  const config = await getSetting("auth.facebook");
  if (!config.enabled || !config.app_id || !config.app_secret) {
    return res.redirect("/?auth_error=provider_disabled");
  }

  try {
    const callbackUrl = `${getAppUrl()}/api/auth/facebook/callback`;
    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", config.app_id);
    tokenUrl.searchParams.set("client_secret", config.app_secret);
    tokenUrl.searchParams.set("redirect_uri", callbackUrl);
    tokenUrl.searchParams.set("code", String(code));

    const { access_token } = (await (await fetch(tokenUrl.toString())).json()) as any;
    if (!access_token) return res.redirect("/?auth_error=token_failed");

    const fbUser = (await (
      await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`)
    ).json()) as any;
    if (!fbUser.id) return res.redirect("/?auth_error=user_failed");

    const fbId = String(fbUser.id);
    let [user] = await db.select().from(usersTable).where(eq(usersTable.facebookId, fbId)).limit(1);
    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({
          phone: `fb_${fbId}`,
          passwordHash: "",
          facebookId: fbId,
          referralCode: generateReferralCode(),
          walletBalance: "0.00",
        })
        .returning();
    }

    const token = signUserToken({ userId: user.id });
    return res.redirect(`/auth/callback?token=${encodeURIComponent(token)}`);
  } catch {
    return res.redirect("/?auth_error=server_error");
  }
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

const TELEGRAM_AUTH_FRESHNESS_SEC = 30 * 60; // 30 minutes — tight window
const TELEGRAM_REPLAY_TTL_SEC = TELEGRAM_AUTH_FRESHNESS_SEC; // mirror freshness

interface TelegramAuthFields {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

/**
 * Verify the Telegram widget payload against the bot token using the
 * exact algorithm in https://core.telegram.org/widgets/login#checking-authorization.
 *
 * Returns `{ ok: true, fields }` on success or `{ ok: false, reason }`
 * with a stable string code that maps to the user-facing error / metric
 * label. The `reason` is logged server-side but the user only ever sees
 * a localised generic message.
 */
function verifyTelegramAuth(
  data: Record<string, unknown>,
  botToken: string,
):
  | { ok: true; fields: TelegramAuthFields }
  | { ok: false; reason: "missing_hash" | "missing_id" | "bad_signature" | "stale_auth_date" } {
  if (!data || typeof data !== "object") return { ok: false, reason: "missing_hash" };
  const hash = typeof data.hash === "string" ? data.hash : "";
  if (!hash) return { ok: false, reason: "missing_hash" };
  if (data.id === undefined || data.id === null || data.id === "") {
    return { ok: false, reason: "missing_id" };
  }

  // Build the data-check string per spec: every key (excluding hash),
  // sorted alphabetically, joined as `key=value\n…`.
  const entries: string[] = [];
  for (const key of Object.keys(data).sort()) {
    if (key === "hash" || key === "referralCode") continue;
    const value = data[key];
    if (value === undefined || value === null) continue;
    entries.push(`${key}=${String(value)}`);
  }
  const checkString = entries.join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  let valid = false;
  try {
    const got = Buffer.from(hash, "hex");
    const want = Buffer.from(expected, "hex");
    if (got.length === want.length) valid = timingSafeEqual(got, want);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  // Auth-date freshness — Telegram's official sample uses 86400s (1 day).
  // We use 30 minutes since this is a federated session bootstrap (the
  // user is in front of their device right now) — the tighter window
  // reduces replay surface significantly with no UX cost.
  const authDate = parseInt(String(data.auth_date ?? "0"), 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: "stale_auth_date" };
  }
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > TELEGRAM_AUTH_FRESHNESS_SEC) {
    return { ok: false, reason: "stale_auth_date" };
  }

  return {
    ok: true,
    fields: {
      id: String(data.id),
      first_name: typeof data.first_name === "string" ? data.first_name : undefined,
      last_name: typeof data.last_name === "string" ? data.last_name : undefined,
      username: typeof data.username === "string" ? data.username : undefined,
      photo_url: typeof data.photo_url === "string" ? data.photo_url : undefined,
      auth_date: String(authDate),
      hash,
    },
  };
}

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
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, tgId))
    .limit(1);
  if (existing) {
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
      passwordHash: "",
      telegramId: tgId,
      displayName: displayName || undefined,
      photoUrl: fields.photo_url ?? undefined,
      authProvider: "telegram",
      passwordLoginEnabled: false,
      referralCode: generateReferralCode(),
      referredBy: referredById,
      walletBalance: referredById ? "5.00" : "0.00",
      lastAuthAt: new Date(),
    })
    .returning();

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
    }).catch(() => {});
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
    }).catch(() => {});
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
  }).catch(() => {});

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

// POST /api/auth/telegram (callback mode — desktop)
authProviderPublicRouter.post("/telegram", async (req, res) => {
  try {
    const result = await handleTelegramAuth(
      (req.body as Record<string, unknown>) ?? {},
      getClientInfo(req),
    );
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ token: result.token, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-auth] internal error",
    );
    return res.status(500).json({ error: "حدث خطأ، حاول مجدداً" });
  }
});

// GET /api/auth/telegram/callback (redirect mode — mobile / in-app browsers)
//
// Telegram redirects here when the widget's `data-auth-url` attribute
// is set. We verify exactly the same payload as POST mode, then 302
// the user to /auth/callback?token=… (the existing AuthCallbackPage
// stores the JWT and lands them on /). On failure we 302 to /login
// with an error code.
authProviderPublicRouter.get("/telegram/callback", async (req, res) => {
  try {
    const { ref, ...query } = req.query as Record<string, string>;
    const payload: Record<string, unknown> = { ...query };
    if (ref) payload.referralCode = ref;

    const result = await handleTelegramAuth(payload, getClientInfo(req));
    if (!result.ok) {
      return res.redirect(`/login?error=${encodeURIComponent(result.reason)}`);
    }
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
  if (!meta) return res.status(404).json({ error: "مزود غير موجود" });

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
