import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { initTestDb } from "../test/db";

/**
 * R128 (B2-F2) — /assets/* misses are 404, never the soft-200 SPA shell.
 *
 * express.static answers only files it FINDS; a missing hashed asset
 * (e.g. /assets/index-deadbeef.js from a stale index or a scanner probe)
 * used to fall through both static mounts to the SPA fallback and get
 * 200 + text/html index.html. Live probe 2026-10-10: /assets/missing →
 * 200 HTML. Pinned here through the real app composition (the
 * spa-static-products-redirect harness pattern — a STUB dist WITH an
 * assets/ directory + a real file so the static mount is actually
 * reachable):
 *
 *   • GET /assets/<real file> serves the REAL file (the 404 guard must
 *     not shadow the mount — it only owns the fall-through);
 *   • GET /assets/<missing> answers 404 text/plain — NOT the shell
 *     (asserted via redirect: "manual" AND a body check so a regression
 *     shows the soft-200 itself);
 *   • GET /assets (bare, no slash) also 404s — it is not an HTML route;
 *   • the guard is scoped: a NON-assets unknown path (/nope) still gets
 *     the SPA shell 200 (the client 404 owns that UX).
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

const SPA_STUB_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>SubNation — سوق الاشتراكات الرقمية</title>
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://subnation.ly/">
</head>
<body><div id="root">SUBNATION-SPA-SHELL-STUB</div></body>
</html>`;

const ASSET_BYTES = "// STUB-HASHED-ASSET-BYTES";

const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-assets-404-"));
writeFileSync(path.join(stubDistDir, "index.html"), SPA_STUB_HTML);
// The real mount target: a PHYSICAL assets/ directory with one file,
// exactly like the Vite build ships (dist/public/assets/*).
mkdirSync(path.join(stubDistDir, "assets"));
writeFileSync(path.join(stubDistDir, "assets", "index-stub123.js"), ASSET_BYTES);
// Must be set before the dynamic import below — app.ts resolves the dist
// directory at module load.
process.env.FRONTEND_DIST = stubDistDir;

let realApp: Express;

beforeAll(async () => {
  await initTestDb();
  realApp = (await import("../app")).default;
}, 60_000);

afterAll(() => {
  delete process.env.FRONTEND_DIST;
  rmSync(stubDistDir, { recursive: true, force: true });
});

interface ManualResponse {
  status: number;
  location: string | null;
  body: string;
  contentType: string;
}

/** fetch with redirect:"manual" — same harness contract as the
 * spa-static-products-redirect suite (a redirect or soft-200 must SHOW
 * itself, never be silently followed). */
async function getManual(pathname: string): Promise<ManualResponse> {
  return new Promise((resolve, reject) => {
    const server = realApp.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${pathname}`, {
          redirect: "manual",
        });
        resolve({
          status: res.status,
          location: res.headers.get("location"),
          body: await res.text(),
          contentType: res.headers.get("content-type") ?? "",
        });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe("R128 B2-F2: /assets misses 404 (no soft-200 SPA shell)", () => {
  it("serves the REAL file for a present hashed asset (mount not shadowed)", async () => {
    const r = await getManual("/assets/index-stub123.js");
    expect(r.status).toBe(200);
    expect(r.body).toBe(ASSET_BYTES);
  });

  it("answers 404 text/plain for a MISSING hashed asset — never the shell", async () => {
    const r = await getManual("/assets/index-does-not-exist.js");
    expect(r.status).toBe(404);
    expect(r.contentType).toContain("text/plain");
    expect(r.body).toBe("Not Found");
    expect(r.body).not.toContain("SUBNATION-SPA-SHELL-STUB");
  });

  it("answers 404 for the bare /assets directory path too", async () => {
    const r = await getManual("/assets");
    expect(r.status).toBe(404);
  });

  it("keeps the SPA shell 200 for non-assets unknown paths (client 404 UX)", async () => {
    const r = await getManual("/nope-not-a-route");
    expect(r.status).toBe(200);
    expect(r.body).toContain("SUBNATION-SPA-SHELL-STUB");
    expect(r.contentType).toContain("text/html");
  });
});
