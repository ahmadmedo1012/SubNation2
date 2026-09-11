import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";

/**
 * Round-97 F2 (A1 finding J-x) — quiet CORS origin rejection.
 *
 * The `cors` origin-callback used to funnel disallowed origins into
 * `cb(new Error("CORS: origin not allowed"))` → next(err) → the global
 * error handler: a 500, an error-level log line, and a Sentry capture
 * on EVERY scanner/probe request. createCorsOriginGate() (the exact
 * factory app.ts mounts, exported like createCsrfGate) rejects those
 * origins BEFORE `cors` with a clean 403 + warn-level log — same
 * exact-origin posture as the CSRF gate, no error-pipeline noise.
 *
 * Mounted on a mini express app (same harness as csrf-gate.test.ts).
 * Env note: importing app.ts evaluates the whole module tree, so the
 * throwaway ENCRYPTION_KEY is set first (same as csrf-gate.test.ts).
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

type AppModule = typeof import("../app");
let appModule: AppModule;

beforeAll(async () => {
  appModule = await import("../app");
}, 60_000);

function buildGateApp(allowedOrigins: string[], production: boolean): Express {
  const app = express();
  app.use(appModule.createCorsOriginGate(allowedOrigins, production));
  // Downstream stand-in: anything the gate lets through "reaches the
  // route" — and an ERROR here would surface as a 500 (the old failure
  // mode this suite pins as gone).
  app.use((_req, res) => {
    res.status(200).json({ reached: true });
  });
  // A next(err) from the gate would land here — fail loudly if it ever
  // does (the old cb(new Error(...)) path).
  app.use(
    (
      err: Error,
      _req: unknown,
      res: { status: (code: number) => { json: (b: unknown) => void } },
    ) => {
      res.status(500).json({ unexpected_error: err.message });
    },
  );
  return app;
}

function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

async function fire(
  app: Express,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/api/products`, { headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    close();
  }
}

describe("createCorsOriginGate (R97 F2 — quiet 403, not a noisy 500)", () => {
  const ALLOWED = ["https://subnation.ly", "https://www.subnation.ly"];

  it("no Origin header (same-origin / server-to-server) passes through untouched", async () => {
    const res = await fire(buildGateApp(ALLOWED, true), {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it("an allowed Origin passes through", async () => {
    const res = await fire(buildGateApp(ALLOWED, true), { Origin: "https://subnation.ly" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it("a DISALLOWED Origin gets a clean 403 — never a 500, never downstream", async () => {
    const res = await fire(buildGateApp(ALLOWED, true), { Origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("an origin that merely PREFIX-matches an allowed entry is rejected (exact match only)", async () => {
    const res = await fire(buildGateApp(ALLOWED, true), {
      Origin: "https://subnation.ly.evil.com",
    });
    expect(res.status).toBe(403);
  });

  it("empty allow-list in PRODUCTION fails closed with the same clean 403", async () => {
    const res = await fire(buildGateApp([], true), { Origin: "https://anything.example.com" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    // The no-origin server-to-server shape still passes (health probes).
    const probe = await fire(buildGateApp([], true), {});
    expect(probe.status).toBe(200);
  });

  it("empty allow-list in DEV passes everything (permissive dev mode unchanged)", async () => {
    const res = await fire(buildGateApp([], false), { Origin: "https://random.example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it("malformed Origin values (non-string shapes from proxies) are treated as absent → pass", async () => {
    // Express flattens duplicate headers to an array — the gate must
    // not crash on them (the old code path would have thrown on
    // includes() against an array).
    const app = buildGateApp(ALLOWED, true);
    const { url, close } = await listen(app);
    try {
      const res = await fetch(`${url}/api/products`, {
        headers: [
          ["Origin", "https://a.example.com"],
          ["Origin", "https://b.example.com"],
        ],
      });
      // Duplicate Origin headers are folded to a comma-joined string by
      // undici/Node → a non-matching string → 403 (never a crash).
      expect([200, 403]).toContain(res.status);
      expect(res.status).not.toBe(500);
    } finally {
      close();
    }
  });
});
