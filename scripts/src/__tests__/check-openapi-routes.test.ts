import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveImplementedOps } from "../../check-openapi-routes";

/**
 * R186 (I-F7) — the implemented-set resolver only walked `app.use(...)`
 * mounts, so app-level LEAF routes were invisible to the parity gate: the
 * real /category/productivity SEO 301 (app.ts) never appeared in the
 * implemented set, and a future app-level route could ship undocumented
 * with a green gate. resolveImplementedOps now records app-level leaves;
 * this fixture test pins that (and that the app.use walk still composes
 * with it) without touching the real backend tree.
 */

const fixtureDir = mkdtempSync(path.join(tmpdir(), "r186-parity-fixture-"));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixture(): { appPath: string; routesRoot: string } {
  const routesRoot = path.join(fixtureDir, "routes");
  mkdirSync(routesRoot, { recursive: true });
  // A canonical mounted router: the shape every real route file uses.
  writeFileSync(
    path.join(routesRoot, "probe.ts"),
    [
      'import { Router } from "express";',
      "const router = Router();",
      'router.get("/probe", (_req, res) => res.json({}));',
      "export { router as probeRouter };",
      "",
    ].join("\n"),
  );
  // The app-level shapes under test: one `app.use` mount + one bare
  // `app.get` leaf (the /category/productivity redirect's shape).
  const appPath = path.join(fixtureDir, "app.ts");
  writeFileSync(
    appPath,
    [
      'import { probeRouter } from "./routes/probe";',
      'app.use("/api", probeRouter);',
      'app.get("/api/probe-fixture", (_req, res) => res.redirect(301, "/"));',
      "",
    ].join("\n"),
  );
  return { appPath, routesRoot };
}

describe("resolveImplementedOps — app-level leaf routes (R186 I-F7)", () => {
  it('a parsed app-level leaf `app.get("/api/probe-fixture")` is reported in the implemented set', () => {
    const { appPath, routesRoot } = writeFixture();
    const ops = resolveImplementedOps(appPath, routesRoot);
    expect(ops.has("get /api/probe-fixture")).toBe(true);
  });

  it("the app.use mount walk still resolves its routers alongside the leaf (no regression)", () => {
    const { appPath, routesRoot } = writeFixture();
    const ops = resolveImplementedOps(appPath, routesRoot);
    expect(ops.has("get /api/probe")).toBe(true);
    // Both shapes land in ONE implemented set, keyed exactly once each.
    expect([...ops.keys()].sort()).toEqual(["get /api/probe", "get /api/probe-fixture"]);
  });

  it("a leaf registered on a NON-app receiver in app.ts is not recorded at the app root", () => {
    const routesRoot = path.join(fixtureDir, "empty-routes");
    mkdirSync(routesRoot, { recursive: true });
    const appPath = path.join(fixtureDir, "app-other-receiver.ts");
    writeFileSync(
      appPath,
      [
        "const other = {};",
        'other.get("/not-an-app-route", (_req, res) => res.json({}));',
        'app.get("/api/still-a-leaf", (_req, res) => res.json({}));',
        "",
      ].join("\n"),
    );
    const ops = resolveImplementedOps(appPath, routesRoot);
    expect(ops.has("get /api/still-a-leaf")).toBe(true);
    expect([...ops.keys()]).toHaveLength(1);
  });
});
