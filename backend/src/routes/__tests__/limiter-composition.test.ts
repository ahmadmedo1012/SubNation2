import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";

/**
 * 98-F3 (R98-A1 P1-1) — authLimiter double-mount composition guard.
 *
 * app.ts used to mount the SAME `authLimiter` INSTANCE twice on
 * overlapping prefixes:
 *
 *   app.use("/api/admin/login", authLimiter);
 *   app.use("/api/admin/login/verify-2fa", authLimiter);   // prefix overlap!
 *   app.use("/api/auth/telegram", authLimiter);
 *   app.use("/api/auth/telegram/callback", authLimiter);   // prefix overlap!
 *
 * `app.use(path, mw)` is a PREFIX match, so a request to
 * /api/admin/login/verify-2fa ran the limiter TWICE (both mounts match),
 * incrementing the same key twice per request — silently HALVING the
 * real login budget (verified: 1 request → used=2; a 10/15min budget
 * acted as 5/15min). Two audit claims were EXPERIMENTALLY DISPROVEN
 * against express-rate-limit 8.4.1: (1) no hard 500 — the library's
 * validation wrapper CATCHES validation errors and logs them without
 * re-throwing; (2) not even a logged ERR_ERL_DOUBLE_COUNT — the
 * middleware calls validations.disable() at the end of every invocation
 * (dist line ~974), so by the time the SECOND mount's wrapper runs, all
 * validations are off. The double budget burn is the ONLY observable
 * defect. No test imported the full app, so CI was blind to the
 * composition bug.
 *
 * These tests pin the fix from BOTH sides:
 *
 *   1. REAL-APP composition (imports the actual `app` from app.ts, same
 *      harness as csrf-gate.test.ts): POST /api/admin/login/verify-2fa
 *      must answer 401 (bad temp token — NEVER 500), and GET
 *      /api/auth/telegram/callback must answer a redirect (NEVER 500).
 *
 *   2. MINIMAL repro of the library invariant: mounting one limiter
 *      instance on overlapping prefixes DOUBLE-BURNS the budget — one
 *      request against a limit of 2 exhausts it (the very next request
 *      429s). Control case: a single mount burns exactly ONE hit per
 *      request (3 requests against a limit of 2 → 200, 200, 429).
 *
 * Env note: lib/encryption.ts (imported by the app route tree) throws
 * without ENCRYPTION_KEY; src/test/env.ts already sets synthetic values
 * (same bootstrap csrf-gate.test.ts relies on). No REDIS_URL → every
 * limiter resolves express-rate-limit's default MemoryStore, exactly
 * like the production no-Redis path.
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

type AppModule = typeof import("../../app");
let appModule: AppModule;
let realApp: Express;

beforeAll(async () => {
  appModule = await import("../../app");
  realApp = appModule.default;
}, 60_000);

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

describe("98-F3 — real-app limiter composition (the P1 500s)", () => {
  it("POST /api/admin/login/verify-2fa → 401 (invalid temp token), NEVER 500", async () => {
    const { url, close } = await listen(realApp);
    try {
      const res = await fetch(`${url}/api/admin/login/verify-2fa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Dev-mode allow-list origin so the CSRF gate lets the request
          // through to the limiter (the layer under test).
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ temp_token: "garbage-not-a-jwt", code: "123456" }),
      });
      // A garbage temp token fails jwt.verify inside the handler → the
      // route's catch → 401. With the double-mount bug the request 500'd
      // in the limiter BEFORE the handler ever ran.
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(500);
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      expect(body?.code).toBe("UNAUTHORIZED");
    } finally {
      close();
    }
  });

  it("GET /api/auth/telegram/callback?hash=x → 302 redirect (or 400), NEVER 500", async () => {
    const { url, close } = await listen(realApp);
    try {
      const res = await fetch(`${url}/api/auth/telegram/callback?hash=x&auth_date=123`, {
        redirect: "manual",
      });
      // The handler maps verification failure to a redirect to /login
      // (or a 400 on payload shape) — never a 500: with the double-mount
      // bug the request 500'd in the limiter BEFORE the handler ran,
      // breaking the Telegram redirect-mode login on every attempt.
      expect(res.status).not.toBe(500);
      expect([302, 400]).toContain(res.status);
      if (res.status === 302) {
        expect(res.headers.get("location")).toContain("/login");
      }
    } finally {
      close();
    }
  });
});

describe("98-F3 — library invariant: one limiter instance, overlapping prefixes (minimal repro)", () => {
  /** Records what a custom validation logger saw + answers 500 like the global handler. */
  function buildCapturingApp(mount: (app: Express) => void): {
    app: Express;
    logged: unknown[];
  } {
    const logged: unknown[] = [];
    const app = express();
    app.use(express.json());
    mount(app);
    app.post("/api/admin/login/verify-2fa", (_req, res) => {
      res.status(200).json({ reached: true });
    });
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      logged.push({ err });
      res.status(500).json({ error: "INTERNAL_ERROR" });
    });
    return { app, logged };
  }

  it("SAME instance double-mounted on overlapping prefixes: budget DOUBLE-BURNS (one caller exhausts a limit of 2)", async () => {
    // The EXACT historical mount shape from app.ts (pre-98-F3).
    // Fully verified behavior of express-rate-limit 8.4.1 for this
    // pattern: both mounts increment the same store key — a limit of 2
    // is exhausted by ONE request (r1 200, r2 429). The library's
    // ERR_ERL_DOUBLE_COUNT detection never fires here (validations are
    // disabled at the end of the first invocation, before the second
    // mount's wrapper runs — see the file header), and no 500 is ever
    // produced. The budget burn is the entire user-visible defect.
    const limiter = rateLimit({
      windowMs: 60_000,
      limit: 2,
      message: { error: "rate-limited", code: "RATE_LIMITED" },
    });
    const { app } = buildCapturingApp((a) => {
      a.use("/api/admin/login", limiter);
      a.use("/api/admin/login/verify-2fa", limiter); // overlapping prefix — the bug
    });

    const { url, close } = await listen(app);
    try {
      // First request: passes — but consumed BOTH hits (used=2).
      const first = await fetch(`${url}/api/admin/login/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(first.status).toBe(200);
      // Second request: already exhausted by ONE caller — the halved-budget
      // defect in its only observable form. (Single mount below admits
      // TWO requests with the same limit.)
      const second = await fetch(`${url}/api/admin/login/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(second.status).toBe(429);
    } finally {
      close();
    }
  });

  it("SINGLE prefix mount: budget burns exactly ONCE per request (3 requests vs limit 2 → 200, 200, 429)", async () => {
    // The post-fix shape (app.ts now mounts "/api/admin/login" alone —
    // the prefix covers the subpath). A limit of 2 with single counting
    // admits exactly two requests; the double-burn repro above admits
    // only ONE — that contrast is the regression guard.
    const limiter = rateLimit({
      windowMs: 60_000,
      limit: 2,
      message: { error: "rate-limited", code: "RATE_LIMITED" },
    });
    const { app, logged } = buildCapturingApp((a) => {
      a.use("/api/admin/login", limiter); // single mount — prefix covers subpaths
    });

    const { url, close } = await listen(app);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await fetch(`${url}/api/admin/login/verify-2fa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect(logged).toHaveLength(0);
    } finally {
      close();
    }
  });
});
