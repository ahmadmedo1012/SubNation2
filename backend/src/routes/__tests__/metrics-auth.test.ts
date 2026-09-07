import { beforeAll, describe, expect, it } from "vitest";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { signAdminToken } from "../../lib/jwt";
import metricsRouter from "../metrics";

/**
 * SEC-92-02 (round-92 B1 security audit) — /api/metrics auth gate.
 *
 * requireAdmin (middlewares/requireAdmin.ts, V1-CRITICAL) rejects the 2FA
 * TEMP token everywhere; /api/metrics verified the admin JWT itself and
 * had no isTemp check, so a password-only attacker (password + no TOTP)
 * could read the full Prometheus operational telemetry (traffic,
 * latencies, DB pool, socket counts) by presenting the half-session temp
 * token. These tests pin the fix: temp token → 401, full token → 200.
 */

function buildApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use("/api", metricsRouter);
  return app;
}

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

async function get(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; contentType: string | null }> {
  const res = await fetch(`${url}/api/metrics`, { headers });
  const body = await res.text();
  return { status: res.status, body, contentType: res.headers.get("content-type") };
}

const TEMP_TOKEN = signAdminToken({ adminId: 1, role: "super_admin", isTemp: true });
const FULL_TOKEN = signAdminToken({ adminId: 1, role: "super_admin" });

beforeAll(() => {
  // The static-token path must stay inert so the JWT paths are the ones
  // under test.
  delete process.env.METRICS_ADMIN_TOKEN;
});

describe("GET /api/metrics — admin JWT auth (SEC-92-02)", () => {
  it("no credentials → 401", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, {});
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("2FA TEMP token via cookie → 401 (mirrors requireAdmin V1-CRITICAL)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${TEMP_TOKEN}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("2FA TEMP token via Authorization: Bearer → 401", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Authorization: `Bearer ${TEMP_TOKEN}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("FULL admin token via cookie → 200 Prometheus exposition", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${FULL_TOKEN}` });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/plain");
      expect(res.body.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it("FULL admin token via Authorization: Bearer → 200", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Authorization: `Bearer ${FULL_TOKEN}` });
      expect(res.status).toBe(200);
    } finally {
      close();
    }
  });

  it("garbage token → 401 (fail closed, no oracle about which check failed)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: "admin_token=not-a-jwt" });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});
