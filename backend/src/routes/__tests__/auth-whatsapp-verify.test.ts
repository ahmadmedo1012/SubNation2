import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappAuthRouter } from "../auth-whatsapp";
import { verifyOtp, type VerifyOtpResult } from "../../services/whatsapp-otp.service";
import { isWhatsAppGatewayConfigured } from "../../services/openwa.service";

/**
 * R122 (A9-4): pinning POST /api/auth/whatsapp/verify — the phone-login
 * session minter (routes/auth-whatsapp.ts:201-294).
 *
 * Every /start failure mode has a dedicated route suite (settling /
 * daily-cap / gateway-waking — all POST /api/auth/whatsapp/start only),
 * but the MORE critical half of the flow — the route that actually mints
 * the session — had ZERO tests (A9 P1-2). The service core (verifyOtp
 * consume race, reason semantics) is covered in
 * services/__tests__/whatsapp-otp-consume-race.test.ts and
 * lib/__tests__/whatsapp-otp.test.ts; this suite pins the ROUTE layer's
 * contract, exactly the way the /start suites do (both orchestration
 * modules mocked — the mapping layer is the unit under test):
 *
 *   1. missing phone / code (or non-string shapes) → 400 INVALID_DATA
 *      before any orchestration;
 *   2. reason → status mapping: invalid_phone → 400; exhausted → 429;
 *      no_active_code / consumed / expired / mismatch → 401 — each with
 *      its exact Arabic copy + details.reason. NOTE: today's body code
 *      for the 429 is UNAUTHORIZED (only invalid_phone maps to
 *      INVALID_DATA — unlike /start, where the rate-limit class maps to
 *      RATE_LIMITED); that asymmetry is pinned as-is, not "fixed";
 *   3. success → httpOnly `auth_token` cookie carrying the verifyOtp
 *      token (30-day Max-Age, Path=/, SameSite) + the 98-F3 sentinel
 *      body `{ token: "__cookie_session__", is_new_user }` — the raw
 *      JWT is NEVER in the body;
 *   4. every failure → NO auth_token cookie minted (no half-sessions);
 *   5. pass-through: rawPhone/code/purpose="registration" + the
 *      referralCode normalization contract (trim → uppercase → 16-char
 *      cap; empty/non-string → undefined).
 *
 * The route-level rate limiter (authLimiter 10/15min/IP) is composed in
 * app.ts — outside this router — and is covered by
 * limiter-composition.test.ts's app-level contract; it is intentionally
 * not mounted here (same as every sibling /start suite).
 */

