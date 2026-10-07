import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappAuthRouter } from "../auth-whatsapp";
import { startOtp } from "../../services/whatsapp-otp.service";
import { isWhatsAppGatewayConfigured } from "../../services/openwa.service";

/**
 * R120-B6/A8-F5 — ROUTE half of the process-wide daily OTP send ceiling:
 * the service's new `daily_limit` verdict maps to 429 + RATE_LIMITED +
 * the honest "try tomorrow" Arabic copy (the per-phone caps' 429 class,
 * not a 5xx). Same vi.mock shape as auth-whatsapp-gateway-waking.test.ts
 * (the service mapping itself is pinned by
 * whatsapp-otp-daily-cap.test.ts).
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
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
});

describe("POST /api/auth/whatsapp/start — daily_limit mapping (R120-B6/A8-F5)", () => {
  it("daily_limit → 429 + RATE_LIMITED + honest daily-ceiling Arabic copy", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "daily_limit" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/auth/whatsapp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "0913456789" }),
      });
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        details?: Record<string, unknown>;
      };

      // The rate-limit class (same as cooldown/hourly_limit), with the
      // body code classifying like the status (AUD103-4-F5 idiom).
      expect(res.status).toBe(429);
      expect(body.code).toBe("RATE_LIMITED");
      expect(body.details).toMatchObject({ reason: "daily_limit" });
      expect(body.error).toBe("تم الوصول إلى الحد اليومي لإرسال رموز التحقق، حاول غداً");
      // No Retry-After — the ban lifts at the UTC day boundary, not on a
      // short timer a client could auto-retry against.
      expect(res.headers.get("Retry-After")).toBeNull();
    } finally {
      close();
    }
  });
});
