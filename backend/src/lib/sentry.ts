import * as Sentry from "@sentry/node";

export function initSentry() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      release: process.env.RENDER_GIT_COMMIT || "unknown",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
      profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
      beforeSend(event, hint) {
        // Filter out sensitive data
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers["authorization"];
            delete event.request.headers["cookie"];
          }
        }
        // Filter out health check errors
        if (event.message?.includes("health") || event.request?.url?.includes("/health")) {
          return null;
        }
        return event;
      },
    });
  }
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, {
    extra: context,
  });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  Sentry.captureMessage(message, {
    level,
  });
}
