import { logger } from "../lib/logger";
import { monitoringErrorsTotal } from "../lib/metrics";
import { ErrorCode, createErrorResponse } from "../lib/errors";

/**
 * Wraps any function so monitoring failures never crash the request handler.
 * On caught error, increments monitoringErrorsTotal{component} and logs with category:"monitoring".
 * Never propagates errors to the caller — sync OR async (R7, round-93 A3).
 *
 * R7 (round-93 A3): the old implementation only caught SYNC throws and
 * re-threw them (contradicting its own doc). For async functions — its
 * only real usage, worker heartbeat writes — a rejected promise bypassed
 * the try/catch entirely: no counter, no log, no Sentry, while callers'
 * `.catch(() => {})` comments claimed "error already logged". Now:
 *   - sync throws are reported and swallowed;
 *   - async rejections are reported (once) and resolve to undefined.
 */
export function isolate<T extends (...args: unknown[]) => unknown>(component: string, fn: T): T {
  const report = (err: unknown): void => {
    monitoringErrorsTotal.inc({ component });
    logger.error({ err, component, category: "monitoring" }, "Instrumentation error");
  };

  return ((...args: Parameters<T>): ReturnType<T> | Promise<ReturnType<T>> => {
    let result: ReturnType<T>;
    try {
      result = fn(...args) as ReturnType<T>;
    } catch (err) {
      // Increment monitoring error counter, log, and do NOT propagate —
      // the documented contract is "never propagates to the caller".
      report(err);
      return undefined as ReturnType<T>;
    }
    // Async path: attach the catch the old version never had.
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (value) => value as ReturnType<T>,
        (err: unknown) => {
          report(err);
          return undefined as ReturnType<T>;
        },
      );
    }
    return result;
  }) as T;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Express middleware variant that catches errors from downstream instrumentation.
 * On caught error, increments monitoringErrorsTotal{component:"middleware"} and logs.
 * Never propagates errors to business logic.
 */
export const instrumentationIsolation: import("express").RequestHandler = (req, res, next) => {
  try {
    next();
  } catch (err) {
    // Increment monitoring error counter but don't propagate
    monitoringErrorsTotal.inc({ component: "middleware" });
    logger.error({ err, component: "middleware", category: "monitoring" }, "Instrumentation error");
    // Send 500 to client but don't crash the server
    if (!res.headersSent) {
      res.status(500).json(createErrorResponse("Internal server error", ErrorCode.INTERNAL_ERROR));
    }
  }
};
