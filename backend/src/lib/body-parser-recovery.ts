import type { ErrorRequestHandler } from "express";
import { logger } from "./logger";
import { bodyParseErrorsTotal, safeInc } from "./metrics";

/**
 * Defensive body-parser error handler.
 *
 * BACKGROUND
 * ----------
 * `express.json()` throws a `SyntaxError` when the incoming body
 * cannot be parsed (e.g. body is `email=user@x.com&password=...`
 * but the client sent `Content-Type: application/json`). By default
 * the error propagates and surfaces as a noisy 500 / 400 with stack
 * trace, which:
 *
 *   - Pollutes Sentry with non-actionable noise (most are bot
 *     probes hitting /api/auth/login with credential-stuffing
 *     payloads).
 *   - Creates loud red lines in production logs that mask real
 *     errors.
 *   - Returns a confusing response shape to legitimate misconfigured
 *     clients.
 *
 * BEHAVIOUR
 * ---------
 * Three-stage handling:
 *
 *   1. If the body looks like URL-encoded (matches /^[\w-]+=/),
 *      attempt a salvage parse via URLSearchParams. Catches
 *      misconfigured clients sending form data with wrong
 *      Content-Type. Re-attaches the parsed object to req.body
 *      and continues.
 *
 *   2. Otherwise return a clean 400 with a stable error code.
 *
 *   3. In all cases, increment `body_parse_errors_total{reason}`
 *      and log at warn level (not error). Sentry is NOT called —
 *      these are predominantly bot probes and legitimate client
 *      misconfigurations, neither actionable by on-call.
 *
 * Mounted in app.ts as Express error-middleware immediately after
 * the body parsers (express.json + express.urlencoded).
 */

interface BodyParseError extends SyntaxError {
  status?: number;
  statusCode?: number;
  type?: string;
  body?: string;
}

function isBodyParserError(err: unknown): err is BodyParseError {
  return (
    err instanceof SyntaxError &&
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof (err as BodyParseError).type === "string" &&
    (err as BodyParseError).type === "entity.parse.failed"
  );
}

const URLENCODED_RE = /^[\w%.\-+]+=/;

export const bodyParserRecovery: ErrorRequestHandler = (err, req, res, next) => {
  if (!isBodyParserError(err)) {
    return next(err);
  }

  const rawBody = err.body ?? "";

  // Salvage attempt: client sent form-urlencoded body with wrong
  // Content-Type. Try URLSearchParams.
  if (rawBody && URLENCODED_RE.test(rawBody.trim())) {
    try {
      const params = new URLSearchParams(rawBody);
      const recovered: Record<string, string> = {};
      for (const [k, v] of params) recovered[k] = v;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).body = recovered;

      safeInc(bodyParseErrorsTotal, { reason: "salvaged_urlencoded" });
      logger.warn(
        {
          category: "monitoring",
          path: req.path,
          method: req.method,
          contentType: req.headers["content-type"],
        },
        "[body-parse] salvaged URL-encoded body; client sent wrong Content-Type",
      );
      return next();
    } catch {
      // Fall through to clean-400 path.
    }
  }

  // Could not salvage. Return clean 400. No Sentry — overwhelmingly
  // bot-probe traffic.
  safeInc(bodyParseErrorsTotal, { reason: "invalid_json" });
  logger.warn(
    {
      category: "monitoring",
      path: req.path,
      method: req.method,
      contentType: req.headers["content-type"],
      bodyPreview: rawBody.slice(0, 80),
    },
    "[body-parse] rejected malformed body",
  );

  res.status(400).json({
    error: "بيانات الطلب غير صالحة",
    code: "INVALID_REQUEST_BODY",
  });
};
