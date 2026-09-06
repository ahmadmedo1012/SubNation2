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
 * header. We override `req.ip` with that value transparently, so
 * downstream code (rate-limit-redis, audit logs, auth-activity, Sentry
 * user context) reads the correct IP without any per-call changes.
 *
 * SECURITY — H11 (deep-audit 2026-09-06)
 * --------------------------------------
 * The public `*.onrender.com` origin is deliberately reachable, so an
 * attacker CAN bypass Cloudflare and hit Render directly with a forged
 * `CF-Connecting-IP`. Trusting the header blindly turned every IP-keyed
 * control (login rate-limits, lockout windows, audit/forensics) into
 * attacker-chosen data.
 *
 * Defense: ONLY trust `CF-Connecting-IP` when the connection ACTUALLY
 * came through Cloudflare. Render appends the true connecting peer as
 * the RIGHTMOST entry of X-Forwarded-For — for genuine CF traffic that
 * peer is a Cloudflare edge IP; for a direct-to-origin attacker it is
 * the attacker's own IP. We verify the rightmost peer against
 * Cloudflare's published IP ranges before honouring the header.
 *
 * Leftmost XFF entries are client-controlled and never consulted.
 *
 * BEHAVIOUR
 * ---------
 *   - Via Cloudflare (peer ∈ CF ranges): req.ip = CF-Connecting-IP (real client)
 *   - Direct to Render / forged header:  req.ip = Express default
 *
 * This makes the platform CORRECT under both configurations. No
 * Cloudflare-specific lock-in: removing CF reverts behaviour
 * automatically. The strongest long-term fix remains restricting the
 * Render service to Cloudflare ingress (origin firewall / CF Tunnel) —
 * see CLOUDFLARE_SETUP.md; this check is the code-level backstop.
 */

// Cloudflare published ranges (https://www.cloudflare.com/ips-v4 & ips-v6).
// Stable for years; changes are announced on the CF status feed. Keep in
// sync when CF publishes new ranges.
const CF_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  cidr4("173.245.48.0/20"),
  cidr4("103.21.244.0/22"),
  cidr4("103.22.200.0/22"),
  cidr4("103.31.4.0/22"),
  cidr4("141.101.64.0/18"),
  cidr4("108.162.192.0/18"),
  cidr4("190.93.240.0/20"),
  cidr4("188.114.96.0/20"),
  cidr4("197.234.240.0/22"),
  cidr4("198.41.128.0/17"),
  cidr4("162.158.0.0/15"),
  cidr4("104.16.0.0/13"),
  cidr4("104.24.0.0/14"),
  cidr4("172.64.0.0/13"),
  cidr4("131.0.72.0/22"),
];

// [BigInt network, BigInt mask]
const CF_IPV6_RANGES: ReadonlyArray<readonly [bigint, bigint]> = [
  cidr6("2400:cb00::/32"),
  cidr6("2606:4700::/32"),
  cidr6("2803:f800::/32"),
  cidr6("2405:b500::/32"),
  cidr6("2405:8100::/32"),
  cidr6("2a06:98c0::/29"),
  cidr6("2c0f:f248::/29"),
];

function cidr4(cidr: string): readonly [number, number] {
  const [ip, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  const parts = ip.split(".").map(Number);
  const addr = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return [(addr & mask) >>> 0, mask] as const;
}

function cidr6(cidr: string): readonly [bigint, bigint] {
  const [ip, bitsStr] = cidr.split("/");
  const bits = BigInt(bitsStr);
  const expanded = expandIpv6(ip);
  // V1-M4 (red-team 2026-09-06): the mask must have its ONE bits in the
  // HIGH bits (leftmost `bits` positions). The previous right-shift put
  // them in the low bits, so every range collapsed to "low-bits-zero"
  // matching and real CF IPv6 edges (e.g. 2606:4700::/68) never matched.
  const mask =
    bits === 0n
      ? 0n
      : ((1n << bits) - 1n) << (128n - bits);
  return [expanded & mask, mask] as const;
}

function expandIpv6(ip: string): bigint {
  // Handle "::" compression and IPv4-mapped tails.
  let full = ip;
  if (full.includes(".")) {
    const v4 = full.split(":").pop() ?? "";
    const segs = v4.split(".").map(Number);
    const v4hi = (segs[0] << 8) | segs[1];
    const v4lo = (segs[2] << 8) | segs[3];
    full = full.slice(0, full.lastIndexOf(":") + 1) + v4hi.toString(16) + ":" + v4lo.toString(16);
  }
  const doubleColonCount = (full.match(/::/g) ?? []).length;
  let head: string[], tail: string[];
  if (doubleColonCount > 0) {
    const idx = full.indexOf("::");
    head = full.slice(0, idx).split(":").filter(Boolean);
    tail = full.slice(idx + 2).split(":").filter(Boolean);
    const missing = 8 - head.length - tail.length;
    full = [...head, ...Array(missing).fill("0"), ...tail].join(":");
  } else {
    head = full.split(":").filter(Boolean);
  }
  const groups = full.split(":");
  let value = 0n;
  for (const g of groups) {
    value = (value << 16n) | BigInt(parseInt(g || "0", 16));
  }
  return value;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let addr = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    addr = ((addr << 8) | n) >>> 0;
  }
  return addr >>> 0;
}

function isCloudflareIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed.includes(":")) {
    try {
      const value = expandIpv6(trimmed);
      for (const [network, mask] of CF_IPV6_RANGES) {
        if ((value & mask) === network) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  const addr = ipv4ToInt(trimmed);
  if (addr === null) return false;
  for (const [network, mask] of CF_IPV4_RANGES) {
    if ((addr & mask) === (network & mask)) return true;
  }
  return false;
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;

/** The peer that actually connected to Render = RIGHTMOST XFF entry
 * (appended by the trusted Render hop — never client-controlled). */
function renderFacingPeer(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff !== "string" || xff.length === 0) return null;
  const entries = xff.split(",").map((e) => e.trim()).filter(Boolean);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

export function cloudflareClientIp(req: Request, _res: Response, next: NextFunction): void {
  const cfIp = req.headers["cf-connecting-ip"];
  const wellFormed =
    typeof cfIp === "string" &&
    cfIp.length > 0 &&
    cfIp.length < 64 &&
    (IPV4_RE.test(cfIp) || IPV6_RE.test(cfIp));

  // H11: only honour the header when the connection genuinely traversed
  // Cloudflare (the Render-facing peer is a CF edge IP). A forged header
  // arriving via the public onrender.com origin is ignored and req.ip
  // falls back to Express's default resolution.
  const viaCloudflare = (() => {
    const peer = renderFacingPeer(req);
    if (!peer) return false;
    return isCloudflareIp(peer);
  })();

  if (wellFormed && viaCloudflare) {
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

// Exported for tests.
export const __testables = { isCloudflareIp, renderFacingPeer };