vi.mock("../../services/openwa.service", () => ({
  isWhatsAppGatewayConfigured: vi.fn(),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  startOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

const verifyOtpMock = vi.mocked(verifyOtp);
const isConfiguredMock = vi.mocked(isWhatsAppGatewayConfigured);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", whatsappAuthRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

interface VerifyResponse {
  status: number;
  setCookie: string | null;
  body: {
    error?: string;
    code?: string;
    details?: Record<string, unknown>;
    token?: string;
    is_new_user?: boolean;
  };
}

async function postVerify(url: string, body: unknown): Promise<VerifyResponse> {
  const res = await fetch(`${url}/api/auth/whatsapp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie"),
    body: text ? (JSON.parse(text) as VerifyResponse["body"]) : {},
  };
}

/** The fail-branch reason union (kept narrow so it.each rows typecheck). */
type VerifyFailReason = Extract<VerifyOtpResult, { ok: false }>["reason"];

/** A verifyOtp success shaped like the real return (VerifyOtpResult ok-branch). */
function otpSuccess(overrides: { isNewUser?: boolean; token?: string } = {}): VerifyOtpResult {
  // The route only reads user.id off the success branch (risk-event
  // attribution) — the full $inferSelect row is the service's concern,
  // so the stub user is cast once, here, with that note.
  return {
    ok: true,
    token: overrides.token ?? "jwt-minted-by-verify-otp",
    isNewUser: overrides.isNewUser ?? true,
    user: { id: 42 },
  } as unknown as VerifyOtpResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
});

// ── 1) Input perimeter ───────────────────────────────────────────────────────

describe("POST /api/auth/whatsapp/verify — input perimeter (400 before orchestration)", () => {
  it.each([
    ["missing phone", { code: "123456" }],
    ["missing code", { phone: "0913456789" }],
    ["empty phone", { phone: "", code: "123456" }],
    ["empty code", { phone: "0913456789", code: "" }],
    ["non-string phone (number)", { phone: 913456789, code: "123456" }],
    ["non-string code (number)", { phone: "0913456789", code: 123456 }],
  ])("%s → 400 INVALID_DATA, verifyOtp never called", async (_label, body) => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "رقم الهاتف والرمز مطلوبان",
        code: "INVALID_DATA",
      });
      expect(verifyOtpMock).not.toHaveBeenCalled();
      // No half-session: nothing minted on a 400.
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });
});

// ── 2) reason → status mapping (failure branch) ──────────────────────────────

describe("POST /api/auth/whatsapp/verify — reason → status mapping", () => {
  it("invalid_phone → 400 INVALID_DATA with the invalid-phone copy", async () => {
    verifyOtpMock.mockResolvedValue({ ok: false, reason: "invalid_phone" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "123", code: "123456" });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "رقم الهاتف غير صالح",
        code: "INVALID_DATA",
        details: { reason: "invalid_phone" },
      });
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });

  it("mismatch (wrong code) → 401 UNAUTHORIZED with the wrong-code copy", async () => {
    verifyOtpMock.mockResolvedValue({ ok: false, reason: "mismatch" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "000000" });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        error: "الرمز غير صحيح",
        code: "UNAUTHORIZED",
        details: { reason: "mismatch" },
      });
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });

  it("exhausted (per-code attempt cap) → 429 with the exhausted copy — body code stays UNAUTHORIZED (today's asymmetric mapping, pinned as-is)", async () => {
    verifyOtpMock.mockResolvedValue({ ok: false, reason: "exhausted" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "000000" });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({
        error: "عدد كبير من المحاولات الخاطئة، اطلب رمزاً جديداً",
        // NOT RATE_LIMITED — the verify mapper only special-cases
        // invalid_phone for the body code (auth-whatsapp.ts:255-265).
        // Pinned deliberately: a typed client reading `code` + status
        // together is the contract this guards.
        code: "UNAUTHORIZED",
        details: { reason: "exhausted" },
      });
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });

  it.each([
    ["no_active_code", "لا يوجد رمز فعّال لهذا الرقم"],
    ["consumed", "تم استخدام هذا الرمز بالفعل"],
    ["expired", "انتهت صلاحية الرمز"],
  ] as const)("%s → 401 UNAUTHORIZED with its exact Arabic copy", async (reason, copy) => {
    verifyOtpMock.mockResolvedValue({ ok: false, reason: reason as VerifyFailReason });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "123456" });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        error: copy,
        code: "UNAUTHORIZED",
        details: { reason },
      });
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });
});

// ── 3) Success — the session mint ────────────────────────────────────────────

describe("POST /api/auth/whatsapp/verify — success (session mint)", () => {
  it("sets the httpOnly auth_token cookie (30-day, Path=/, SameSite) and returns the 98-F3 sentinel body — never the raw JWT", async () => {
    verifyOtpMock.mockResolvedValue(
      otpSuccess({ isNewUser: true, token: "the-real-jwt-from-service" }),
    );
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "123456" });
      expect(res.status).toBe(200);

      // The cookie is the SOLE session transport: it carries the token
      // verifyOtp minted, httpOnly, 30-day Max-Age, Path=/.
      expect(res.setCookie).toContain("auth_token=the-real-jwt-from-service");
      expect(res.setCookie).toContain("HttpOnly");
      expect(res.setCookie).toContain("Max-Age=2592000");
      expect(res.setCookie).toContain("Path=/");

      // The body is exactly the sentinel shape — the JWT never rides it.
      expect(res.body).toEqual({ token: "__cookie_session__", is_new_user: true });
      expect(JSON.stringify(res.body)).not.toContain("the-real-jwt-from-service");
    } finally {
      close();
    }
  });

  it("a returning user mints the same cookie contract with is_new_user: false", async () => {
    verifyOtpMock.mockResolvedValue(otpSuccess({ isNewUser: false, token: "returning-jwt" }));
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "123456" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ token: "__cookie_session__", is_new_user: false });
      expect(res.setCookie).toContain("auth_token=returning-jwt");
    } finally {
      close();
    }
  });
});

// ── 4) Pass-through contract to the orchestrator ─────────────────────────────

describe("POST /api/auth/whatsapp/verify — orchestrator pass-through", () => {
  it("forwards rawPhone/code verbatim with purpose='registration' plus client info (normalization is the service's job)", async () => {
    verifyOtpMock.mockResolvedValue(otpSuccess());
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, { phone: "0913456789", code: "123456" });
      expect(res.status).toBe(200);
      expect(verifyOtpMock).toHaveBeenCalledTimes(1);
      expect(verifyOtpMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPhone: "0913456789",
          code: "123456",
          purpose: "registration",
          ipAddress: expect.any(String),
          userAgent: expect.any(String),
        }),
      );
    } finally {
      close();
    }
  });

  it("referralCode is trimmed, uppercased and capped at 16 chars before forwarding", async () => {
    verifyOtpMock.mockResolvedValue(otpSuccess());
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify(url, {
        phone: "0913456789",
        code: "123456",
        referralCode: "  ref1234567890123456  ",
      });
      expect(res.status).toBe(200);
      const forwarded = verifyOtpMock.mock.calls[0]![0];
      expect(forwarded.referralCode).toBe("REF1234567890123"); // 16-char cap
    } finally {
      close();
    }
  });

  it.each([
    ["an empty/whitespace-only string", "   "],
    ["a non-string value (number)", 12345],
  ])(
    "referralCode %s → forwarded as undefined (no referral attribution)",
    async (_label, value) => {
      verifyOtpMock.mockResolvedValue(otpSuccess());
      const { url, close } = await listen(buildApp());
      try {
        const res = await postVerify(url, {
          phone: "0913456789",
          code: "123456",
          referralCode: value,
        });
        expect(res.status).toBe(200);
        expect(verifyOtpMock.mock.calls[0]![0].referralCode).toBeUndefined();
      } finally {
        close();
      }
    },
  );
});
