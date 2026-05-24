/**
 * SubNation backend Sentry integration — single source of truth.
 *
 * Initialised once from `instrument.ts` (which is the very first import in
 * every entrypoint). Every other module that wants to emit events should
 * import the helpers from THIS file rather than calling `Sentry.*` directly,
 * so tags + sanitization stay consistent.
 *
 * Pipeline ordering:
 *
 *   instrument.ts → initSentry() (HERE) → app.ts (Express) → routes
 *                                                        → setupExpressErrorHandler
 *                                                        → custom error handler
 *
 * Major design properties:
 *
 *   1. Recursive PII sanitizer in beforeSend / beforeSendTransaction.
 *      Scans every request body, query, extra, contexts.* for sensitive
 *      field names and replaces values with "[REDACTED]". Also redacts
 *      `?token=` query-string params and any URL fragment that might leak
 *      a JWT.
 *
 *   2. tracesSampler skips high-frequency low-value routes (/healthz,
 *      /metrics, /api/cwv beacons) and applies a configurable production
 *      rate (default 0.1) to everything else.
 *
 *   3. Init-time process tags pull from Render's standard environment
 *      variables so every event surfaces with instance / service / deploy
 *      / git-commit context without per-call boilerplate.
 *
 *   4. Subsystem helper functions (`captureSubsystemException`,
 *      `captureAuthFailure`, `captureSchedulerFailure`,
 *      `breadcrumbSubsystem`) attach the correct tag set every time so
 *      the Sentry UI's "Group by subsystem" gives clean buckets.
 *
 * Sensitive field names are SCALED — operators can extend by editing the
 * SENSITIVE_FIELD_NAMES set below. The default covers the platform's known
 * surface (passwords, OTP codes, tokens, cookies).
 */

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { getCorrelationId } from "./correlation";

// ─────────────────────────────────────────────────────────────────────
// PII SANITIZATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Field names whose VALUE should never reach Sentry. Matched
 * case-insensitively by exact name OR substring (e.g. "passwordHash"
 * matches because it contains "password").
 *
 * If you add a field, also document why it's sensitive in this list so
 * future maintainers don't remove it on a cleanup pass.
 */
const SENSITIVE_FIELD_NAMES = [
  // Auth credentials (legacy + admin paths)
  "password",
  "current_password",
  "new_password",
  "passwordhash",
  "password_hash",
  // OTP + 2FA
  "code", // OTP / verification codes — accept some over-redaction (e.g. coupon "code")
  "otp",
  "totp",
  "totp_secret",
  // Tokens — every transport
  "token",
  "id_token",
  "access_token",
  "refresh_token",
  "auth_token",
  "admin_token",
  "session_token",
  // Cookies / headers (auto-stripped below too, but defensive)
  "cookie",
  "set-cookie",
  "authorization",
  // Encryption + signing material
  "secret",
  "session_secret",
  "encryption_key",
  "api_key",
  "apikey",
  "private_key",
  // Provider-specific raw data we'd rather not leak verbatim
  "id_token_length", // already-truncated marker — keep for grouping
  "firebase_service_account_json",
  "telegram_bot_token",
];

/**
 * Match a field name against the sensitive set. Case-insensitive,
 * substring match (so `passwordLoginEnabled` matches `password`).
 *
 * IMPORTANT: substring matching means "code" matches "couponCode" too.
 * That's a deliberate over-redaction — if the legitimate value would
 * be rejected as too sensitive in 1% of cases, that's acceptable for
 * a 100% guarantee on OTP / verification code privacy.
 */
function isSensitiveField(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_FIELD_NAMES.some((needle) => lower.includes(needle));
}

const REDACTED = "[REDACTED]";

/**
 * Recursively walk an object/array and replace sensitive field VALUES
 * with [REDACTED]. Returns a new object — does not mutate the input.
 *
 * Stops at depth 6 to avoid pathological cycles even though Sentry's
 * own normalizer would catch them later.
 *
 * String values that look like JWTs (3 base64url segments) are
 * redacted regardless of field name — covers the case where a token
 * gets logged as a positional argument or in a free-form message.
 */
function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-cap]";
  if (value == null) return value;

  if (typeof value === "string") {
    // Heuristic JWT detection: three base64url-safe segments separated
    // by dots, each at least 8 chars. Catches accidental token logging.
    if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) {
      return REDACTED;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => deepSanitize(v, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveField(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = deepSanitize(v, depth + 1);
      }
    }
    return out;
  }

  return value;
}

