import express from "express";
import { describe, expect, it } from "vitest";
import cwvRouter from "../cwv";

/**
 * Regression coverage for the `POST /api/cwv` ingestion path.
 *
 * The production bug (commit 7dfddd0) shipped a frontend that called
 * `navigator.sendBeacon(url, JSON.stringify(sample))`. sendBeacon then
 * sends `Content-Type: text/plain;charset=UTF-8`, which the top-level
 * `express.json()` middleware skipped, leaving `req.body` undefined. The
 * validator rejected it as 400.
 *
 * This suite proves the route accepts beacons under all three forms the
 * client may send:
 *   - application/json  (the post-fix happy path; Blob with type=…)
 *   - text/plain        (default sendBeacon when the body is a string)
 *   - octet-stream      (some browsers/extensions normalise blob bodies)
 *
 * It also asserts that genuine validation failures still return 400 with
 * a `reason` discriminator so the next regression is faster to spot.
 */

function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", cwvRouter);
  return app;
}

const VALID_SAMPLE = {
  name: "LCP" as const,
  value: 2200,
  rating: "good" as const,
  route: "/",
  viewportClass: "mobile" as const,
  sessionId: "1f2c8d3a-9c5b-4d7e-8a6f-3b2a1c4d5e6f",
  timestamp: 1778900000000,
};

async function postRaw(
  app: express.Express,
  body: string,
  contentType: string | undefined,
): Promise<{ status: number; body: unknown }> {
  // Spin up a one-shot listener so we can use undici fetch against it
  // without pulling in supertest (saves a deps install).
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const headers: Record<string, string> = {};
        if (contentType !== undefined) headers["Content-Type"] = contentType;
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/cwv`, {
          method: "POST",
          headers,
          body,
        });
        const text = await res.text();
        let parsed: unknown = null;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }
        resolve({ status: res.status, body: parsed });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe("POST /api/cwv ingestion", () => {
  it("accepts application/json bodies (Blob path)", async () => {
    const app = buildApp();
    const res = await postRaw(app, JSON.stringify(VALID_SAMPLE), "application/json");
    expect(res.status).toBe(204);
  });

  it("accepts text/plain bodies (sendBeacon string default — defence in depth)", async () => {
    const app = buildApp();
    const res = await postRaw(app, JSON.stringify(VALID_SAMPLE), "text/plain;charset=UTF-8");
    expect(res.status).toBe(204);
  });

  it("accepts application/octet-stream bodies", async () => {
    const app = buildApp();
    const res = await postRaw(app, JSON.stringify(VALID_SAMPLE), "application/octet-stream");
    expect(res.status).toBe(204);
  });

  it("rejects malformed JSON with reason='malformed_json'", async () => {
    const app = buildApp();
    const res = await postRaw(app, "not json {", "text/plain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_cwv_sample",
      details: { reason: "malformed_json" },
    });
  });

  it("rejects empty body with reason='empty_body'", async () => {
    const app = buildApp();
    const res = await postRaw(app, "", "text/plain");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_cwv_sample",
      details: { reason: "empty_body" },
    });
  });

  it("rejects schema mismatch with reason='schema_mismatch'", async () => {
    const app = buildApp();
    const bad = { ...VALID_SAMPLE, name: "BOGUS" };
    const res = await postRaw(app, JSON.stringify(bad), "application/json");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_cwv_sample",
      details: { reason: "schema_mismatch" },
    });
  });

  it("rejects non-UUID-v4 sessionId", async () => {
    const app = buildApp();
    const bad = { ...VALID_SAMPLE, sessionId: "not-a-uuid" };
    const res = await postRaw(app, JSON.stringify(bad), "application/json");
    expect(res.status).toBe(400);
  });

  it("rejects negative metric value", async () => {
    const app = buildApp();
    const bad = { ...VALID_SAMPLE, value: -5 };
    const res = await postRaw(app, JSON.stringify(bad), "application/json");
    expect(res.status).toBe(400);
  });

  it("accepts CLS=0 (boundary, non-negative)", async () => {
    const app = buildApp();
    const sample = { ...VALID_SAMPLE, name: "CLS" as const, value: 0, rating: "good" as const };
    const res = await postRaw(app, JSON.stringify(sample), "application/json");
    expect(res.status).toBe(204);
  });
});
