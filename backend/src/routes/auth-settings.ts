/**
 * Auth Provider Settings Routes
 *
 * Public (mount at /auth):
 *   GET  /providers          → /api/auth/providers
 *   GET  /github             → start GitHub OAuth
 *   GET  /github/callback    → GitHub OAuth callback
 *   GET  /facebook           → start Facebook OAuth
 *   GET  /facebook/callback  → Facebook OAuth callback
 *   POST /telegram           → verify Telegram widget data
 *
 * Admin (mount at /admin/settings):
 *   GET   /auth              → list all providers (masked secrets)
 *   PATCH /auth/:id          → update provider config
 */

import { Router } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signUserToken } from "../lib/jwt";
import { generateReferralCode } from "../lib/crypto";
import { stringParam } from "../lib/http";
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
    description: "تسجيل الدخول عبر Google Identity Services (One Tap + Popup)",
    setup_url: "https://console.cloud.google.com/apis/credentials",
    fields: [
      { key: "client_id",     label: "Client ID",     isSecret: false, placeholder: "123456789.apps.googleusercontent.com" },
      { key: "client_secret", label: "Client Secret", isSecret: true,  placeholder: "GOCSPX-..." },
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
      { key: "client_id",     label: "Client ID",     isSecret: false, placeholder: "Ov23liXXXXXXXXXX" },
      { key: "client_secret", label: "Client Secret", isSecret: true,  placeholder: "a1b2c3d4e5f6..." },
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
      { key: "app_id",     label: "App ID",     isSecret: false, placeholder: "1234567890123456" },
      { key: "app_secret", label: "App Secret", isSecret: true,  placeholder: "abc123def456..." },
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
      { key: "bot_username", label: "اسم البوت", isSecret: false, placeholder: "MyAppBot (بدون @)" },
      { key: "bot_token",    label: "Bot Token",  isSecret: true,  placeholder: "1234567890:ABC-DEF..." },
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
      { key: "client_id",   label: "Services ID (Bundle ID)", isSecret: false, placeholder: "com.yourapp.signin" },
      { key: "team_id",     label: "Team ID",                  isSecret: false, placeholder: "ABCD1234EF" },
      { key: "key_id",      label: "Key ID",                   isSecret: false, placeholder: "ABCDE12345" },
      { key: "private_key", label: "Private Key (.p8)",        isSecret: true,  placeholder: "-----BEGIN PRIVATE KEY-----\n..." },
    ],
  },
];

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<Record<string, any>> {
  const result = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${key} LIMIT 1`);
  const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
  const row = rows[0] as any;
  if (!row?.value) return {};
  try { return JSON.parse(String(row.value)); } catch { return {}; }
}

async function getAllAuthSettings(): Promise<Map<string, Record<string, any>>> {
  const result = await db.execute(sql`SELECT key, value FROM system_settings WHERE key LIKE 'auth.%'`);
  const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
  const map = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const r = row as any;
    try { map.set(r.key, JSON.parse(String(r.value ?? "{}"))); } catch { map.set(r.key, {}); }
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

function buildMaskedConfig(meta: ProviderMeta, config: Record<string, any>): Record<string, string> {
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

  const providers = PROVIDERS
    .map(meta => {
      const cfg = meta.id === "google" ? googleConfig : (settingsMap.get(`auth.${meta.id}`) ?? {});
      const enabled = !!cfg.enabled;
      // "has_config" = at least one non-secret public field is filled
      const hasConfig = meta.fields.some(f => !f.isSecret && !!cfg[f.key]);
      return {
        id:           meta.id,
        label:        meta.label,
        color:        meta.color,
        icon:         meta.icon,
        auth_type:    meta.auth_type,
        enabled,
        has_config:   hasConfig,
        // non-secret fields only
        client_id:    cfg.client_id ?? null,
        app_id:       cfg.app_id ?? null,
        bot_username: cfg.bot_username ?? null,
      };
    })
    .filter(p => p.enabled && p.has_config);

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
      body: JSON.stringify({ client_id: config.client_id, client_secret: config.client_secret, code }),
    });
    const { access_token } = await tokenRes.json() as any;
    if (!access_token) return res.redirect("/?auth_error=token_failed");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.github.v3+json" },
    });
    const ghUser = await userRes.json() as any;
    if (!ghUser.id) return res.redirect("/?auth_error=user_failed");

    const githubId = String(ghUser.id);
    let [user] = await db.select().from(usersTable).where(eq(usersTable.githubId, githubId)).limit(1);
    if (!user) {
      [user] = await db.insert(usersTable).values({
        phone: `gh_${githubId}`,
        passwordHash: "",
        githubId,
        referralCode: generateReferralCode(),
        walletBalance: "0.00",
      }).returning();
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

    const { access_token } = await (await fetch(tokenUrl.toString())).json() as any;
    if (!access_token) return res.redirect("/?auth_error=token_failed");

    const fbUser = await (await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`
    )).json() as any;
    if (!fbUser.id) return res.redirect("/?auth_error=user_failed");

    const fbId = String(fbUser.id);
    let [user] = await db.select().from(usersTable).where(eq(usersTable.facebookId, fbId)).limit(1);
    if (!user) {
      [user] = await db.insert(usersTable).values({
        phone: `fb_${fbId}`,
        passwordHash: "",
        facebookId: fbId,
        referralCode: generateReferralCode(),
        walletBalance: "0.00",
      }).returning();
    }

    const token = signUserToken({ userId: user.id });
    return res.redirect(`/auth/callback?token=${encodeURIComponent(token)}`);
  } catch {
    return res.redirect("/?auth_error=server_error");
  }
});

