import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import {
  adminRequest,
  executeAdminRequest,
  isAdminRequestToolName,
  isPathAllowed,
  type AdminRequestContext,
} from "../admin-request-tool";

/**
 * SEC-92-03 (round-92 B1 security audit) — super-admin copilot injection
 * hardening for the admin_request tool.
 *
 * Two controls are pinned here:
 *
 *   1. PATH DENYLIST — /api/admin/admins* and /api/admin/settings* are
 *      refused even for super-admins. Indirect prompt injection via
 *      ticket/product text previously could drive
 *      `POST /api/admin/admins {permissions:["all"]}` and mint a
 *      persistent backdoor admin. The refusal is a clear Arabic message.
 *
 *   2. MUTATION CONFIRMATION — POST/PATCH/PUT/DELETE do not execute on
 *      the first call; they return a preview and require a repeat of the
 *      same call with confirm: true. A single injected instruction can
 *      no longer silently mutate.
 */

// ── 1) Denylist (pure function) ─────────────────────────────────────────────

describe("SEC-92-03: isPathAllowed denylist", () => {
  it("blocks admin account management (create/list/patch/enable/disable/permissions)", () => {
    for (const path of [
      "/api/admin/admins",
      "/api/admin/admins/",
      "/api/admin/admins/3",
      "/api/admin/admins/3/permissions",
    ]) {
      const result = isPathAllowed(path);
      expect(result.ok, path).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("هذا المسار محجوب عن Copilot لأسباب أمنية");
      }
    }
  });

  it("blocks settings (system + auth-provider config, including the separately mounted /settings/auth)", () => {
    for (const path of [
      "/api/admin/settings",
      "/api/admin/settings/",
      "/api/admin/settings/telegram_bot_token",
      "/api/admin/settings/auth/telegram",
      "/api/admin/settings/auth/3",
    ]) {
      expect(isPathAllowed(path).ok, path).toBe(false);
    }
  });

  it("denylist cannot be dodged by normalization tricks", () => {
    // URL normalization would collapse these onto blocked paths.
    expect(isPathAllowed("/api/admin/admins%2f").ok).toBe(false);
    expect(isPathAllowed("/api/admin/./admins").ok).toBe(false);
  });

  it("still allows ordinary admin surfaces (denylist is surgical)", () => {
    expect(isPathAllowed("/api/admin/products").ok).toBe(true);
    expect(isPathAllowed("/api/admin/orders/123").ok).toBe(true);
    expect(isPathAllowed("/api/admin/topups/5/approve").ok).toBe(true);
    expect(isPathAllowed("/api/admin/tickets/9/replies").ok).toBe(true);
  });

  it("existing auth/copilot disallow prefixes keep working", () => {
    expect(isPathAllowed("/api/admin/auth/login").ok).toBe(false);
    expect(isPathAllowed("/api/admin/copilot/draft").ok).toBe(false);
  });
});

// ── 2) Mutation confirmation gate (loopback stub) ───────────────────────────

