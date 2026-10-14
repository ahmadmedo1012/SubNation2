import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, sessionsTable, usersTable } from "../../test/db";
import { whatsappAuthRouter } from "../auth-whatsapp";
import { type VerifyOtpResult } from "../../services/whatsapp-otp.service";
import { isWhatsAppGatewayConfigured } from "../../services/openwa.service";
import { createUserSession } from "../../lib/session";

/**
 * R143 (L8-1) — createUserSession must fail HONESTLY on sessions-row
 * insert failure.
 *
 * The row IS the session since H1/93-A1 (requireUser + /api/auth/probe
 * reject any sid-bearing token whose row is missing), but the mint
 * helper still carried its pre-H1 "best-effort telemetry row" posture:
 * on insert failure it swallowed the error and returned a valid token —
 * a BORN-DEAD session. The route answered 200 + Set-Cookie, the SPA
 * hydrated "logged in", the next request 401'd, and the user bounced
 * back to /login for as long as the insert kept failing (login loop),
 * while the log called it non-fatal. The admin twin (createAdminSession)
 * never swallowed — this is the parity fix.
 *
 * Legs:
 *   1. unit — insert failure → createUserSession REJECTS (no token
 *      object ever escapes);
 *   2. route — the whatsapp verify mint route answers an honest 500 and
 *      mints NO auth_token cookie;
 *   3. control — without the injected failure the same route answers
 *      200 with the cookie-session sentinel (proves the wiring reaches
 *      the real mint).
 */

vi.mock("../../services/openwa.service", () => ({
  isWhatsAppGatewayConfigured: vi.fn(),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  startOtp: vi.fn(),
  // verifyOtp delegates to the REAL createUserSession — the unit under
  // test — exactly like the production service does.
  verifyOtp: vi.fn(async (): Promise<VerifyOtpResult> => {
    const { createUserSession: mint } = await import("../../lib/session");
    const { token } = await mint({ userId: 42, ipAddress: null, userAgent: "l8-1-test" });
    return {
      ok: true,
      token,
      isNewUser: true,
      user: { id: 42 },
    } as unknown as VerifyOtpResult;
  }),
}));

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
        reject(new Error("listener address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function postVerify(
  url: string,
): Promise<{ status: number; setCookie: string | null; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/auth/whatsapp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "0913456789", code: "123456" }),
  });
  const text = await res.text();
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie"),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

let url: string;
let close: () => void;

beforeAll(async () => {
  await initTestDb();
  const server = await listen(buildApp());
  url = server.url;
  close = server.close;
});
afterAll(() => close());

beforeEach(() => {
  // Undoes any db.insert spy a prior test left behind, and clears call
  // history — the vi.mock factory implementations survive (vitest keeps
  // the original impl passed to vi.fn).
  vi.restoreAllMocks();
  isConfiguredMock.mockReturnValue(true);
});

/** Fail ONLY the sessions-table insert, pass everything else through. */
function failSessionsInsert(): () => void {
  const originalInsert = db.insert.bind(db);
  const spy = vi.spyOn(db, "insert").mockImplementation((table: unknown) => {
    if (table === sessionsTable) {
      throw new Error("simulated sessions insert failure (L8-1)");
    }
    return originalInsert(table as never);
  });
  return () => spy.mockRestore();
}

describe("R143 (L8-1): createUserSession fails honestly on sessions-row insert failure", () => {
  it("unit leg — the insert failure propagates; no token is minted", async () => {
    await db.insert(usersTable).values({ id: 42, phone: "09100000042" }).onConflictDoNothing();
    const restore = failSessionsInsert();
    try {
      await expect(
        createUserSession({ userId: 42, ipAddress: null, userAgent: "l8-1-unit" }),
      ).rejects.toThrow("simulated sessions insert failure");
    } finally {
      restore();
    }
    // No session row was written either.
    const rows = await db.select().from(sessionsTable);
    expect(rows.filter((r) => r.userId === 42)).toHaveLength(0);
  });

  it("route leg — the mint route answers 500 and sets NO auth_token cookie", async () => {
    const restore = failSessionsInsert();
    let response: Awaited<ReturnType<typeof postVerify>>;
    try {
      response = await postVerify(url);
    } finally {
      restore();
    }

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
    // NO cookie for a session whose row was never written — the born-dead
    // mint is gone.
    expect(response.setCookie).toBeNull();
  });

  it("control leg — without the injected failure the same route mints normally", async () => {
    await db.insert(usersTable).values({ id: 42, phone: "09100000042" }).onConflictDoNothing();
    const response = await postVerify(url);

    expect(response.status).toBe(200);
    expect(response.body.token).toBe("__cookie_session__");
    expect(response.setCookie).toContain("auth_token=");
    // And the session row behind the cookie exists (row IS the session).
    const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.userId, 42));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
