import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { initTestDb } from "../test/db";

/**
 * R126-L6 (A11-F2) — /products is NOT a 301 double hop.
 *
 * The product-art directory (frontend/public/products → dist/products)
 * made express.static directory-redirect the bare catalog-looking URL:
 * GET /products → 301 → /products/ (+1 RTT for every direct/external
 * hit; 302+301 from http). With `redirect: false` on the main static
 * mount, the directory miss falls through to the SPA fallback, which
 * serves the route DIRECTLY (the same shell /products/ already served).
 *
 * Pinned here through the real app composition (the spa-shell-rewrite
 * harness pattern — a STUB dist, this time WITH a products/ directory +
 * a file in it so the directory-redirect path is actually reachable):
 *
 *   • GET /products (no slash) answers 200 + the SPA shell — never a
 *     301 (asserted with redirect: "manual" so a regression shows the
 *     301 itself, not fetch's silent follow);
 *   • GET /products/<file> still serves the REAL file from the art
 *     directory (the mount change must not shadow actual art);
 *   • GET /products/ (slash — the old redirect target) keeps serving
 *     the same 200 shell.
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

const ART_BYTES = "STUB-WEBP-BYTES";

const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-static-redirect-"));
writeFileSync(path.join(stubDistDir, "index.html"), SPA_STUB_HTML);
// The collision source: a PHYSICAL products/ directory in the dist,
// exactly like frontend/public/products ships in the real build.
mkdirSync(path.join(stubDistDir, "products"));
writeFileSync(path.join(stubDistDir, "products", "stub-art.webp"), ART_BYTES);
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

/** fetch with redirect:"manual" — a directory 301 must SHOW as a 301,
 * not be silently followed into a 200. */
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

describe("static mount — /products is not a 301 double hop (A11-F2, R126-L6)", () => {
  it("GET /products (no slash) serves the SPA shell DIRECTLY — never a directory 301", async () => {
    const r = await getManual("/products");
    // The SPA fallback owns the bare path (200 shell — the same family
    // /products/ always served), not express.static's directory
    // redirect to /products/.
    expect(r.status).toBe(200);
    expect(r.location).toBeNull();
    expect(r.body).toContain("SUBNATION-SPA-SHELL-STUB");
    expect(r.contentType).toContain("text/html");
  });

  it("GET /products/<file> still serves the real art from the directory (the mount keeps serving files)", async () => {
    const r = await getManual("/products/stub-art.webp");
    expect(r.status).toBe(200);
    expect(r.body).toBe(ART_BYTES);
    expect(r.contentType).toContain("image/webp");
  });

  it("GET /products/ (the old redirect target) keeps serving the same 200 shell", async () => {
    const r = await getManual("/products/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("SUBNATION-SPA-SHELL-STUB");
  });
});
