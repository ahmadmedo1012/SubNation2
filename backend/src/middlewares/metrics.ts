import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
  safeInc,
  safeObserve,
} from "../lib/metrics";

/**
 * Express middleware that observes HTTP request duration and count.
 *
 * Cardinality bound:
 *   - `route` label is the Express *route pattern* (e.g. `/products/:id`),
 *     never the resolved URL. Unmatched routes collapse to `"unknown"`.
 *   - `method` is lower-cased.
 *   - `status` is the response status code as a string.
 *
 * This middleware is wrapped by `instrumentationIsolation` upstream so that
 * any failure in metric emission cannot crash the request pipeline.
 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const start = performance.now();

  res.on("finish", () => {
    const route = req.route?.path ?? req.baseUrl ?? "unknown";
    const method = req.method.toLowerCase();
    const status = String(res.statusCode);
    const durationSec = (performance.now() - start) / 1000;

    safeObserve(httpRequestDurationSeconds, { route, method, status }, durationSec);
    safeInc(httpRequestsTotal, { route, method, status });
  });

  next();
};
