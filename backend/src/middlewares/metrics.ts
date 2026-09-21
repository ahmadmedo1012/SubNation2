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
    // R104 (AG8-7): leaf path only merged 11 "/:id"-style endpoints
    // across routers into one series. Prefix with the mount path where
    // available — still bounded (~150 patterns), now attributable.
    const route = req.route ? `${req.baseUrl ?? ""}${req.route.path}` : (req.baseUrl ?? "unknown");
    const method = req.method.toLowerCase();
    const status = String(res.statusCode);
    const durationSec = (performance.now() - start) / 1000;

    safeObserve(httpRequestDurationSeconds, { route, method, status }, durationSec);
    safeInc(httpRequestsTotal, { route, method, status });
  });

  next();
};
