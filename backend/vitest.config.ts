import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // R180: vitest 5 flips clearMocks' default to true, which would wipe
    // mock call-history recorded in beforeAll (40 suites here do exactly
    // that). Pin the v4 semantics; adopting the new default is its own
    // test-by-test round, not a toolchain-upgrade side effect.
    clearMocks: false,
    // Round-93 A10: synthetic env bootstrap (runs once, before any module
    // import) so the DB-less suite boots locally exactly like CI — see
    // src/test/env.ts. Tests that exercise fail-fast paths delete the vars
    // themselves and vi.resetModules().
    setupFiles: [path.resolve(__dirname, "src/test/env.ts")],
    // Redirect the `@workspace/db` entry (which opens a Neon pg.Pool at import
    // time) to the in-process pglite harness, so NO test can reach production.
    // `@workspace/db/schema` is intentionally NOT aliased — it is pure table
    // definitions with no DB connection, and the harness re-exports it.
    alias: [
      {
        find: /^@workspace\/db$/,
        replacement: path.resolve(__dirname, "src/test/db.ts"),
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // R136 (TST-2): scope the report to the source tree. In vitest 4 a
      // file that no test ever imports only enters the report when an
      // explicit `include` exists — with it, the report (and any
      // thresholds below) measures the whole src surface, not just the
      // subset the suite happens to load. Code files only: the tree is
      // pure .ts.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.config.ts",
        "src/test/**",
        "migrate.ts",
        "server.ts",
      ],
    },
  },
});
