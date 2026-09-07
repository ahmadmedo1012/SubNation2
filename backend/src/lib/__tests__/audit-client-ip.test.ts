import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

/**
 * SEC-92-06 (round-92 B1 security audit) — audit-log client IP resolution.
 *
 * writeAuditLog previously recorded the LEFTMOST X-Forwarded-For entry —
 * a client-spoofable value (direct-to-origin attacker sends
 * `X-Forwarded-For: 8.8.8.8` and every audit row for their actions
 * records the forged IP). The resolver now prefers req.ip (already
 * CF-validated by the cloudflareClientIp middleware) and only falls back
 * to the RIGHTMOST XFF entry (appended by the trusted proxy).
 *
 * @workspace/db is mocked so writeAuditLog runs without a DB and the
 * exact row values are observable.
 */

const { insertValues } = vi.hoisted(() => ({ insertValues: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { insert: () => ({ values: insertValues }) },
  auditLogsTable: { name: "audit_logs" },
}));

import { resolveAuditClientIp, writeAuditLog } from "../audit";

function mockReq(overrides: Record<string, unknown>): Request {
  return {
    headers: {},
    socket: { remoteAddress: undefined },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  insertValues.mockClear();
});

describe("resolveAuditClientIp (SEC-92-06)", () => {
  it("XFF '1.2.3.4, 5.6.7.8' resolves to 5.6.7.8 (rightmost, proxy-appended)", () => {
    const req = mockReq({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(resolveAuditClientIp(req)).toBe("5.6.7.8");
  });

  it("single-entry XFF resolves to that entry", () => {
    const req = mockReq({ headers: { "x-forwarded-for": "8.8.4.4" } });
    expect(resolveAuditClientIp(req)).toBe("8.8.4.4");
  });

  it("req.ip (CF-validated by middleware) takes priority over XFF", () => {
    const req = mockReq({
      ip: "203.0.113.9",
      headers: { "x-forwarded-for": "8.8.8.8, 1.1.1.1" },
    });
    expect(resolveAuditClientIp(req)).toBe("203.0.113.9");
  });

  it("no XFF → falls back to socket.remoteAddress", () => {
    const req = mockReq({ socket: { remoteAddress: "10.0.0.7" } });
    expect(resolveAuditClientIp(req)).toBe("10.0.0.7");
  });

  it("nothing available → 'unknown' (never the leftmost spoofable entry)", () => {
    expect(resolveAuditClientIp(mockReq({}))).toBe("unknown");
  });

  it("tolerates whitespace around XFF entries", () => {
    const req = mockReq({ headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8 " } });
    expect(resolveAuditClientIp(req)).toBe("5.6.7.8");
  });
});

describe("writeAuditLog records the resolved (unspoofable) IP (SEC-92-06)", () => {
  it("XFF '1.2.3.4, 5.6.7.8' is stored as 5.6.7.8 — not the client-supplied 1.2.3.4", async () => {
    insertValues.mockResolvedValue(undefined);
    const req = mockReq({
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "vitest" },
    });
    await writeAuditLog(req, "topup.approve", "topup", 7, { amount: "50.00" });

    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0] as { ip?: string; action?: string };
    expect(row.ip).toBe("5.6.7.8");
    expect(row.action).toBe("topup.approve");
  });

  it("req.ip wins end-to-end when present", async () => {
    insertValues.mockResolvedValue(undefined);
    const req = mockReq({
      ip: "198.51.100.22",
      headers: { "x-forwarded-for": "6.6.6.6, 7.7.7.7" },
    });
    await writeAuditLog(req, "users.patch", "user", 3);
    const row = insertValues.mock.calls[0][0] as { ip?: string };
    expect(row.ip).toBe("198.51.100.22");
  });
});