// POST /api/auth/telegram
authProviderPublicRouter.post("/telegram", async (req, res) => {
  const config = await getSetting("auth.telegram");
  if (!config.enabled || !config.bot_token) {
    return res.status(503).json({ error: "تسجيل الدخول عبر Telegram غير مفعّل" });
  }

  const data = req.body as Record<string, string>;
  const { hash, ...fields } = data;
  if (!hash) return res.status(400).json({ error: "بيانات غير صالحة" });

  const checkString = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
  const secretKey = createHash("sha256").update(config.bot_token).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  let valid = false;
  try { valid = timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expected, "hex")); } catch {}
  if (!valid) return res.status(401).json({ error: "فشل التحقق من Telegram" });

  const authDate = parseInt(fields.auth_date ?? "0");
  if (Date.now() / 1000 - authDate > 3600) {
    return res.status(401).json({ error: "انتهت صلاحية الجلسة، حاول مجدداً" });
  }

  const tgId = String(fields.id);
  let [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId)).limit(1);
  if (!user) {
    [user] = await db.insert(usersTable).values({
      phone: `tg_${tgId}`,
      passwordHash: "",
      telegramId: tgId,
      referralCode: generateReferralCode(),
      walletBalance: "0.00",
    }).returning();
  }

  const token = signUserToken({ userId: user.id });
  return res.json({ token });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTER  (mount at /admin/settings in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const authProviderAdminRouter = Router();

// GET /api/admin/settings/auth
authProviderAdminRouter.get("/auth", requireAdmin, async (_req, res) => {
  const settingsMap = await getAllAuthSettings();

  const providers = PROVIDERS.map(meta => {
    const config = settingsMap.get(`auth.${meta.id}`) ?? {};
    return {
      id:          meta.id,
      label:       meta.label,
      icon:        meta.icon,
      color:       meta.color,
      auth_type:   meta.auth_type,
      description: meta.description,
      setup_url:   meta.setup_url,
      fields:      meta.fields,
      enabled:     !!config.enabled,
      config:      buildMaskedConfig(meta, config),
    };
  });

  return res.json({ providers });
});

// PATCH /api/admin/settings/auth/:id
authProviderAdminRouter.patch("/auth/:id", requireAdmin, async (req, res) => {
  const meta = PROVIDERS.find(p => p.id === stringParam(req, "id"));
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
