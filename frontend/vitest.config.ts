import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the SubNation frontend.
 *
 * Mirrors the backend's vitest setup style (backend/vitest.config.ts):
 * a single config file, globals on, JSDOM environment for component
 * tests, and a setup file that registers @testing-library matchers +
 * cleans up DOM between tests.
 *
 * IMPORTANT: this config is INTENTIONALLY separate from vite.config.ts.
 * The Vite build config carries plugins (Sentry, PWA, font preload,
 * bundle-budget) that are irrelevant — and sometimes broken — under
 * the test runner. Keeping the test config small means a vite plugin
 * regression cannot break the test suite.
 *
 * Alias mirroring: `@/` resolves to `src/` exactly as in vite.config.ts
 * so test files can use the same import paths the production code uses.
 *
 * Workspace alias: `@workspace/api-client-react` is mocked per-test via
 * vi.mock() rather than aliased here. Page tests depend on different
 * subsets of the generated client and benefit from explicit mocks; a
 * blanket alias would force every test to load the real client and pull
 * in MSW or similar to intercept calls.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Component tests can be slower than backend pglite tests under
    // jsdom — give them a generous default but cap so a hung test
    // doesn't hang CI indefinitely.
    testTimeout: 10_000,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.{ts,tsx}",
        "**/*.config.ts",
        "src/test/**",
        "src/main.tsx",
        "src/instrument.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
});
