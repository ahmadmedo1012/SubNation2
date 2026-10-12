import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ErrorCode, createErrorResponse } from "./errors";
import { logger } from "./logger";

/**
 * R136 (app.ts decomposition): zodIssuesToClient + the global error handler
 * moved here VERBATIM from app.ts (:1778-1849). Sentry's
 * setupExpressErrorHandler(app) stays in app.ts (it needs the app object);
 * app.ts mounts `globalErrorHandler` as the final middleware — same order,
 * same behavior.
 */

/**
 * R120-B3 (A8-F3): map a zod issue array to the MINIMAL client shape —
 * `{ path, code }` pairs only. The full issues (messages, received
 * values) are implementation detail: they used to ride the 400 body
 * verbatim and leak parser internals to any client. The complete detail
 * still reaches operators through the global error handler's
 * `logger.error({ err, … })` line. Exported for the 400-shape regression
 * test (no live route bubbles a ZodError today — every route safeParse's
 * and answers its own 400 — so the branch is pinned at unit level).
 */
export function zodIssuesToClient(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>,
): Array<{ path: string; code: string }> {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    code: issue.code,
  }));
}

// ── Global error handler ──────────────────────────────────────────────────────
//
// NOTE: Sentry.setupExpressErrorHandler(app) in app.ts has ALREADY captured
// any error reaching this point with full request context + correlation_id.
// We therefore do NOT call captureException here — doing so would double-
// fire every 5xx event and double our Sentry quota burn. This handler is
// purely for shaping the user-facing Arabic error response.
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err, req: { method: req.method, url: req.url } }, "Unhandled error");

  if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
    res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  } else if (err instanceof ZodError) {
    // Round-3 (audit §5): zod 3's ZodError exposes `.errors` as a
    // deprecated getter, but matching the class explicitly is the
    // robust shape (zod 4 drops the alias) and avoids accidentally
    // catching arbitrary objects that happen to carry an `errors`
    // property.
    // R120-B3 (A8-F3): the full zod issue array (messages, received
    // values, paths) is implementation detail echoed to clients — map
    // to minimal { path, code } pairs via zodIssuesToClient (exported
    // so the R120 400-shape tests pin the client contract directly).
    // The complete issues stay in the pino log line above
    // (logger.error({ err, … }) carries the whole error object, issues
    // included). No frontend consumer reads details (getErrorMessage
    // keys off code/error/message only).
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: { issues: zodIssuesToClient(err.issues) },
      }),
    );
  } else if (
    err instanceof Error &&
    "errors" in err &&
    Array.isArray((err as { errors?: unknown }).errors)
  ) {
    // R120-B3 (A8-F3): the raw `.errors` passthrough minimized to a
    // count — same rationale as the ZodError branch above (full detail
    // already rode the pino log line at the top of this handler).
    const errorWithErrors = err as { errors?: unknown[] };
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: { count: errorWithErrors.errors?.length ?? 0 },
      }),
    );
  } else {
    res
      .status(500)
      .json(createErrorResponse("خطأ في الخادم. حاول مرة أخرى.", ErrorCode.INTERNAL_ERROR));
  }
}