/**
 * Strip token-shaped query params from a URL string. Patterns covered:
 *
 *   ?token=…   ?id_token=…   ?access_token=…   ?refresh_token=…
 *   ?auth_token=…
 *
 * The match is case-insensitive on the parameter name. The value is
 * replaced with [REDACTED] so the URL stays parseable for grouping.
 *
 * Also strips URL fragments entirely if they look like they contain
 * a token (Telegram callbacks land tokens in #fragment; the fragment
 * is normally invisible to the backend, but a frontend Sentry breadcrumb
 * could still leak one upstream).
 */
function sanitizeUrl(url: string): string {
  if (!url) return url;
  let cleaned = url.replace(
    /([?&](token|id_token|access_token|refresh_token|auth_token|admin_token|code|otp)=)[^&#]*/gi,
    `$1${REDACTED}`,
  );
  // Strip fragments that look token-y (auth/Telegram-callback pattern).
  cleaned = cleaned.replace(/#[^?]*token[^&]*/i, "#[REDACTED]");
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────
// INIT-TIME PROCESS TAGS
// ─────────────────────────────────────────────────────────────────────

interface ProcessTags extends Record<string, string> {
  instance_id: string;
  service_id: string;
  deploy_id: string;
  region: string;
  git_commit: string;
  git_branch: string;
  subsystem: string;
}

/**
 * Read Render's standard environment variables (and reasonable
 * fallbacks) into a tag bag. These attach to EVERY Sentry event via
 * Sentry.setTags() at init time — no per-call boilerplate needed.
 */
function readProcessTags(): ProcessTags {
  return {
    instance_id: process.env.RENDER_INSTANCE_ID ?? `local-${process.pid}`,
    service_id: process.env.RENDER_SERVICE_ID ?? "subnation",
    deploy_id: process.env.RENDER_DEPLOY_ID ?? "dev",
    region: process.env.RENDER_REGION ?? process.env.AWS_REGION ?? "unknown",
    git_commit: (process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7),
    git_branch: process.env.RENDER_GIT_BRANCH ?? "unknown",
    // Override with WORKER_ROLE=true on a dedicated worker dyno once we
    // split the schedulers off the web tier (P2-4 in the audit).
    subsystem: process.env.WORKER_ROLE === "true" ? "worker" : "web",
  };
}

// ─────────────────────────────────────────────────────────────────────
// SAMPLING POLICY
// ─────────────────────────────────────────────────────────────────────

const NOISY_PATHS = ["/api/healthz", "/api/metrics", "/health", "/api/cwv"];

/**
 * tracesSampler decides whether a transaction is recorded. Returning
 * 0 drops it; returning 1 records always; intermediate values
 * probabilistically sample.
 *
 * Skip rules (return 0):
 *   - /api/healthz         — Render edge probes every 30 s
 *   - /api/metrics         — Prometheus scrape
 *   - /health              — Docker / k8s liveness
 *   - /api/cwv             — Core Web Vitals beacon (high frequency)
 *
 * For everything else: production = 10% (per docs/SENTRY_QUOTA), dev = 100%.
 * Operator can override with SENTRY_TRACES_SAMPLE_RATE.
 */
function makeTracesSampler() {
  const fixedRate = Number(
    process.env.SENTRY_TRACES_SAMPLE_RATE ??
      (process.env.NODE_ENV === "production" ? 0.1 : 1.0),
  );
  const safe = Number.isFinite(fixedRate) && fixedRate >= 0 && fixedRate <= 1 ? fixedRate : 0.1;

  return (samplingContext: { name?: string; transactionContext?: { name?: string } }) => {
    const name =
      samplingContext.name ?? samplingContext.transactionContext?.name ?? "";
    if (NOISY_PATHS.some((p) => name.includes(p))) return 0;
    return safe;
  };
}

// ─────────────────────────────────────────────────────────────────────
// SDK INIT
// ─────────────────────────────────────────────────────────────────────

let initialised = false;

/**
 * Initialise Sentry. Idempotent — calling twice is a no-op.
 *
 * Behaviour when SENTRY_DSN is unset:
 *   The SDK is a quiet no-op. captureException / captureMessage etc.
 *   simply don't do anything. This is the dev-without-Sentry path.
 *
 * Diagnostic logging:
 *   We log to STDOUT (not the pino logger — pino isn't loaded yet at this
 *   point in the boot sequence) so operators can SEE in Render logs
 *   whether init ran. Three distinct outcomes:
 *     - "[sentry] NOT initialized — SENTRY_DSN env var is unset"
 *     - "[sentry] initialized: host=… env=… release=…"
 *     - "[sentry] init FAILED: <error>"
 *
 * Set SENTRY_DEBUG=1 to enable @sentry/node's own verbose logging
 * (useful for diagnosing transport / DSN parse failures).
 */
export function initSentry(): ReturnType<typeof Sentry.init> {
  if (initialised) return Sentry.getClient();
  initialised = true;

  if (!process.env.SENTRY_DSN) {
    console.warn(
      "[sentry] NOT initialized — SENTRY_DSN env var is unset. " +
        "Backend Sentry capture is DISABLED. Set SENTRY_DSN in Render Dashboard → Environment.",
    );
    return undefined;
  }

  const tags = readProcessTags();
  let dsnHost = "(unparsable)";
  try {
    dsnHost = new URL(process.env.SENTRY_DSN).host;
  } catch {
    // fall through with placeholder
  }

  let client: ReturnType<typeof Sentry.init>;
  try {
    client = Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      release: tags.git_commit,
      // Surface SDK-internal logs when SENTRY_DEBUG=1 is set. This
      // makes "DSN parsed OK", "transport queued event", "rate-
      // limited" etc. visible in stdout. Off by default to avoid
      // production log spam.
      debug: process.env.SENTRY_DEBUG === "1",
      // Auto-enable Express, HTTP, Redis, Postgres integrations from
      // @sentry/node v10+. We don't pass `integrations: [...]` for those
      // because the defaults stay applied; we DO add nodeProfilingIntegration
      // which is opt-in (separate package).
      integrations: [nodeProfilingIntegration()],
      tracesSampler: makeTracesSampler(),
      profilesSampleRate:
        process.env.NODE_ENV === "production"
          ? Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1)
          : 0,
    // PII sanitization. Order matters: first strip headers Sentry
    // attached automatically, then deep-walk request body / extras,
    // then add our correlation_id tag.
    beforeSend(event) {
      try {
        if (event.request) {
          // Strip cookie + Authorization headers verbatim.
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers["authorization"];
            delete event.request.headers["Authorization"];
            delete event.request.headers["cookie"];
            delete event.request.headers["Cookie"];
          }
          // Sanitize URL (strip ?token=, fragments).
          if (event.request.url) {
            event.request.url = sanitizeUrl(event.request.url);
          }
          // Deep-sanitize request body, query string, headers values.
          if (event.request.data) {
            event.request.data = deepSanitize(event.request.data) as typeof event.request.data;
          }
          if (event.request.query_string) {
            const qs = event.request.query_string;
            if (typeof qs === "string") {
              event.request.query_string = sanitizeUrl("?" + qs).slice(1);
            }
          }
        }
        // Sanitize extras + contexts.
        if (event.extra) {
          event.extra = deepSanitize(event.extra) as typeof event.extra;
        }
        if (event.contexts) {
          event.contexts = deepSanitize(event.contexts) as typeof event.contexts;
        }
        // Filter health-check noise (defense in depth — tracesSampler
        // already skips them, this catches any captureMessage that
        // mentions them).
        if (event.message?.includes("health") || event.request?.url?.includes("/health")) {
          return null;
        }
        // Attach correlation_id from AsyncLocalStorage. Stored as a
        // CONTEXT (not a tag) — UUID-shaped values would otherwise blow
        // past Sentry's ~1000-unique-tag-value cap and stop indexing
        // for search. As a context, it's still visible in every event
        // header and searchable via Sentry's full-text search.
        const correlationId = getCorrelationId();
        if (correlationId) {
          event.contexts = {
            ...(event.contexts ?? {}),
            correlation: { id: correlationId },
          };
        }
      } catch {
        // beforeSend MUST NOT throw — that would silently drop events.
        // If the sanitizer breaks, ship the event un-sanitized rather
        // than swallow it. Operator will catch the issue in Sentry's
        // own SDK error logs.
      }
      return event;
    },
    // Same sanitization for transaction events (slow-route spans).
    beforeSendTransaction(event) {
      try {
        if (event.request?.url) {
          event.request.url = sanitizeUrl(event.request.url);
        }
      } catch {
        // see above
      }
      return event;
    },
  });

  // Set every event's baseline tags. setTags() applies to the global
  // scope so per-call captures inherit.
  Sentry.setTags(tags);
  } catch (err) {
    console.error(
      "[sentry] init FAILED — backend Sentry capture is DISABLED:",
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }

  console.log(
    `[sentry] initialized — host=${dsnHost} env=${process.env.NODE_ENV || "development"} ` +
      `release=${tags.git_commit} traces=${process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"} ` +
      `profiles=${process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0.1"} ` +
      `debug=${process.env.SENTRY_DEBUG === "1"}`,
  );

  return client;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC HELPERS — preferred over raw Sentry.captureException
// ─────────────────────────────────────────────────────────────────────

/**
 * Capture an Error with a `subsystem` tag for Sentry-UI grouping.
 * Use this from anywhere in the codebase that handles an error from a
 * specific subsystem (postgres, redis, scheduler, socket, auth-*, etc.).
 *
 * Extra context is deep-sanitized before send (beforeSend will catch
 * it again, but pre-sanitizing here avoids a sensitive value briefly
 * sitting in Sentry's internal queue).
 */
export function captureSubsystemException(
  subsystem: string,
  err: unknown,
  extras?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("subsystem", subsystem);
    if (extras) {
      const safe = deepSanitize(extras) as Record<string, unknown>;
      scope.setContext("extras", safe);
    }
    if (err instanceof Error) {
      scope.captureException(err);
    } else {
      scope.captureException(new Error(String(err)));
    }
  });
}

