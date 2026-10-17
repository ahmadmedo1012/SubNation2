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
  },
});
