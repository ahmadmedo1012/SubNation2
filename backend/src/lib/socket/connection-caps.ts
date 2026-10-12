/**
 * Socket.IO connection caps (R97-06, round-97 F2) — the per-IP / total
 * concurrency accounting half of the lib/socket package (R136 BE-2
 * decomposition of lib/socket.ts).
 *
 * /socket.io sits OUTSIDE apiLimiter/userLimiter (mounted on /api only),
 * and every accepted socket costs a DB liveness probe at handshake + a
 * 5-minute re-verify timer + room membership. A holder of a VALID token
 * could otherwise open thousands of concurrent connections
 * (memory/FD/DB exhaustion). Every connection is counted in a
 * per-client-IP tracker (max 5 concurrent per IP) plus a total sanity
 * cap (2000); a breaching socket is emitted a polite
 * `connection_limited` event and hard-disconnected a beat later (the
 * connection handler in lib/socket.ts), and the rejection lands in the
 * same Prometheus counter as the auth rejections (reason=
 * ip_connection_cap / total_connection_cap).
 *
 * Deliberately dependency-free and pure so the exhaustion math is
 * unit-testable without a socket.io server. One tracker per
 * initSocket() call (per process in production) — single-instance by
 * design (documented limitation, same posture as the in-memory
 * rate-limit fallback).
 */
import { __testables as cloudflareIpTestables } from "../../middlewares/cloudflareClientIp";

/** Max CONCURRENT authenticated sockets per client IP. 5 covers every
 * legitimate shape (main tab + admin tab + a refresh overlap + a mobile
 * PWA) while making thousands-of-connections-per-attacker structurally
 * impossible. CGNAT note: Libyan mobile carriers NAT many users behind
 * one address; a shared 5-slot ceiling there degrades to reconnect
 * churn, not lockout — acceptable for the exhaustion attack this caps. */
export const MAX_SOCKET_CONNECTIONS_PER_IP = 5;

/** Total concurrent sockets this instance will serve before refusing.
 * Sanity bound against FD/memory exhaustion; 2000 is ~10× the observed
 * peak for this deployment. */
export const MAX_TOTAL_SOCKET_CONNECTIONS = 2_000;

/** How often the tracker drops ids whose socket is no longer connected
 * (missed disconnects, bookkeeping drift) — keeps the Map bounded. */
export const SOCKET_CAP_SWEEP_INTERVAL_MS = 60_000;

/** Verdict of SocketConnectionTracker.admit — the connection handler
 * disconnects anything that is not "ok". */
export type SocketCapVerdict = "ok" | "per_ip_cap" | "total_cap";

/**
 * In-memory concurrent-connection accounting: per-client-IP socket-id
 * sets plus a total counter. Deliberately dependency-free and pure so
 * the exhaustion math is unit-testable without a socket.io server
 * (same shape as the exported auth helpers in ./auth.ts).
 *
 * One tracker per initSocket() call (per process in production).
 */
export class SocketConnectionTracker {
  private readonly perIp = new Map<string, Set<string>>();
  private total = 0;

  constructor(
    private readonly maxPerIp: number = MAX_SOCKET_CONNECTIONS_PER_IP,
    private readonly maxTotal: number = MAX_TOTAL_SOCKET_CONNECTIONS,
  ) {}

  /** R104 (AG3-4): non-mutating verdict probe — what WOULD admit()
   * return for this IP right now? Used by the io.use pre-check so a
   * capped client is rejected BEFORE the auth/DB probe chain without
   * occupying a slot. */
  peek(ip: string): SocketCapVerdict {
    if (this.total >= this.maxTotal) return "total_cap";
    const ids = this.perIp.get(ip);
    if (ids && ids.size >= this.maxPerIp) return "per_ip_cap";
    return "ok";
  }

  /** Register a connection. Returns the verdict; only "ok" connections
   * are tracked (a capped socket must not occupy a slot). */
  admit(ip: string, socketId: string): SocketCapVerdict {
    if (this.total >= this.maxTotal) return "total_cap";
    let ids = this.perIp.get(ip);
    if (!ids) {
      ids = new Set<string>();
      this.perIp.set(ip, ids);
    }
    if (ids.has(socketId)) return "ok"; // idempotent re-admit
    if (ids.size >= this.maxPerIp) return "per_ip_cap";
    ids.add(socketId);
    this.total += 1;
    return "ok";
  }

  /** Free the slot a disconnecting socket occupied. No-op for ids that
   * were never admitted (capped sockets have no slot to free). */
  release(ip: string, socketId: string): void {
    const ids = this.perIp.get(ip);
    if (!ids || !ids.delete(socketId)) return;
    this.total -= 1;
    if (ids.size === 0) this.perIp.delete(ip);
  }

  /** Drop tracked ids the caller reports as dead — bounds drift from any
   * missed disconnect path and keeps the Map size = live IP count. */
  sweep(isLive: (socketId: string) => boolean): void {
    for (const [ip, ids] of this.perIp) {
      for (const id of ids) {
        if (!isLive(id)) {
          ids.delete(id);
          this.total -= 1;
        }
      }
      if (ids.size === 0) this.perIp.delete(ip);
    }
  }

  /** Observability for tests + logs. */
  stats(): { ips: number; sockets: number } {
    return { ips: this.perIp.size, sockets: this.total };
  }
}

/**
 * Client IP for the per-IP connection cap. Mirrors cloudflareClientIp
 * (H11) semantics on the WS surface: the rightmost XFF entry is the peer
 * that actually connected to Render — when THAT peer is a Cloudflare
 * edge, the CF-Connecting-IP header is Cloudflare's own (trustworthy)
 * client value; otherwise (direct-to-Render connection) the rightmost
 * XFF entry IS the client. Keying the cap on the raw rightmost XFF alone
 * would lump every Cloudflare-routed user onto a handful of CF edge IPs
 * and over-block; keying it on the unvalidated CF header would let a
 * direct attacker rotate keys freely — this resolution is neither.
 *
 * Reuses the middleware's exported CF range tables (single source of
 * truth — a local copy would drift when Cloudflare announces new ranges).
 */
export function resolveSocketClientIp(socket: {
  handshake: { headers: Record<string, unknown>; address?: string };
}): string {
  const headers = socket.handshake.headers;
  const cfIp = headers["cf-connecting-ip"];
  const xff = headers["x-forwarded-for"];

  let peer: string | null = null;
  if (typeof xff === "string" && xff.length > 0) {
    const entries = xff
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) peer = entries[entries.length - 1]!;
  }

  if (
    peer &&
    typeof cfIp === "string" &&
    cfIp.length > 0 &&
    cloudflareIpTestables.isCloudflareIp(peer)
  ) {
    return cfIp;
  }

  return peer ?? socket.handshake.address ?? "unknown";
}
