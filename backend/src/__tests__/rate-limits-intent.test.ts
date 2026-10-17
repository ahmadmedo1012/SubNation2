import { readFileSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import { describe, expect, it } from "vitest";
import {
  loyaltyConvertPointsLimiter,
  ordersCreateLimiter,
  ticketCreateLimiter,
  ticketReplyLimiter,
  walletTopupCreateLimiter,
} from "../lib/rate-limits";
import { signUserToken, verifyUserToken } from "../lib/jwt";
import type { AuthenticatedRequest } from "../middlewares/requireUser";

/**
 * R136 (SEC scan F1) — money-submission intent limiters.
 *
 * POST /api/orders, POST /api/wallet/topups and POST /api/loyalty/
 * convert-points used to ride ONLY the generic userLimiter (1200/min/
 * user). The three limiters in lib/rate-limits.ts now give each a tight
 * 12/min PER-USER budget, modeled on the couponValidateLimiter contract:
 *
 *   - window/limit pinned via the draft-8 `RateLimit-Policy` header
 *     ("12-in-1min"; q=12; w=60) — express-rate-limit 8.4.1's default
 *     identifier encodes the limit+window, so the header IS the pin;
 *   - per-user keying: two signed auth_tokens with different userIds
 *     burn SEPARATE buckets (a fresh user keeps remaining=11 after the
 *     first user exhausted theirs);
 *   - anonymous fallback: cookie-less callers share ONE ip-keyed bucket
 *     (the SEC-92-04 ipKeyGenerator path);
 *   - POST-only intent: the prefix mounts also see the GET reads
 *     (order-status polling), so non-POST requests are skipped and stay
 *     200 even after the submission budget is exhausted;
 *   - 429 shape: the Arabic JSON body + RATE_LIMITED code, identical to
 *     every other limiter in the family.
 *
 * The mount composition (path-specific, BEFORE the generic /api
 * limiters) is pinned against app.ts's source the same way the
 * r125/r128/a4-f1 umbrella tests read surfaces — no app boot needed.
 *
 * Env note: src/test/env.ts sets SESSION_SECRET, so signUserToken +
 * verifyUserToken (inside the limiters' getRequestUserId) round-trip
 * with the same secret. No REDIS_URL → MemoryStore, exactly like every
 * other limiter test.
 */

type Limiter = ReturnType<typeof rateLimit>;

function buildLimiterApp(limiter: Limiter): Express {
  const app = express();
  app.use(cookieParser());
  app.use(limiter);
  // Downstream stand-in: anything the limiter lets through "reaches the route".
  app.use((_req, res) => {
    res.status(200).json({ reached: true });
  });
  return app;
}

/**
 * R158 (B#6): the ticket limiters read `req.userId` (in production
 * requireUser has already run BEFORE the limiter mounts). The stand-in
 * decodes the same signed auth_token the suite signs, mirroring that
 * ordering — the cookie→userId mapping the per-user key rides on.
 */
function buildTicketLimiterApp(limiter: Limiter): Express {
  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => {
    const token = (req.cookies as Record<string, string | undefined>).auth_token;
    (req as AuthenticatedRequest).userId = token ? (verifyUserToken(token)?.userId ?? 0) : 0;
    next();
  });
  app.use(limiter);
  app.use((_req, res) => {
    res.status(200).json({ reached: true });
  });
  return app;
}

interface IntentResponse {
  status: number;
  body: unknown;
  rateLimitPolicy: string | null;
  rateLimit: string | null;
}

