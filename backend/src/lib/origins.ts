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
