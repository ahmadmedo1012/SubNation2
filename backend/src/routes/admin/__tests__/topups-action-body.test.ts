import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { ServiceError, TopupService } from "../../../services/topup.service";
import { adminTopupsRouter } from "../topups";

/**
 * R118-A1 F-1 — topup approve/reject body-contract regression.
 *
 * `parseTopupActionBody` used to return `string | null`, so a VALID body
 * without the OPTIONAL admin_note (`{}` — exactly what the openapi
 * AdminTopupActionBody declares, and what the R116 copilot admin_request
 * tool sends) was conflated with an invalid body and 400'd
 * INVALID_DATA on both money-approval routes. The parser now returns a
 * discriminated result: only a schema failure answers 400; a valid body
 * proceeds into TopupService with `note = null` (the service signature
 * has always accepted `string | null`).
 *
 * TopupService is mocked here ON PURPOSE: the unit under test is the
 * ROUTE contract (parse → 400-or-proceeds → service args), not the
 * approval state machine (pinned in services/__tests__/topup*.test.ts
 * against the real service). The pglite harness still backs requireAdmin
 * (a real admin row is needed for the token lookup).
 */

vi.mock("../../../services/topup.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/topup.service")>();
  return {
    ...actual,
    TopupService: {
      approve: vi.fn(),
      reject: vi.fn(),
    },
  };
});

const approveMock = vi.mocked(TopupService.approve);
const rejectMock = vi.mocked(TopupService.reject);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminTopupsRouter);
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

const ADMIN_USERNAME = "topups-action-admin";

async function seedAdminToken(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: ADMIN_USERNAME, passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function postAction(
  url: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const init: RequestInit = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" } as Record<string, string>;
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${url}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  approveMock.mockReset();
  rejectMock.mockReset();
  approveMock.mockResolvedValue({ id: 5, status: "approved" } as never);
  rejectMock.mockResolvedValue({ id: 5, status: "rejected" } as never);
});

describe("R118-A1 F-1: topup approve/reject — contract-valid body without admin_note", () => {
  it("approve with body {} (admin_note absent) → NOT 400; reaches TopupService.approve with note null", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/5/approve", token, {});
      // THE F-1 pin: `{}` is contract-valid — the request must proceed to
      // the service layer (200 + the mocked approval envelope), not 400.
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "approved" });
      expect(approveMock).toHaveBeenCalledTimes(1);
      // The optional note rides through as null (not undefined, not "").
      expect(approveMock).toHaveBeenCalledWith(5, null, ADMIN_USERNAME);
    } finally {
      close();
    }
  });

  it("approve with NO body at all → same valid-empty shape, proceeds with note null", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/7/approve", token);
      expect(res.status).toBe(200);
      expect(approveMock).toHaveBeenCalledWith(7, null, ADMIN_USERNAME);
    } finally {
      close();
    }
  });

  it("approve with explicit admin_note null → proceeds with note null (nullish is contract-valid)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/5/approve", token, {
        admin_note: null,
      });
      expect(res.status).toBe(200);
      expect(approveMock).toHaveBeenCalledWith(5, null, ADMIN_USERNAME);
    } finally {
      close();
    }
  });

  it("approve with a string admin_note → proceeds with the TRIMMED note", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/5/approve", token, {
        admin_note: "  تم التحويل  ",
      });
      expect(res.status).toBe(200);
      expect(approveMock).toHaveBeenCalledWith(5, "تم التحويل", ADMIN_USERNAME);
    } finally {
      close();
    }
  });

  it("reject with body {} → proceeds to TopupService.reject with note null", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/9/reject", token, {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "rejected" });
      expect(rejectMock).toHaveBeenCalledTimes(1);
      expect(rejectMock).toHaveBeenCalledWith(9, null, ADMIN_USERNAME);
    } finally {
      close();
    }
  });
});

describe("R118-A1 F-1: topup approve/reject — truly-invalid bodies still 400", () => {
  it.each([
    ["admin_note as an object (the M3 raw-read case)", { admin_note: { evil: "object" } }],
    ["admin_note as a number", { admin_note: 123 }],
    ["admin_note longer than 500 chars", { admin_note: "x".repeat(501) }],
    ["unknown key (strict schema)", { totally_unexpected: 1 }],
  ])("approve rejects %s with 400 INVALID_DATA and never reaches the service", async (_label, body) => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/5/approve", token, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(approveMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("reject answers 400 INVALID_DATA for an object admin_note (same shared schema)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      const res = await postAction(url, "/api/admin/topups/5/reject", token, {
        admin_note: ["array"],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(rejectMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});

describe("R118-A1 F-1: ServiceError mapping still intact on the proceed path", () => {
  it("approve maps a ServiceError from the service to its status + code envelope", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const token = await seedAdminToken();
      approveMock.mockRejectedValueOnce(
        new ServiceError(409, "تمت معالجة هذا الطلب مسبقاً") as never,
      );
      const res = await postAction(url, "/api/admin/topups/5/approve", token, {});
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
    } finally {
      close();
    }
  });
});