async function fire(
  app: Express,
  method: "POST" | "GET",
  cookie?: string,
): Promise<IntentResponse> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const headers: Record<string, string> = {};
        if (cookie) headers.Cookie = cookie;
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/orders`, {
          method,
          headers,
          body: method === "POST" ? "{}" : undefined,
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
        resolve({
          status: res.status,
          body: parsed,
          rateLimitPolicy: res.headers.get("ratelimit-policy"),
          rateLimit: res.headers.get("ratelimit"),
        });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

/** `auth_token=<signed JWT>` for a synthetic userId. */
const userCookie = (userId: number): string => `auth_token=${signUserToken({ userId })}`;

/** The draft-8 policy line for a 12-per-60s limiter (default identifier "12-in-1min"). */
const POLICY_12_IN_60 = /^"12-in-1min"; q=12; w=60; pk=:.+:$/;
const RATE_12 = /^"12-in-1min"; r=(\d+); t=\d+$/;

describe("R136 (SEC F1) money-intent limiters — window, budget, 429 shape", () => {
  it("ordersCreateLimiter: 12/min pinned by the draft-8 policy header; the 13th POST 429s with the Arabic RATE_LIMITED body", async () => {
    const app = buildLimiterApp(ordersCreateLimiter);
    const cookie = userCookie(91101);

    const first = await fire(app, "POST", cookie);
    expect(first.status).toBe(200);
    expect(first.rateLimitPolicy).toMatch(POLICY_12_IN_60);
    expect(first.rateLimit).toMatch(RATE_12);
    expect(first.rateLimit).toContain("r=11");

    for (let i = 0; i < 10; i++) {
      const mid = await fire(app, "POST", cookie);
      expect(mid.status).toBe(200);
    }
    const twelfth = await fire(app, "POST", cookie);
    expect(twelfth.status).toBe(200);

    const thirteenth = await fire(app, "POST", cookie);
    expect(thirteenth.status).toBe(429);
    expect(thirteenth.body).toEqual({
      error: "عدد كبير من محاولات إنشاء الطلبات. حاول مجدداً بعد دقيقة.",
      code: "RATE_LIMITED",
    });
    expect(thirteenth.rateLimit).toContain("r=0");
  });

  it("ordersCreateLimiter: reads are NOT counted (POST-only intent) — GET stays 200 after the submission budget is exhausted", async () => {
    const app = buildLimiterApp(ordersCreateLimiter);
    const cookie = userCookie(91201);
    for (let i = 0; i < 13; i++) {
      await fire(app, "POST", cookie);
    }
    const read = await fire(app, "GET", cookie);
    expect(read.status).toBe(200);
    expect((read.body as { reached?: boolean }).reached).toBe(true);
  });

  it("ordersCreateLimiter: per-USER key — a second user's bucket is untouched after the first user exhausts theirs", async () => {
    const app = buildLimiterApp(ordersCreateLimiter);
    const firstUser = userCookie(91301);
    for (let i = 0; i < 13; i++) {
      await fire(app, "POST", firstUser);
    }
    const secondUser = await fire(app, "POST", userCookie(91302));
    expect(secondUser.status).toBe(200);
    expect(secondUser.rateLimit).toContain("r=11");
  });

  it("walletTopupCreateLimiter: 12/min per-user window + the topup 429 body", async () => {
    const app = buildLimiterApp(walletTopupCreateLimiter);
    const cookie = userCookie(91401);

    const first = await fire(app, "POST", cookie);
    expect(first.status).toBe(200);
    expect(first.rateLimitPolicy).toMatch(POLICY_12_IN_60);

    for (let i = 0; i < 11; i++) {
      const mid = await fire(app, "POST", cookie);
      expect(mid.status).toBe(200);
    }
    const blocked = await fire(app, "POST", cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "عدد كبير من محاولات شحن المحفظة. حاول مجدداً بعد دقيقة.",
      code: "RATE_LIMITED",
    });
  });

  it("loyaltyConvertPointsLimiter: 12/min per-user window + the conversion 429 body", async () => {
    const app = buildLimiterApp(loyaltyConvertPointsLimiter);
    const cookie = userCookie(91501);

    const first = await fire(app, "POST", cookie);
    expect(first.status).toBe(200);
    expect(first.rateLimitPolicy).toMatch(POLICY_12_IN_60);

    for (let i = 0; i < 11; i++) {
      const mid = await fire(app, "POST", cookie);
      expect(mid.status).toBe(200);
    }
    const blocked = await fire(app, "POST", cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "عدد كبير من محاولات تحويل النقاط. حاول مجدداً بعد دقيقة.",
      code: "RATE_LIMITED",
    });
  });

  it("anonymous callers share ONE ip-keyed bucket (SEC-92-04 ipKeyGenerator fallback)", async () => {
    const app = buildLimiterApp(loyaltyConvertPointsLimiter);
    for (let i = 0; i < 12; i++) {
      const anon = await fire(app, "POST");
      expect(anon.status).toBe(200);
    }
    // The 13th cookie-less request from the SAME test-runner IP shares
    // the ip bucket — a per-connection key would never trip.
    const blocked = await fire(app, "POST");
    expect(blocked.status).toBe(429);
    expect((blocked.body as { code?: string }).code).toBe("RATE_LIMITED");
  });
});

describe("R136 (SEC F1) app.ts mount composition (source pin)", () => {
  it("the three money-intent limiters mount path-specific BEFORE the generic /api limiters", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../app.ts"), "utf8");
    const generic = src.indexOf('app.use("/api", apiLimiter)');
    expect(generic).toBeGreaterThan(-1);

    const mounts = [
      'app.use("/api/orders", ordersCreateLimiter)',
      'app.use("/api/wallet/topups", walletTopupCreateLimiter)',
      'app.use("/api/loyalty/convert-points", loyaltyConvertPointsLimiter)',
    ];
    for (const mount of mounts) {
      const at = src.indexOf(mount);
      expect(at, `app.ts must contain: ${mount}`).toBeGreaterThan(-1);
      expect(at, `${mount} must mount BEFORE the generic /api limiters`).toBeLessThan(generic);
    }
  });

  it("the limiters are distinct instances (no ERR_ERL_STORE_REUSE double-mount of one instance)", () => {
    expect(ordersCreateLimiter).not.toBe(walletTopupCreateLimiter);
    expect(ordersCreateLimiter).not.toBe(loyaltyConvertPointsLimiter);
    expect(walletTopupCreateLimiter).not.toBe(loyaltyConvertPointsLimiter);
  });
});

/**
 * R158 (B#6) — the ticket-intent limiters join the documented home.
 *
 * ticketCreateLimiter (V3-C5a) and ticketReplyLimiter (SEC-92-07) were
 * defined inline in routes/support.ts, invisible to this suite — the
 * single-home rule (lib/rate-limits.ts, per the app.ts mount comment)
 * existed only for the money trio. The definitions moved unchanged;
 * these cases pin the INTENT so a future config edit answers here:
 *
 *   - creation: 5/hour per USER (not per-IP — two users burn separate
 *     buckets), Arabic 429 body with the RATE_LIMITED code;
 *   - reply: 30/hour per USER, same 429 shape;
 *   - per-user keying mirrors the money trio's contract: the limiter
 *     reads the signed auth_token via getRequestUserId, so a cookie-less
 *     caller falls to the ip keyGenerator path.
 */
describe("R158 (B#6) ticket-intent limiters — window, budget, 429 shape", () => {
  // express-rate-limit 8.4.1's default identifier for a 5-per-3600s
  // limiter (same encoding the money trio's "12-in-1min" pins; ERL
  // renders the hour window as "1hr").
  const POLICY_5_IN_1H = /^"5-in-1hr"; q=5; w=3600; pk=:.+:$/;
  const POLICY_30_IN_1H = /^"30-in-1hr"; q=30; w=3600; pk=:.+:$/;

  it("ticketCreateLimiter: 5/hour pinned by the policy header; the 6th POST 429s with the Arabic RATE_LIMITED body", async () => {
    const app = buildTicketLimiterApp(ticketCreateLimiter);
    const cookie = userCookie(92101);

    const first = await fire(app, "POST", cookie);
    expect(first.status).toBe(200);
    expect(first.rateLimitPolicy).toMatch(POLICY_5_IN_1H);

    for (let i = 0; i < 3; i++) {
      const mid = await fire(app, "POST", cookie);
      expect(mid.status).toBe(200);
    }
    const fifth = await fire(app, "POST", cookie);
    expect(fifth.status).toBe(200);

    const sixth = await fire(app, "POST", cookie);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({
      error:
        "لقد أنشأت عدداً كافياً من التذاكر في هذه الساعة. انتظر قليلاً أو أضف رداً على تذكرة قائمة.",
      code: "RATE_LIMITED",
    });
  });

  it("ticketCreateLimiter: per-USER key — a second user's bucket is untouched after the first exhausts theirs", async () => {
    const app = buildTicketLimiterApp(ticketCreateLimiter);
    const first = userCookie(92201);
    for (let i = 0; i < 5; i++) {
      await fire(app, "POST", first);
    }
    expect((await fire(app, "POST", first)).status).toBe(429);

    const second = await fire(app, "POST", userCookie(92202));
    expect(second.status).toBe(200);
  });

  it("ticketReplyLimiter: 30/hour per-user window + the reply 429 body", async () => {
    const app = buildTicketLimiterApp(ticketReplyLimiter);
    const cookie = userCookie(92301);

    const first = await fire(app, "POST", cookie);
    expect(first.status).toBe(200);
    expect(first.rateLimitPolicy).toMatch(POLICY_30_IN_1H);

    for (let i = 0; i < 28; i++) {
      const mid = await fire(app, "POST", cookie);
      expect(mid.status).toBe(200);
    }
    const thirtieth = await fire(app, "POST", cookie);
    expect(thirtieth.status).toBe(200);

    const thirtyFirst = await fire(app, "POST", cookie);
    expect(thirtyFirst.status).toBe(429);
    expect(thirtyFirst.body).toEqual({
      error: "لقد أرسلت عدداً كافياً من الردود في هذه الساعة. انتظر قليلاً قبل المحاولة مجدداً.",
      code: "RATE_LIMITED",
    });
  });

  it("support.ts mounts the shared instances (single-home source pin)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../routes/support.ts"), "utf8");
    expect(src).toContain('router.post("/", requireUser, ticketCreateLimiter');
    expect(src).toContain('router.post("/:id/reply", requireUser, ticketReplyLimiter');
    // The R158 home move: no inline rateLimit() definition remains.
    expect(src).not.toMatch(/const\s+ticket(Create|Reply)Limiter\s*=\s*rateLimit\(/);
  });
});
