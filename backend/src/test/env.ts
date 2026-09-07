/**
 * Round-93 C3/A10 — vitest env bootstrap.
 *
 * Previously the backend suite only passed inside CI: jwt.ts / env.ts
 * throw at module load when SESSION_SECRET & friends are unset, and those
 * variables existed ONLY in .github/workflows/ci.yml — a local
 * `vitest run` failed 23 files at import with "SESSION_SECRET environment
 * variable is required". The suite is DB-less by design (the
 * `@workspace/db` alias swaps in PGlite), so these are purely synthetic
 * values: they unlock module evaluation and are then overridden per-test
 * by the suites that exercise the fail-fast paths (those tests delete the
 * var and vi.resetModules() before re-importing — the defaults set here
 * do not interfere because this file runs exactly once, before any test).
 *
 * Values mirror ci.yml exactly so local runs behave like CI runs.
 */

const SYNTHETIC: Record<string, string> = {
  DATABASE_URL: "postgres://ci:ci@localhost/ci",
  // 32+ chars — jwt.ts rejects shorter secrets at module load.
  SESSION_SECRET: "ci-test-secret-not-real-do-not-use-in-prod",
  // Distinct 32+ char value — F-001 requires ADMIN_JWT_SECRET != SESSION_SECRET.
  ADMIN_JWT_SECRET: "ci-test-admin-secret-not-real-do-not-use",
  // 32-byte hex (64 chars) — encryption.ts validates the exact length.
  ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  // Quiets the husky `prepare` script that runs on `pnpm install`.
  HUSKY: "0",
};

for (const [key, value] of Object.entries(SYNTHETIC)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

export {};
