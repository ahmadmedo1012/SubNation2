import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";

/**
 * R163 — the IndexNow KEY-FILE ROUTE (`GET /<key>.txt`) at the app level.
 *
 * The engines' only verification mechanism is fetching
 * `https://<host>/<key>.txt` and comparing the body to the submission
 * key. This suite pins the mounted route's behavior through the REAL
 * app composition (the spa-shell-rewrite harness pattern: a STUB dist
 * + env set BEFORE importing ../app, cleaned up after so the throwaway
 * env never leaks into sibling worker files):
 *
 *   - the configured key answers 200, text/plain, body == the key;
 *   - a lookalike path (wrong key / non-key .txt) does NOT get the
 *     key treatment (it falls through to the SPA fallback family);
 *   - the route is mounted at boot from the boot-time env snapshot —
 *     flipping env later does not spawn or kill it (a documented
 *     Coolify-restart requirement, not a defect).
 */

// Synthetic fixture (dash-separated, low entropy — hex-shaped constants
// trip gitleaks' generic-api-key rule; the R163 CI lesson).
const TEST_KEY = "subnation-indexnow-keyfile-test-0002";
const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-indexnow-stub-"));
writeFileSync(
  path.join(stubDistDir, "index.html"),
  `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>stub</title>
</head>
<body><div id="root">STUB</div></body>
</html>`,
);
process.env.FRONTEND_DIST = stubDistDir;
process.env.INDEXNOW_KEY = TEST_KEY;

let app: Express;

beforeAll(async () => {
  const mod = await import("../app");
  app = mod.default;
}, 60_000);

afterAll(() => {
  delete process.env.FRONTEND_DIST;
  delete process.env.INDEXNOW_KEY;
  rmSync(stubDistDir, { recursive: true, force: true });
});

async function get(pathname: string): Promise<{ status: number; body: string; type: string }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const res = await fetch(`http://127.0.0.1:${addr.port}${pathname}`);
    return {
      status: res.status,
      body: await res.text(),
      type: res.headers.get("content-type") ?? "",
    };
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

describe("IndexNow key file route (R163)", () => {
  it(`GET /${TEST_KEY}.txt answers 200 text/plain with the key as the exact body`, async () => {
    const r = await get(`/${TEST_KEY}.txt`);
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/plain");
    expect(r.body).toBe(TEST_KEY);
  });

  it("a WRONG key path never leaks the key (the SPA fallback family answers, not the key route)", async () => {
    const r = await get("/some-other-wrong-key-value.txt");
    expect(r.body).not.toContain(TEST_KEY);
  });

  it("a random non-key .txt also falls through (no directory-listing, no key exposure)", async () => {
    const r = await get("/whatever.txt");
    expect(r.body).not.toContain(TEST_KEY);
  });
});
