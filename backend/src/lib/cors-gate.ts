import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "./errors";
import { logger } from "./logger";

/**
 * R136 (app.ts decomposition): the CORS gate/credentials/cors() wiring moved
 * here VERBATIM from app.ts (:339-440). The exported factories keep their
 * names and signatures — app.ts re-exports them so
 * src/__tests__/cors-origin-gate.test.ts (which imports them off ../app)
 * stays green unedited.
 */

// ── CORS / Allowed Origins ────────────────────────────────────────────────────
// Round-97 F2 (A1 finding J-x — "CORS rejection returns 500"): a
// disallowed Origin used to hit the `cors` origin-callback ERROR path
// (`cb(new Error("CORS: origin not allowed"))`) → next(err) → the global
// error handler → 500 + error-level log + a Sentry capture on every
// scanner/probe request. The gate below rejects disallowed origins
// EARLY with a clean 403 (warn-level log only, never the error
// pipeline), mirroring createCsrfGate's exact-origin posture. The
// `cors` middleware after it then only ever sees approved traffic and
// can use its plain array form — no error branch left to reach next(err).
export function createCorsOriginGate(allowedOrigins: string[], production: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    // Same-origin SPA calls and server-to-server clients (Render health
    // probes, gateway callbacks) carry no Origin header — pass through,
    // exactly the old `cb(null, true)` semantics.
    if (typeof origin !== "string" || origin.length === 0) {
      next();
      return;
    }
    if (allowedOrigins.length === 0) {
      // V3-C2: an empty allow-list means REFLECT ANY ORIGIN with
      // credentials — fine in dev, a credential-leaking
      // misconfiguration in production. Fail closed with the same
      // clean 403 (the SEC-92-01 boot assertion already aborts on this
      // misconfiguration; this runtime gate is defense-in-depth).
      if (production) {
        logger.warn(
          { origin, path: req.path, category: "security" },
          "CORS allow-list empty in production — rejecting cross-origin request with 403",
        );
        res.status(403).json(createErrorResponse("الأصل غير مسموح به", ErrorCode.FORBIDDEN));
        return;
      }
      next(); // dev: allow all
      return;
    }
    if (allowedOrigins.includes(origin)) {
      next();
      return;
    }
    logger.warn({ origin, path: req.path }, "CORS: origin not allowed — 403");
    res.status(403).json(createErrorResponse("الأصل غير مسموح به", ErrorCode.FORBIDDEN));
  };
}

/**
 * R118-B1c (A4 F-5): emit Access-Control-Allow-Credentials ONLY when the
 * request carries an Origin header that the gate above allowed.
 *
 * The `cors` package sets ACAC on EVERY response once `credentials: true`
 * (its configureCredentials runs for preflight and actual requests alike,
 * with no origin-conditional mode) — including the no-Origin responses
 * that dominate real traffic (health probes, same-origin SPA calls,
 * curl). There the header is inert (no ACAO → the browser refuses
 * credentialed reads) but it is scanner-visible misconfig noise and
 * invites future misuse of the flag. So the option is dropped from the
 * `cors` config and the header is set HERE instead, mounted between the
 * origin gate and `cors`:
 *
 *   - no Origin → no ACAC (the F-5 fix; same-origin/server-to-server
 *     traffic never needed it);
 *   - a DISALLOWED Origin never reaches this middleware (the gate 403'd
 *     it above — its response carries no ACAC either);
 *   - an allowed Origin (or any origin in dev's empty-allowlist reflect
 *     mode) → ACAC: true, exactly the previous credentialed-CORS
 *     behaviour for the cross-origin SPA, on BOTH actual requests and
 *     the preflight OPTIONS the `cors` middleware below answers (this
 *     middleware runs first and the header persists on the response).
 */
export function createCorsCredentialsHeader() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    next();
  };
}

/**
 * The `cors` middleware itself — the exact options app.ts used to inline.
 * Plain list form: disallowed origins never reach this middleware (the
 * gate above 403'd them), and an absent Origin header never triggers
 * CORS headers (server-to-server/same-origin pass-through). Empty list
 * in dev reflects any origin (previous behaviour).
 *
 * credentials: REMOVED (R118-B1c, A4 F-5) — see createCorsCredentialsHeader
 * above: ACAC is now emitted only for origin-bearing (i.e. allowlist-passed)
 * requests.
 *
 * 98-F3 (R98-A4 §5): preflight responses carried no
 * Access-Control-Max-Age, so every cross-origin browser request from the
 * Vercel SPA (credentials:"include") paid a fresh OPTIONS round-trip per
 * browser cache window. 10 minutes is the security-neutral cap
 * recommended by MDN (Chrome caps at 2h, Firefox 24h — 600s is the
 * cross-browser floor that all honor); the origin list is static, so
 * caching the preflight cannot pin a stale permission.
 */
export function createCorsMiddleware(allowedOrigins: string[]) {
  return cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    maxAge: 600,
  });
}
