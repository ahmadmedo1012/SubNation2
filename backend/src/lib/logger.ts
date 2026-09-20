import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Service/version binding - read once at process start (design §3.1.2)
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME === "worker" ? "worker" : "web";
const VERSION = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown";

/**
 * Structured log fields contract from design §4.2.
 * All fields are optional except service and version which are bound at process start.
 */
export interface StructuredLogFields {
  level: pino.Level;
  time: number;
  msg: string;
  requestId?: string; // from correlation context, REQUIRED inside request scope
  userId?: number;
  route?: string;
  latencyMs?: number;
  err?: pino.SerializedError;
  correlationId?: string; // alias of requestId for cross-system parity
  span?: string;
  trace?: string;
  service: "web" | "worker";
  version: string; // RENDER_GIT_COMMIT short SHA
  category?: "auth" | "worker" | "alerting" | "monitoring" | "cwv" | "seo";
}

/**
 * Pino redact configuration (F-012 + 93-A1 S7, round-93).
 *
 * THE one true list — exported so `lib/__tests__/logger-nested-redaction.test.ts`
 * builds its test logger from the ACTUAL production paths instead of a
 * hand-mirrored copy (the previous redaction test kept its own list "in
 * sync with lib/logger.ts" manually — a drift-shaped silent failure).
 *
 * Layers (why this shape):
 *
 *   1. Fixed top-level paths (F-012) — the historic allowlist.
 *   2. NESTED paths (93-A1 S7) — the audit proved the old
 *      "custom serializer that scans all fields" was a NO-OP (pino
 *      applies serializers per-key; a `custom` key only fires on a
 *      field literally named `custom`) while `redact.paths` — the real
 *      control — only covered TOP-LEVEL names. Real leak vectors:
 *      `logger.info({ body: req.body })` with `id_token` /
 *      `temp_token` / `link_consent_token` / `initData` / passwords,
 *      and fetch/axios error chains carrying
 *      `err.cause.config.headers.Authorization`. Those shapes are now
 *      explicit paths. fast-redact validates its input at construction
 *      — an invalid path would throw at boot, not fail silently.
 *   3. One-seep leading wildcards (`*.id_token`, …) catch the same
 *      names one level deeper under ANY top-level key (request.id_token,
 *      payload.temp_token …). No deeper wildcards: fast-redact does not
 *      support them, and blanket `body.*` would censor non-sensitive
 *      siblings.
 *
 * NOT covered (documented, accepted): arbitrary key names ("description"
 * holding a JWT) — the Sentry deepSanitize layer (lib/sentry.ts) has the
 * JWT-shape heuristic for that; pino-level scanning of every string in
 * every log line would cost more than the log pipeline itself.
 */
export const REDACT_PATHS: string[] = [
  // HTTP headers (pino-http / manual req-res logging)
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',

  // Passwords & secrets — top level
  "password",
  "password_hash",
  "passwordHash",
  "current_password",
  "new_password",
  "account_password",
  "accountPassword",

  // Tokens (every transport — explicit, NOT wildcards: fast-redact
  // does not support embedded `*` in paths. F-012 fix.)
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "auth_token",
  "admin_token",
  "session_token",

  // OTP
  "otp",
  "totp",
  "totp_secret",

  // Payment
  "card_number",
  "cvv",
  "sender_account",

  // PII
  "ssn",
  "national_id",

  // Signing material / API keys (explicit; the previous `*secret*`
  // wildcard was a no-op under fast-redact — F-012 audit finding).
  "secret",
  "session_secret",
  "encryption_key",
  "api_key",
  "apikey",
  "private_key",
  "firebase_service_account_json",
  "telegram_bot_token",

  // ── 93-A1 S7 (round-93): nested paths ────────────────────────────────
  // 2FA / link-consent / Mini App credentials riding a request body that
  // got logged (routes frequently do `logger.info({ body: req.body })`).
  "body.id_token",
  "body.token",
  "body.access_token",
  "body.refresh_token",
  "body.temp_token",
  "body.link_consent_token",
  "body.initData",
  "body.init_data",
  "body.password",
  "body.current_password",
  "body.new_password",
  "body.otp",
  "body.totp",
  "body.totp_secret",

  // pino-http request serializers embed the parsed body under req.body.
  "req.body.id_token",
  "req.body.token",
  "req.body.temp_token",
  "req.body.link_consent_token",
  "req.body.initData",
  "req.body.password",
  "req.body.current_password",
  "req.body.new_password",

  // Top-level flow-specific credentials (initData is replayable signed
  // identity material; temp_token is the 2FA half-session).
  "initData",
  "init_data",
  "temp_token",
  "link_consent_token",

  // fetch/axios error chains (axios: err.config.headers; wrapped errors:
  // err.cause.config.headers; case variants for both header spellings).
  "err.config.headers.authorization",
  "err.config.headers.Authorization",
  "err.cause.config.headers.authorization",
  "err.cause.config.headers.Authorization",
  "err.headers.authorization",
  "err.headers.Authorization",
  'err.response.headers["set-cookie"]',
  'err.cause.response.headers["set-cookie"]',

  // One-deep leading wildcards for the credential names above —
  // e.g. `payload.id_token`, `request.temp_token`, `auth.initData`.
  "*.id_token",
  "*.temp_token",
  "*.link_consent_token",
  "*.initData",
  "*.password",
  "*.current_password",
  "*.new_password",
  "*.totp_secret",
];

export const REDACT_CENSOR = "[REDACTED]";

// Create the base logger first (without serializers to avoid circular reference)
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Bind service and version at top-level so all children inherit (design §3.1.2)
  base: {
    service: SERVICE_NAME,
    version: VERSION,
  },
  redact: {
    paths: REDACT_PATHS,
    censor: REDACT_CENSOR,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Child logger factory that auto-binds correlation context from AsyncLocalStorage.
 * All convenience helpers (authLogger, workerLogger, etc.) use this internally.
 */
export function childLogger(bindings: Partial<StructuredLogFields>): pino.Logger {
  return baseLogger.child(bindings);
}

/**
 * Convenience helpers that auto-bind category and correlation context.
 * These use childLogger internally and inherit service/version from the base logger.
 */
export function authLogger(): pino.Logger {
  return childLogger({ category: "auth" });
}

export function workerLogger(): pino.Logger {
  return childLogger({ category: "worker" });
}

export function alertingLogger(): pino.Logger {
  return childLogger({ category: "alerting" });
}

export function cwvLogger(): pino.Logger {
  return childLogger({ category: "cwv" });
}

// 93-A1 S7 (round-93): the old `logger = baseLogger.child({}, { serializers:
// { custom: … } })` block is DELETED. pino applies each serializers entry
// ONLY to the log field whose name matches the serializer key — a
// serializer keyed `custom` never fired, yet its comment claimed it
// "scans the entire log object". That dead code was itself a finding
// (false redaction guarantees survive code review); the real control is
// the redact configuration above, now exported + nested-path-complete
// and pinned by lib/__tests__/logger-nested-redaction.test.ts.
export const logger = baseLogger.child({});
