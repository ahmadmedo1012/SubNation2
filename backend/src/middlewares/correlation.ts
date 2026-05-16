import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import {
  createCorrelationContextFromHeader,
  runWithCorrelationContext,
} from "../lib/correlation";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Express middleware that establishes a per-request correlation context.
 *
 * - Reads `x-request-id` from the inbound request, validating UUID v4.
 *   Invalid or missing headers are replaced with a fresh `randomUUID`.
 * - Echoes the resulting id back on `x-request-id` of the response.
 * - Runs the rest of the request inside `AsyncLocalStorage` so any code in
 *   the request scope (logger, Sentry beforeSend, alerting, metrics) can
 *   read it via `getCorrelationId()`.
 */
export const correlationMiddleware: RequestHandler = (req, res, next) => {
  const headerValue = req.headers[REQUEST_ID_HEADER];
  const requestIdInput = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  const route = req.route?.path ?? req.baseUrl + (req.path || req.url || "");
  const ctx = createCorrelationContextFromHeader(requestIdInput, route, performance.now());

  res.setHeader(REQUEST_ID_HEADER, ctx.requestId);
  // Mirror as `req.id` so pino-http picks it up automatically.
  (req as { id?: string }).id = ctx.requestId;

  runWithCorrelationContext(ctx, () => next());
};
