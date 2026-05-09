import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
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
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Allow any in route handlers temporarily (Phase 2 will clean these)
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
