import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";

/**
 * SEC-92-01 (round-92 B1 security audit) — CSRF Origin gate.
 *
 * Production cookies ship SameSite=None, so the Origin/Referer gate built
 * by createCsrfGate() is the ONLY CSRF barrier for cookie-authenticated
 * state-changing requests. This suite pins the three fixes:
 *
 *   1. FAIL CLOSED: production + empty allow-list + auth cookie + POST →
 *      403 {code:"CSRF_CONFIG"} (previously log-and-continue).
 *   2. No-Origin form attacks: auth cookie + NEITHER Origin NOR Referer →
 *      403 even when the allow-list is configured.
 *   3. Boot-time fail-fast: importing app.ts with NODE_ENV=production and
 *      an empty origins set throws (same posture as SESSION_SECRET).
 *
 * The gate is tested through the exported factory (the exact function
 * app.ts mounts) on a mini express app, plus two integration cases
 * against the real app object (dev-mode allow-list).
 *
 * Env note: lib/encryption.ts (imported by the app route tree) throws
 * without ENCRYPTION_KEY, so a throwaway test value is set before the
 * dynamic import. ADMIN_JWT_SECRET intentionally left unset in test mode
 * (lib/jwt.ts derives it with a loud warning — non-prod fallback).
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

type AppModule = typeof import("../app");
let appModule: AppModule;
let realApp: Express;

beforeAll(async () => {
  appModule = await import("../app");
  realApp = appModule.default;
}, 60_000);

afterAll(() => {
  vi.restoreAllMocks();
});

// ── Mini-app harness ────────────────────────────────────────────────────────

function buildGateApp(allowedOrigins: string[], production: boolean): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(appModule.createCsrfGate(allowedOrigins, production));
  // Downstream stand-in: anything the gate lets through "reaches the route".
  app.use((_req, res) => {
    res.status(200).json({ reached: true });
  });
  return app;
}

interface GateRequest {
  method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET";
  path: string;
  cookie?: string;
  origin?: string;
  referer?: string;
}

async function fire(app: Express, r: GateRequest): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (r.cookie) headers.Cookie = r.cookie;
        if (r.origin) headers.Origin = r.origin;
        if (r.referer) headers.Referer = r.referer;
        const res = await fetch(`http://127.0.0.1:${addr.port}${r.path}`, {
          method: r.method,
          headers,
          body: r.method === "GET" ? undefined : "{}",
        });
        const text = await res.text();
        let parsed: unknown = null;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }
        resolve({ status: res.status, body: parsed });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

// ── 1) Fail-closed branch ───────────────────────────────────────────────────

describe("SEC-92-01 (1): production + empty allow-list fails CLOSED for cookie-authenticated writes", () => {
  const PROD_NO_ORIGINS = () => buildGateApp([], true);

  it("403 CSRF_CONFIG for auth_token cookie + POST", async () => {
    const res = await fire(PROD_NO_ORIGINS(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_CONFIG" });
  });

  it("403 CSRF_CONFIG for admin_token cookie + POST (no Origin/Referer — form-POST shape)", async () => {
    const res = await fire(PROD_NO_ORIGINS(), {
      method: "POST",
      path: "/api/admin/topups/5/approve",
      cookie: "admin_token=some-admin-jwt",
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_CONFIG" });
  });

  it("403 CSRF_CONFIG even when a (bogus) Origin is present — allow-list is empty, nothing can validate against", async () => {
    const res = await fire(PROD_NO_ORIGINS(), {
      method: "POST",
      path: "/api/wallet/topups",
      cookie: "auth_token=some-jwt",
      origin: "https://subnation.ly",
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_CONFIG" });
  });

  it("requests WITHOUT an auth cookie pass (no ambient authority; credentials still required at the route)", async () => {
    const res = await fire(PROD_NO_ORIGINS(), { method: "POST", path: "/api/orders" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it("GET requests are not state-changing — pass with a cookie even with no allow-list", async () => {
    const res = await fire(PROD_NO_ORIGINS(), {
      method: "GET",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
    });
    expect(res.status).toBe(200);
  });

  it("dev (non-production) + empty allow-list still passes cookies through (unchanged dev posture)", async () => {
    const res = await fire(buildGateApp([], false), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });
});

// ── 2) No-Origin form attacks with a CONFIGURED allow-list ─────────────────

describe("SEC-92-01 (2): cookie-authenticated writes with neither Origin nor Referer", () => {
  const ORIGINS = ["https://subnation.ly", "https://www.subnation.ly"];
  const GATE = () => buildGateApp(ORIGINS, true);

  it("auth cookie + POST + no Origin/Referer → 403 (classic no-Origin form POST)", async () => {
    const res = await fire(GATE(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("matching Origin passes", async () => {
    const res = await fire(GATE(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
      origin: "https://subnation.ly",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it("matching Referer (no Origin header) passes", async () => {
    const res = await fire(GATE(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
      referer: "https://subnation.ly/checkout",
    });
    expect(res.status).toBe(200);
  });

  it("attacker Origin → 403", async () => {
    const res = await fire(GATE(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
  });

  it("Origin lookalike subdomain does NOT pass (exact-origin comparison, F-009)", async () => {
    const res = await fire(GATE(), {
      method: "POST",
      path: "/api/orders",
      cookie: "auth_token=some-jwt",
      origin: "https://subnation.ly.evil.com",
    });
    expect(res.status).toBe(403);
  });

  it("PUT/PATCH/DELETE are gated the same way", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const bad = await fire(GATE(), {
        method,
        path: "/api/orders/9",
        cookie: "auth_token=some-jwt",
      });
      expect(bad.status).toBe(403);
      const good = await fire(GATE(), {
        method,
        path: "/api/orders/9",
        cookie: "auth_token=some-jwt",
        origin: "https://www.subnation.ly",
      });
      expect(good.status).toBe(200);
    }
  });
});

// ── Exempt paths keep working headerless ────────────────────────────────────

describe("exempt paths stay exempt (no Origin/Referer required)", () => {
  const GATE = () => buildGateApp(["https://subnation.ly"], true);

  it.each([
    "/api/webhook/telegram",
    "/api/cwv",
    "/api/auth/firebase/session",
    "/api/auth/firebase/refresh",
  ])("%s passes with an auth cookie and no Origin/Referer", async (path) => {
    const res = await fire(GATE(), { method: "POST", path, cookie: "auth_token=some-jwt" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });
});

// ── Real-app integration (dev-mode allow-list from module-load defaults) ────

describe("real app integration (dev origins = localhost set)", () => {
  function listen(app: Express): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("listener address is not AddressInfo"));
          return;
        }
        resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
      });
    });
  }

  it("POST without Origin/Referer → CSRF 403 before any route logic", async () => {
    const { url, close } = await listen(realApp);
    try {
      const res = await fetch(`${url}/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("FORBIDDEN");
    } finally {
      close();
    }
  });

  it("POST with a dev-allowed Origin passes the CSRF gate (route then 401s on auth)", async () => {
    const { url, close } = await listen(realApp);
    try {
      const res = await fetch(`${url}/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
        body: "{}",
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("UNAUTHORIZED");
    } finally {
      close();
    }
  });
});

// ── 3) Boot-time fail-fast ──────────────────────────────────────────────────

describe("SEC-92-01 (3): boot-time assertion", () => {
  const MANAGED_KEYS = [
    "NODE_ENV",
    "CSRF_ALLOWED_ORIGINS",
    "APP_ORIGINS",
    "APP_URL",
    "APP_ORIGIN",
    "FRONTEND_ORIGINS",
    "VERCEL_FRONTEND_ORIGIN",
    "ADMIN_JWT_SECRET",
    "ENCRYPTION_KEY",
  ] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of MANAGED_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  it("importing app.ts in production with an EMPTY origins allow-list throws (fail-fast)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    for (const key of [
      "CSRF_ALLOWED_ORIGINS",
      "APP_ORIGINS",
      "APP_URL",
      "APP_ORIGIN",
      "FRONTEND_ORIGINS",
      "VERCEL_FRONTEND_ORIGIN",
    ]) {
      delete process.env[key];
    }
    // Satisfy the OTHER production fail-fast gates so the CSRF assertion is
    // the one that fires (throwaway values — never real secrets).
    process.env.ADMIN_JWT_SECRET = "ci-throwaway-admin-secret-0123456789abcdef";
    process.env.ENCRYPTION_KEY = "22".repeat(32);

    await expect(import("../app")).rejects.toThrow(/SEC-92-01/);
  }, 60_000);

  it("importing app.ts in production WITH APP_ORIGINS set boots cleanly (assertion is not over-eager)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.APP_ORIGINS = "https://subnation.ly,https://www.subnation.ly";
    delete process.env.CSRF_ALLOWED_ORIGINS;
    delete process.env.APP_URL;
    delete process.env.FRONTEND_ORIGINS;
    delete process.env.VERCEL_FRONTEND_ORIGIN;
    process.env.ADMIN_JWT_SECRET = "ci-throwaway-admin-secret-0123456789abcdef";
    process.env.ENCRYPTION_KEY = "22".repeat(32);

    const mod = (await import("../app")) as AppModule;
    expect(mod.default).toBeTruthy();
    expect(typeof mod.createCsrfGate).toBe("function");
  }, 60_000);
});
