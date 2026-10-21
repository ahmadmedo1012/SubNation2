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
  // Page-level component tests render real page modules (orders.tsx,
  // loyalty.tsx, …) which — like the whole app — rely on the AUTOMATIC
  // JSX runtime and never import React. Without an explicit esbuild jsx
  // setting here, tsconfig's `"jsx": "preserve"` makes esbuild fall
  // back to the classic runtime (React.createElement) and every page
  // render dies with "React is not defined". The app build gets its
  // automatic runtime from @vitejs/plugin-react in vite.config.ts; the
  // plugin-free test config states it explicitly instead. Existing
  // classic-style test files keep working — an explicit React import is
  // simply unused under the automatic runtime.
  // R180 (vite 8 / Oxc): the automatic JSX runtime now rides the Oxc
  // transform — the vitest-4-era `esbuild: { jsx: "automatic" }` form is
  // auto-converted with a deprecation warning; state the native v5 form
  // explicitly. Why this exists at all is unchanged: tsconfig's "jsx":
  // "preserve" makes a classic-runtime fallback kill every page render
  // with "React is not defined"; the plugin-free test config states the
  // automatic runtime explicitly instead.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    globals: true,
    environment: "jsdom",
    // R180: vitest 5 flips clearMocks' default to true — mock call-history
    // recorded in beforeAll (the pattern this suite leans on) would be
    // wiped. Pin the v4 semantics (mirrors the backend config).
    clearMocks: false,
    setupFiles: ["./src/test/setup.ts"],
    // Component tests can be slower than backend pglite tests under
    // jsdom — give them a generous default but cap so a hung test
    // doesn't hang CI indefinitely.
    testTimeout: 10_000,
    // R128-IMP-4 (B5-5 / §4.1): *.spec.{ts,tsx} joins the include — the old
    // test-only glob left a spec-named file under src/ TYPECHECKED (the
    // tsconfig gate covers src/**/*) but NEVER EXECUTED: silently green
    // by absence. Backend vitest has no custom include (its default
    // catches both); the frontend now matches with an explicit widened
    // glob. Verified 0 *.spec.* files exist under src/ today — the
    // widening is a latent-hole closure, not a suite-shape change.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // R136 (TST-2): mirror of the backend scope — src code files only.
      // `include` is what makes vitest 4 report files no test imports (at
      // 0%), so the report measures the whole src surface; .d.ts carries
      // no runtime code and stays out alongside tests/configs/entries.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.{test,spec}.{ts,tsx}",
        "**/*.config.ts",
        "**/*.d.ts",
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
