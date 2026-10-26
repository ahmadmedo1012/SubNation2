import { defineConfig } from "vitest/config";

/**
 * Vitest config for the scripts workspace (R162-B). Mirrors the
 * backend's minimal node-environment style (backend/vitest.config.ts):
 * no aliases, no setup files — the pure helpers under src/ (seo-join)
 * need no DB and no DOM. A test here must never import @workspace/db.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // R180: vitest 5 flips clearMocks' default to true. Pin the v4
    // semantics this suite was written under (mirrors backend config).
    clearMocks: false,
    // R188-7 (E-F2): 10 s like the backend/frontend pins — never ride the
    // 5 s default the R187 CI round-1 timeout burned.
    testTimeout: 10_000,
  },
});
