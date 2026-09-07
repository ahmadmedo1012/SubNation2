import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
