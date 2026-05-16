import * as Sentry from "@sentry/node";
import { getCorrelationId } from "./correlation";

/**
 * Initialise Sentry for the SubNation backend.
 *
 * Phase 2 (R2.6, R2.15, R6.2) extensions over the original implementation:
 *   - `release` reads `RENDER_GIT_COMMIT[:7]` so source maps line up.
 *   - `tracesSampleRate` is 0.1 in production, 1.0 in development for
 *     debugging.
 *   - `beforeSend` injects the current `correlation_id` from
 *     AsyncLocalStorage as a tag on every event, so each Sentry issue can
 *     be cross-referenced against Pino logs and the response header.
 *   - The original cookie/auth-header redaction and health-check filter are
 *     preserved byte-for-byte.
 */
export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: (process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7),
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    beforeSend(event) {
      // Strip cookies / auth headers — preserves prior policy.
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }
      }
      // Filter out health-check noise.
      if (event.message?.includes("health") || event.request?.url?.includes("/health")) {
        return null;
      }
      // Attach correlation_id from AsyncLocalStorage if available. Calling
      // getCorrelationId() outside a request context returns undefined, in
      // which case we leave the tag off.
      const correlationId = getCorrelationId();
      if (correlationId) {
        event.tags = { ...(event.tags ?? {}), correlation_id: correlationId };
      }
      return event;
    },
  });
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  Sentry.captureMessage(message, { level });
}
