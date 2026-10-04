import { logger } from "./logger";

/**
 * Parse the browser origins trusted by CORS, CSRF and Socket.IO.
 *
 * APP_ORIGINS remains the primary setting for existing deployments. The
 * additional FRONTEND_ORIGINS / VERCEL_FRONTEND_ORIGIN settings let a
 * separately hosted Vercel frontend be added without weakening the allowlist
 * or forcing a rewrite of the existing Render configuration.
 */
export function getConfiguredOrigins(): string[] {
  return Array.from(
    new Set(
      [process.env.APP_ORIGINS, process.env.FRONTEND_ORIGINS, process.env.VERCEL_FRONTEND_ORIGIN]
        .filter(Boolean)
        .flatMap((value) => (value ?? "").split(","))
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    ),
  );
}

/**
 * A7-2 (R116): boot-time hygiene warn on split-era origin env vars.
 *
 * The Coolify/Docker deployment fronts the SPA and the API on ONE origin
 * (APP_ORIGINS + the reverse-proxy rewrite — see
 * docs/deployment/COOLIFY_ORACLE_MIGRATION.md); VERCEL_FRONTEND_ORIGIN /
 * FRONTEND_ORIGINS belong to the retired Render/Vercel split stack. They
 * are still honored for rollback compatibility, but an operator copying
 * an old env block re-arms the cross-origin cookie class silently — so
 * boot says so, once, naming only the VAR NAMES (never secret values).
 *
 * Called from app.ts module scope (process boot — web + worker share it
 * via their app import). A warn, never a throw: a genuinely-live second
 * browser origin is a legal (if rare) configuration.
 */
export function warnLegacySplitOriginEnvAtBoot(): void {
  const splitEraVars = [
    { name: "VERCEL_FRONTEND_ORIGIN", value: process.env.VERCEL_FRONTEND_ORIGIN },
    { name: "FRONTEND_ORIGINS", value: process.env.FRONTEND_ORIGINS },
  ].filter((v) => typeof v.value === "string" && v.value.trim().length > 0);
  if (splitEraVars.length === 0) return;
  const hasAppOrigins = (process.env.APP_ORIGINS ?? "").trim().length > 0;
  logger.warn(
    {
      category: "deployment",
      splitEraVars: splitEraVars.map((v) => v.name),
      hasAppOrigins,
    },
    "[origins] split-era origin env vars are set alongside the single-origin shape — their values are folded into the CORS/CSRF/Socket.IO allowlist. " +
      "The Coolify deployment fronts the SPA and API on ONE origin (APP_ORIGINS); " +
      "VERCEL_FRONTEND_ORIGIN / FRONTEND_ORIGINS belong to the retired Render/Vercel split stack. " +
      "Remove them unless a second browser origin is genuinely live.",
  );
}
