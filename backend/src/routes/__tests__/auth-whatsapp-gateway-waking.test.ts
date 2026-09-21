import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappAuthRouter } from "../auth-whatsapp";
import { startOtp } from "../../services/whatsapp-otp.service";
import { isWhatsAppGatewayConfigured } from "../../services/openwa.service";

/**
 * AUD103-5-F3 / AUD103-8-F4 (r103, P1): the R102 gateway cold-wake contract
 * had ZERO test coverage at any of its three layers — only the sibling
 * whatsapp_settling reason was pinned (auth-whatsapp-settling.test.ts). This
 * suite pins the ROUTE half: `gateway_waking` → 503 + Retry-After: 30 +
 * details.reason + the honest wake Arabic copy. (The service mapping has its
 * own suite: whatsapp-otp-gateway-waking.test.ts; the FE banner is covered
 * by the frontend suites.)
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

describe("POST /api/auth/whatsapp/start — gateway_waking mapping (R102, pinned r103)", () => {
  it("gateway_waking → 503 + Retry-After: 30 + retry_after_sec + honest wake copy", async () => {
    startOtpMock.mockResolvedValue({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
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

      // 503 (not the pre-r102 hard 502) + the honest retry hint.
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("30");
      expect(body.details).toMatchObject({ reason: "gateway_waking", retry_after_sec: 30 });
      expect(body.error).toBe(
        "جاري استيقاظ خدمة WhatsApp من السكون — ستُعاد المحاولة تلقائياً خلال لحظات",
      );
      // AUD103-4-F5 (r103): the body code classifies like the status.
      expect(body.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      close();
    }
  });
});
