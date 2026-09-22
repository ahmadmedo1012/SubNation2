import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Round-3 (8-f §6): the hooks plugin was NOT installed — meaning
    // `exhaustive-deps` never ran and ~6 real missing-dependency effects
    // shipped silently (stale closures on navigate/fetchData). Warn
    // level (not error) so the existing codebase gates cleanly while
    // new code gets flagged in review.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/ruflo/**",
      "**/.claude-flow/**",
      "**/*.config.*",
      "**/generated/**",
      "frontend/src/components/ui/**",
      "frontend/public/sw.js",
      "backend/build.mjs",
    ],
  },
  {
    rules: {
      // Allow console.log in backend (pino uses it in dev)
      "no-console": "off",
      // Empty catch blocks are common in error-tolerant code
      "no-empty": ["error", { allowEmptyCatch: true }],
      // TypeScript: allow unused vars with _ prefix
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // no-explicit-any stays at WARN, not error (repo-wide, not just
      // route handlers): the codebase still carries ~20+ deliberate
      // `any` casts (drizzle tx/pool plumbing, test harness mocks).
      // Originally framed as "temporarily (Phase 2 will clean these)";
      // that cleanup never landed, so warn-without-gating CI is the
      // standing policy — new code still gets flagged in review.
      "@typescript-eslint/no-explicit-any": "warn",
      // Non-null assertions are common in Drizzle queries
      "@typescript-eslint/no-non-null-assertion": "off",
      // no-useless-assignment has many false positives with if/else chains
      "no-useless-assignment": "off",
    },
  },
  {
    // Service worker files use Web Worker globals
    files: ["**/sw.js", "**/sw.ts", "**/service-worker.*"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        fetchEvent: "readonly",
        ExtendableEvent: "readonly",
        ServiceWorkerGlobalScope: "readonly",
      },
    },
  },
);
