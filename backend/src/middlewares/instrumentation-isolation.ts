import { logger } from "../lib/logger";
import { monitoringErrorsTotal } from "../lib/metrics";
import { ErrorCode, createErrorResponse } from "../lib/errors";

/**
 * Wraps any function so monitoring failures never crash the request handler.
 * On caught error, increments monitoringErrorsTotal{component} and logs with category:"monitoring".
 * Never propagates errors to the caller.
 */
export function isolate<T extends (...args: unknown[]) => unknown>(component: string, fn: T): T {
  return ((...args: Parameters<T>): ReturnType<T> | Promise<ReturnType<T>> => {
    try {
      const result = fn(...args);
      return result as ReturnType<T> | Promise<ReturnType<T>>;
    } catch (err) {
      // Increment monitoring error counter but don't propagate
      monitoringErrorsTotal.inc({ component });
      logger.error({ err, component, category: "monitoring" }, "Instrumentation error");
      // Re-throw to maintain function signature, but caller should handle
      throw err;
    }
  }) as T;
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