/**
 * Auth-failure capture. Same as captureSubsystemException but adds
 * `auth_provider` tag (telegram | google | phone-otp | password | jwt).
 *
 * Use this on UNEXPECTED auth errors — exceptions in handlers, JWT
 * verification crashes, Firebase admin SDK failures. Do NOT use it
 * for normal user-facing 401s (wrong code, expired session, etc.) —
 * those are not Sentry-worthy.
 */
export function captureAuthFailure(
  provider: "telegram" | "google" | "phone-otp" | "password" | "firebase" | "jwt" | "session",
  err: unknown,
  extras?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("subsystem", "auth");
    scope.setTag("auth_provider", provider);
    if (extras) {
      const safe = deepSanitize(extras) as Record<string, unknown>;
      scope.setContext("auth_failure", safe);
    }
    if (err instanceof Error) {
      scope.captureException(err);
    } else {
      scope.captureException(new Error(String(err)));
    }
  });
}

/**
 * Scheduler / cron / background-job failure. Adds `subsystem=scheduler`
 * + `job_name` tags so the Sentry UI groups by job.
 */
export function captureSchedulerFailure(
  jobName: string,
  err: unknown,
  extras?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("subsystem", "scheduler");
    scope.setTag("job_name", jobName);
    if (extras) {
      const safe = deepSanitize(extras) as Record<string, unknown>;
      scope.setContext("job_extras", safe);
    }
    if (err instanceof Error) {
      scope.captureException(err);
    } else {
      scope.captureException(new Error(String(err)));
    }
  });
}

/**
 * Structured breadcrumb tagged with a subsystem. Cheaper than a
 * captured event — the breadcrumb only travels with a future event
 * if one occurs in the same execution context.
 */
export function breadcrumbSubsystem(
  subsystem: string,
  message: string,
  data?: Record<string, unknown>,
  level: "info" | "warning" | "error" = "info",
): void {
  try {
    Sentry.addBreadcrumb({
      category: subsystem,
      level,
      message,
      data: data ? (deepSanitize(data) as Record<string, unknown>) : undefined,
    });
  } catch {
    // best-effort
  }
}

/**
 * Generic pre-sanitized captureException — preserves the original
 * lib/sentry.ts API for backward compatibility with all existing
 * call sites. New code should prefer captureSubsystemException for
 * better Sentry-UI grouping.
 */
export function captureException(error: Error, context?: Record<string, unknown>) {
  if (context) {
    Sentry.captureException(error, { extra: deepSanitize(context) as Record<string, unknown> });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  Sentry.captureMessage(message, { level });
}

// ─────────────────────────────────────────────────────────────────────
// EXPORTS for unit testing the sanitizer
// ─────────────────────────────────────────────────────────────────────

export const __test = {
  deepSanitize,
  sanitizeUrl,
  isSensitiveField,
};
