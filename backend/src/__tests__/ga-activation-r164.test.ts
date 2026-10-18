import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * R164 — the GA4 activation pin.
 *
 * The operator's Google Analytics 4 measurement ID is PUBLIC, non-secret
 * config (it ships in the client bundle for every visitor by design), so
 * the repo — not the Coolify panel — is its source of truth: the Dockerfile
 * bakes it as the build-time default via the same shell `:-` fallback the
 * release identity (VITE_RELEASE_SHA) already uses. This suite pins the
 * activation's three load-bearing facts so a refactor cannot silently
 * strip them:
 *
 *   1. the fallback exists in the BUILD RUN (the one whose command chains
 *      the frontend vite build through the api-server build script) — a
 *      bare ARG default would NOT work: the Coolify build-args panel
 *      already carries the VITE_GA_TRACKING_ID key, and a panel key set
 *      to an EMPTY value overrides an ARG default with "" while the
 *      shell fallback fires on empty-or-unset (the whole point — see the
 *      Dockerfile's R164 comment block);
 *   2. the baked id has the shape the frontend loader accepts
 *      (G-/UA-/GTM- prefix, analytics.ts's gate — a typo'd id must not
 *      ship as a silent no-op default);
 *   3. the LOCAL compose path stays OUT of the production GA property
 *      (the "off" sentinel — rejected by the same loader gate, so local
 *      stacks never pollute the operator's data).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const dockerfile = readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
const compose = readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");

/** The frontend loader's accepted id shape (frontend/src/lib/analytics.ts). */
const LOADER_ID_RE = /^(G|UA|GTM)-[A-Z0-9-]+$/i;

describe("R164 — the GA4 activation pin (public build-time config)", () => {
  it("the build RUN carries VITE_GA_TRACKING_ID as a shell `:-` fallback with a real GA4-shaped id", () => {
    // The fallback form — not a bare ARG default (an empty Coolify panel
    // value would override an ARG default with "" and silently kill it).
    const fallback = dockerfile.match(
      /VITE_GA_TRACKING_ID="\$\{VITE_GA_TRACKING_ID:-(G-[A-Z0-9]+)\}"/,
    );
    expect(fallback).not.toBeNull();
    const id = fallback![1]!;
    // Shape-legal for the loader (a malformed baked default = silent no-op).
    expect(LOADER_ID_RE.test(id)).toBe(true);
    // The fallback line sits inside the RUN whose command is the api-server
    // build script — the one that chains the frontend vite build (the only
    // place a VITE_* value can reach the bundle).
    const runBlock = dockerfile.slice(dockerfile.indexOf("RUN VITE_GA_TRACKING_ID="));
    expect(runBlock).toContain("pnpm --filter @workspace/api-server run build");
  });

  it("exactly ONE baked default exists (no drifting second copy of the id)", () => {
    const matches = dockerfile.match(/G-RKRV3ZC3MF/g) ?? [];
    // One in the RUN fallback + the prose comments above it are ALLOWED to
    // name it; what must never happen is a SECOND mechanism (a duplicate
    // ARG default, an ENV line) — count only the executable forms.
    const executable = dockerfile
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#") && l.includes("G-RKRV3ZC3MF"));
    expect(executable).toHaveLength(1);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("the local compose path stays out of the production GA property (the off sentinel)", () => {
    expect(compose).toMatch(/VITE_GA_TRACKING_ID: \$\{VITE_GA_TRACKING_ID:-off\}/);
    // The sentinel must be rejected by the loader's shape gate — if a
    // future id shape ever makes "off" legal, the sentinel leaks.
    expect(LOADER_ID_RE.test("off")).toBe(false);
  });
});
