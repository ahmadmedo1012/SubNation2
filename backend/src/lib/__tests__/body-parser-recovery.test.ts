import express, { type Express } from "express";
import type pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyParserRecovery } from "../body-parser-recovery";
import { logger } from "../logger";

/**
 * R142 (E-2) — the malformed-body warn log must never carry the raw body.
 *
 * `bodyPreview: rawBody.slice(0, 80)` wrote truncated-but-valid password
 * fragments verbatim into the log stream: pino's REDACT_PATHS redacts
 * object FIELDS (`*.password`), never substrings inside a string, so a
 * truncated JSON credential body (`{"password":"hunter2",`) bypassed the
 * entire redaction design. The fix logs the LENGTH only. This test
 * fails if any raw-body content returns to the warn line.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(bodyParserRecovery);
  // Fall-through handler so a bug that next()s the error still fails the
  // response-shape assertion instead of crashing the harness.
  app.use(() => {
    throw new Error("bodyParserRecovery must answer the malformed body itself");
  });
  app.post("/api/auth/login", (_req, res) => res.json({ ok: true }));
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

let warnSpy: ReturnType<typeof spyWarn>;

function spyWarn() {
  return vi.spyOn(logger, "warn").mockImplementation(() => undefined);
}

beforeEach(() => {
  warnSpy = spyWarn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("E-2 — malformed-body warn log carries no raw body", () => {
  it("truncated JSON credentials: 400 INVALID_DATA + length-only log, never the body", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A legitimate truncated-body shape: the password is fully
        // present in the raw string the JSON parser failed on.
        body: `{"phone":"0912345678","password":"hunter2-secret",`,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "INVALID_DATA", error: "بيانات الطلب غير صالحة" });

      const warn = warnSpy.mock.calls.find(
        (c: Parameters<pino.Logger["warn"]>) => c[1] === "[body-parse] rejected malformed body",
      );
      expect(warn).toBeDefined();
      const fields = warn![0] as Record<string, unknown>;
      expect(fields.bodyLength).toBeGreaterThan(0); // size still diagnosable
      // The raw body never reaches the log line — field or serialized form.
      expect(JSON.stringify(warn![0])).not.toContain("hunter2-secret");
      expect(JSON.stringify(warn![0])).not.toContain("phone");
    } finally {
      close();
    }
  });
});
