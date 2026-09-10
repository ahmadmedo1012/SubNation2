import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappAuthRouter } from "../auth-whatsapp";
import { startOtp } from "../../services/whatsapp-otp.service";
import { isWhatsAppGatewayConfigured } from "../../services/openwa.service";

/**
 * 96-F1 (R96-A4 §1.3C + §4.2) — POST /api/auth/whatsapp/start reason →
 * HTTP mapping for the two NEW honest failures:
 *
 *   - whatsapp_settling (the settle-gate verdict behind the production
 *     "Waiting for this message" incident) → 503 + Retry-After +
 *     details.retry_after_sec + the honest Arabic copy «قناة WhatsApp
 *     ربطت للتو — تُهيَّأ الآن…». The client auto-retries after
 *     retry_after_sec instead of burning a resend.
 *
 *   - store_failed (code delivered on WhatsApp but the OTP row could not
 *     be persisted after a retry-once) → 500 + Retry-After: 30 so the
 *     client sets a short cooldown instead of instantly re-sending a
 *     SECOND WhatsApp message.
 *
 * Both orchestrator and gateway modules are mocked — the mapping layer
 * is the unit under test (the service mapping has its own coverage via
 * whatsapp-readiness.test.ts / openwa-settle-gate.test.ts).
 */

vi.mock("../../services/openwa.service", () => ({
  isWhatsAppGatewayConfigured: vi.fn(),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  startOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

const startOtpMock = vi.mocked(startOtp);
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

interface StartResponse {
  status: number;
  headers: Headers;
  body: {
    error?: string;
    code?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    expires_at?: string;
  };
}

async function postStart(url: string, body: unknown): Promise<StartResponse> {
  const res = await fetch(`${url}/api/auth/whatsapp/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as StartResponse["body"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
});

describe("POST /api/auth/whatsapp/start — settling + store_failed mapping (96-F1)", () => {
  it("whatsapp_settling → 503 + Retry-After + retry_after_sec + honest Arabic copy", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "whatsapp_settling", retryAfterSec: 12 });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("12");
      expect(res.body.details).toMatchObject({ reason: "whatsapp_settling", retry_after_sec: 12 });
      expect(res.body.error).toBe(
        "قناة WhatsApp ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من دقيقة",
      );

      // The phone reached the orchestrator unmodified (normalization is
      // the service's job — the route is a pass-through).
      expect(startOtpMock).toHaveBeenCalledWith(
        expect.objectContaining({ rawPhone: "0913456789", purpose: "registration" }),
      );
    } finally {
      close();
    }
  });

  it("store_failed → 500 + Retry-After: 30 (short cooldown, no instant re-send)", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "store_failed", retryAfterSec: 30 });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });

      expect(res.status).toBe(500);
      expect(res.headers.get("Retry-After")).toBe("30");
      expect(res.body.details).toMatchObject({ reason: "store_failed", retry_after_sec: 30 });
    } finally {
      close();
    }
  });

  it("cooldown keeps the pre-existing 429 + Retry-After mapping (refactor regression guard)", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "cooldown", retryAfterSec: 37 });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("37");
      expect(res.body.details).toMatchObject({ reason: "cooldown", retry_after_sec: 37 });
    } finally {
      close();
    }
  });

  it("whatsapp_not_paired keeps the r95 503 mapping (regression guard)", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "whatsapp_not_paired" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBeNull();
      expect(res.body.details).toMatchObject({ reason: "whatsapp_not_paired" });
    } finally {
      close();
    }
  });

  it("success → 200 with expires_at only (never the code)", async () => {
    const expiresAt = new Date("2026-09-12T00:00:00.000Z");
    startOtpMock.mockResolvedValue({ ok: true, expiresAt });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, expires_at: expiresAt.toISOString() });
    } finally {
      close();
    }
  });

  it("gateway unconfigured → 503 gateway_disabled before any orchestration", async () => {
    isConfiguredMock.mockReturnValue(false);
    const { url, close } = await listen(buildApp());
    try {
      const res = await postStart(url, { phone: "0913456789" });
      expect(res.status).toBe(503);
      expect(res.body.details).toMatchObject({ reason: "gateway_disabled" });
      expect(startOtpMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});
