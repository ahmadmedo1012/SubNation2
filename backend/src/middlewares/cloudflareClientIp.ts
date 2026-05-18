import type { NextFunction, Request, Response } from "express";

/**
 * Cloudflare-aware client-IP resolution.
 *
 * CONTEXT
 * -------
 * The platform sits behind a two-hop proxy chain when Cloudflare is
 * in front:
 *
 *     Browser → Cloudflare edge → Render edge → app
 *
 * Express's `trust proxy = 1` (configured in `app.ts`) trusts the
 * single most recent proxy hop — Render. For a Cloudflare request
 * Render preserves CF's `X-Forwarded-Proto: https`, so HTTPS detection
 * works. But `req.ip` resolves to CF's edge IP, not the real client.
 *
 * Cloudflare sends the real client IP in the `CF-Connecting-IP`
 * header (and only sends it; clients can't forge it because CF
 * strips the header from incoming requests). When this header is
 * present we know:
 *
 *   1. The request came through Cloudflare.
 *   2. The header value is CF's authoritative claim about the
 *      original client.
 *
 * We override `req.ip` with that value transparently, so downstream
 * code (rate-limit-redis, audit logs, auth-activity, Sentry user
 * context) reads the correct IP without any per-call changes.
 *
 * BEHAVIOUR
 * ---------
 *   - With Cloudflare:    req.ip = CF-Connecting-IP (real client)
 *   - Without Cloudflare: req.ip = Express default (Render's claim)
 *
 * This makes the platform CORRECT under both configurations. No
 * Cloudflare-specific lock-in: removing CF reverts behaviour
 * automatically.
 *
 * SECURITY
 * --------
 * Cloudflare strips any `CF-Connecting-IP` sent by clients before
 * forwarding. Only CF can set this header for traffic that flows
 * through it. As long as the Render service only accepts traffic
 * from Cloudflare (via firewall rule or CF Tunnels), we cannot be
 * tricked by a client sending a fake `CF-Connecting-IP`.
 *
 * If CF is not yet enforcing origin-only-from-CF (early days), an
 * attacker could bypass CF and hit Render directly with a forged
 * header — but this attack only works if the operator has not yet
 * configured the origin firewall. Document in CLOUDFLARE_SETUP.md.
 */
export function cloudflareClientIp(req: Request, _res: Response, next: NextFunction): void {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.length > 0 && cfIp.length < 64) {
    // Override the read-only req.ip getter via Object.defineProperty so
    // express-rate-limit, getClientInfo, audit-log, and Sentry user
    // context all read the corrected value transparently.
    Object.defineProperty(req, "ip", {
      value: cfIp,
      configurable: true,
      writable: true,
    });
  }
  next();
}
