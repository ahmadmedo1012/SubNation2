import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { publishDraft } from "../../services/enrichment/publish";
import { adminEnrichmentRouter } from "../admin/enrichment";

/**
 * R120-B6/A6-F12 — at-cap BOUNDARY passthrough for the `final_text` cap.
 *
 * Sibling of admin-enrichment-final-text-cap.test.ts (which proves the
 * over-cap refusals against the REAL publish service). publishDraft is
 * mocked here because its state-guard heuristic reads node-postgres'
 * `rowCount`, which pglite does not expose (it ships `affectedRows`) —
 * a real publish under this harness deterministically fails the guard
 * (pre-existing, service-level, out of this finding's route scope). The
 * mock lets this suite pin the ROUTE's half of the boundary contract:
 *
 *   - exactly-at-cap text (after trim) is NOT refused — it reaches
 *     publishDraft with the RAW padded text (trim-before-persist stays
 *     the service's job; the route's cap measures the trimmed length
 *     only, keeping both layers' trim semantics aligned);
 *   - over-cap text never reaches publishDraft at all.
 */

vi.mock("../../services/enrichment/publish", () => ({
  publishDraft: vi.fn(),
  rejectDraftHandler: vi.fn(),
}));

const publishDraftMock = vi.mocked(publishDraft);

const CAP = 16_000;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminEnrichmentRouter);
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

async function seedAdmin(): Promise<string> {
  const [admin] = await db
    .insert(adminUsersTable)
    .values({ username: "cap_pass_admin", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: admin.id, role: "admin" });
}

async function postPublish(
  url: string,
  token: string,
  finalText: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/enrichment/42/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
    body: JSON.stringify({ final_text: finalText }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  publishDraftMock.mockReset();
  publishDraftMock.mockResolvedValue({ kind: "success", productId: 7, field: "description" });
});

describe("admin enrichment publish — at-cap boundary passthrough (R120-B6/A6-F12)", () => {
  it("exactly at the cap (after trim) → guard passes, service receives the RAW text", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const trimmed = "نص حدّي ".repeat(2_000); // 16,000 chars, no edges
      expect(trimmed.length).toBe(CAP);
      // Surrounding whitespace must NOT tip the boundary: the route's
      // cap measures trimmed.length, publish.ts trims before persisting.
      const padded = `  ${trimmed}  `;
      const res = await postPublish(url, token, padded);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, product_id: 7 });
      expect(publishDraftMock).toHaveBeenCalledTimes(1);
      expect(publishDraftMock).toHaveBeenCalledWith({
        draftId: 42,
        adminId: expect.any(Number),
        finalTextOverride: padded,
      });
    } finally {
      close();
    }
  });

  it("over the cap → 400 and publishDraft is NEVER invoked (guard fires first)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postPublish(url, token, "أ".repeat(CAP + 1));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(publishDraftMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});
