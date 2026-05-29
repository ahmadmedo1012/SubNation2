import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