describe("SEC-92-03: admin_request mutation confirmation", () => {
  let stub: Express;
  let url: string;
  let close: () => void;
  const hits: Array<{ method: string; path: string; body: unknown; confirmHeaderGuard?: string }> =
    [];

  const ctx: AdminRequestContext = {
    req: {
      headers: { authorization: "Bearer test-admin-token" },
      protocol: "http",
    } as unknown as AdminRequestContext["req"],
  };

  beforeAll(async () => {
    stub = express();
    stub.use(express.json({ limit: "1mb" }));
    stub.use("/api/admin", (req, res) => {
      hits.push({ method: req.method, path: req.path, body: req.body });
      res.status(200).json({ ok: true, stub: true, path: req.path });
    });
    await new Promise<void>((resolve, reject) => {
      const server = stub.listen(0, () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("listener address is not AddressInfo"));
          return;
        }
        process.env.PORT = String(addr.port);
        url = `http://127.0.0.1:${addr.port}`;
        close = () => server.close();
        resolve();
      });
    });
  });

  afterAll(() => {
    close();
    delete process.env.PORT;
  });

  afterEach(() => {
    hits.length = 0;
  });

  it("the stub loopback is reachable via getLoopbackBase (PORT wiring sanity)", async () => {
    const res = await fetch(`${url}/api/admin/products`);
    expect(res.status).toBe(200);
  });

  it("mutation WITHOUT confirm → 428 preview, nothing executed", async () => {
    const result = await executeAdminRequest(
      {
        method: "POST",
        path: "/api/admin/topups/5/approve",
        body: { admin_note: "ok" },
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(428);
    expect(hits).toHaveLength(0); // NOTHING hit the loopback
    const body = result.body as {
      code?: string;
      requires_confirmation?: boolean;
      preview?: { wouldCall?: boolean; method?: string; path?: string; bodySummary?: string };
      error?: string;
      hint?: string;
    };
    expect(body.code).toBe("COPILOT_CONFIRMATION_REQUIRED");
    expect(body.requires_confirmation).toBe(true);
    expect(body.preview?.wouldCall).toBe(true);
    expect(body.preview?.method).toBe("POST");
    expect(body.preview?.path).toBe("/api/admin/topups/5/approve");
    expect(body.preview?.bodySummary).toContain("admin_note");
    expect(typeof body.hint).toBe("string");
  });

  it("confirm=false is treated as unconfirmed (no execution)", async () => {
    const result = await executeAdminRequest(
      { method: "POST", path: "/api/admin/topups/5/approve", body: {}, confirm: false },
      ctx,
    );
    expect(result.status).toBe(428);
    expect(hits).toHaveLength(0);
  });

  it("mutation WITH confirm=true executes the loopback call with the original body", async () => {
    const result = await executeAdminRequest(
      {
        method: "POST",
        path: "/api/admin/topups/5/approve",
        body: { admin_note: "approved by test" },
        confirm: true,
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(hits).toHaveLength(1);
    expect(hits[0].method).toBe("POST");
    expect(hits[0].body).toEqual({ admin_note: "approved by test" });
    expect(result.body).toMatchObject({ ok: true, stub: true });
  });

  it("GET executes directly (read-only calls need no confirmation)", async () => {
    const result = await executeAdminRequest(
      { method: "GET", path: "/api/admin/topups" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(hits).toHaveLength(1);
    expect(hits[0].method).toBe("GET");
  });

  it("denylisted path is refused EVEN WITH confirm=true", async () => {
    const result = await executeAdminRequest(
      {
        method: "POST",
        path: "/api/admin/admins",
        body: { username: "backdoor", password: "LongStr0ng!", permissions: ["all"] },
        confirm: true,
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(hits).toHaveLength(0);
    const body = result.body as { code?: string; error?: string };
    expect(body.code).toBe("COPILOT_PATH_BLOCKED");
    expect(body.error).toContain("هذا المسار محجوب عن Copilot لأسباب أمنية");
  });

  it("denylisted settings path is refused even on PATCH with confirm", async () => {
    const result = await executeAdminRequest(
      { method: "PATCH", path: "/api/admin/settings/auth/3", body: { enabled: true }, confirm: true },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(hits).toHaveLength(0);
  });
});

// ── 3) Tool contract ────────────────────────────────────────────────────────

describe("SEC-92-03: tool spec contract", () => {
  it("declares the confirm parameter (additionalProperties:false providers must accept it)", () => {
    const props = adminRequest.spec.function.parameters?.properties as Record<string, unknown>;
    expect(props).toHaveProperty("confirm");
    expect((props.confirm as { type?: string }).type).toBe("boolean");
  });

  it("super-admin-only scope retained", () => {
    expect(adminRequest.requiredScope).toBe("all");
    expect(isAdminRequestToolName("admin_request")).toBe(true);
    expect(isAdminRequestToolName("update_product")).toBe(false);
  });
});
