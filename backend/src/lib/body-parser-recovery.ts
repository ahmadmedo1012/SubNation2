import type { ErrorRequestHandler } from "express";
import { ErrorCode } from "@workspace/error-codes";
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
  // E-2 (R142): the raw preview could carry plaintext credentials inside
  // the malformed body (`{"password":"hunter2",` — a truncated body on a
  // flaky mobile network is the legitimate case). pino's REDACT_PATHS
  // redacts object FIELDS, never substrings inside a string, so the
  // preview bypassed the whole redaction design. Length only —
  // path/method/content-type already identify the probe.
  logger.warn(
    {
      category: "monitoring",
      path: req.path,
      method: req.method,
      contentType: req.headers["content-type"],
      bodyLength: rawBody.length,
    },
    "[body-parse] rejected malformed body",
  );

  // R134 (A1-F1): the code rides the SHARED ErrorCode enum — this was
  // the one envelope emitting an unregistered literal, so the
  // enum-exhaustiveness contract (frontend maps every code; @workspace/
  // error-codes is the single source) was broken. The global handler
  // (app.ts) answers the same malformed-JSON class with INVALID_DATA —
  // this branch now agrees, so clients see ONE code for the class.
  res.status(400).json({
    error: "بيانات الطلب غير صالحة",
    code: ErrorCode.INVALID_DATA,
  });
};
