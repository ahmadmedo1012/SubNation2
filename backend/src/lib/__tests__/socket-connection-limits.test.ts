import { describe, expect, it } from "vitest";
import {
  MAX_SOCKET_CONNECTIONS_PER_IP,
  MAX_TOTAL_SOCKET_CONNECTIONS,
  SocketConnectionTracker,
  resolveSocketClientIp,
} from "../socket";

/**
 * R97-06 (round-97 F2) — Socket.IO connection caps.
 *
 * /socket.io/* sits OUTSIDE apiLimiter/userLimiter (those mount on /api
 * only), so a holder of a VALID token could open thousands of concurrent
 * connections — each costing a handshake DB probe, a 5-minute re-verify
 * timer and room membership (memory/FD/DB exhaustion). The
 * SocketConnectionTracker bounds that: max 5 concurrent sockets per
 * client IP + a 2000 total sanity cap, with a periodic sweep keeping the
 * in-memory Map at live-connection size.
 *
 * Pure-unit coverage (no socket.io server needed — the same philosophy
 * as socket-auth.test.ts: initSocket() delegates to these helpers).
 * Also pins resolveSocketClientIp: the per-IP cap key must mirror the
 * cloudflareClientIp (H11) resolution — otherwise every Cloudflare-routed
 * user would collide on a handful of CF edge IPs (over-blocking), or a
 * direct attacker could rotate forged CF-Connecting-IP keys (no cap).
 */

describe("SocketConnectionTracker — per-IP cap", () => {
  it("admits up to MAX_SOCKET_CONNECTIONS_PER_IP sockets from one IP, then caps", () => {
    const tracker = new SocketConnectionTracker();
    for (let i = 0; i < MAX_SOCKET_CONNECTIONS_PER_IP; i++) {
      expect(tracker.admit("1.2.3.4", `sock-${i}`)).toBe("ok");
    }
    // The very next connection from the same IP is refused…
    expect(tracker.admit("1.2.3.4", "sock-5")).toBe("per_ip_cap");
    // …and it must NOT occupy a slot (still exactly 5 tracked).
    expect(tracker.stats()).toEqual({ ips: 1, sockets: 5 });
    // …while a DIFFERENT IP is unaffected (the cap is per-IP, not global).
    expect(tracker.admit("5.6.7.8", "sock-other")).toBe("ok");
    expect(tracker.stats()).toEqual({ ips: 2, sockets: 6 });
  });

  it("release frees the slot for a new connection from the same IP", () => {
    const tracker = new SocketConnectionTracker();
    for (let i = 0; i < 5; i++) tracker.admit("1.2.3.4", `sock-${i}`);
    expect(tracker.admit("1.2.3.4", "sock-5")).toBe("per_ip_cap");

    tracker.release("1.2.3.4", "sock-2");
    expect(tracker.admit("1.2.3.4", "sock-5")).toBe("ok");
    expect(tracker.stats()).toEqual({ ips: 1, sockets: 5 });
  });

  it("release of a never-admitted (capped) id is a no-op", () => {
    const tracker = new SocketConnectionTracker();
    for (let i = 0; i < 5; i++) tracker.admit("1.2.3.4", `sock-${i}`);
    const cappedId = "sock-capped";
    expect(tracker.admit("1.2.3.4", cappedId)).toBe("per_ip_cap");

    // The disconnect handler of the capped socket calls release — it
    // must not corrupt the accounting (no negative total, no slot freed).
    tracker.release("1.2.3.4", cappedId);
    expect(tracker.stats()).toEqual({ ips: 1, sockets: 5 });
  });

  it("the last release of an IP removes the key entirely (Map stays bounded)", () => {
    const tracker = new SocketConnectionTracker();
    tracker.admit("9.9.9.9", "only");
    tracker.release("9.9.9.9", "only");
    expect(tracker.stats()).toEqual({ ips: 0, sockets: 0 });
  });

  it("admit is idempotent per socket id (double-admit does not double-count)", () => {
    const tracker = new SocketConnectionTracker();
    expect(tracker.admit("1.2.3.4", "s1")).toBe("ok");
    expect(tracker.admit("1.2.3.4", "s1")).toBe("ok");
    expect(tracker.stats()).toEqual({ ips: 1, sockets: 1 });
  });
});

describe("SocketConnectionTracker — total cap", () => {
  it("refuses EVERYTHING once the total is reached, even from brand-new IPs", () => {
    const tracker = new SocketConnectionTracker(5, 3);
    expect(tracker.admit("1.1.1.1", "a")).toBe("ok");
    expect(tracker.admit("2.2.2.2", "b")).toBe("ok");
    expect(tracker.admit("3.3.3.3", "c")).toBe("ok");
    // Total full — a fresh IP is still refused (sanity bound).
    expect(tracker.admit("4.4.4.4", "d")).toBe("total_cap");
    expect(tracker.stats()).toEqual({ ips: 3, sockets: 3 });
    // Freeing one slot reopens exactly one.
    tracker.release("2.2.2.2", "b");
    expect(tracker.admit("4.4.4.4", "d")).toBe("ok");
  });

  it("the default total cap is the documented 2000 sanity bound", () => {
    expect(MAX_TOTAL_SOCKET_CONNECTIONS).toBe(2_000);
    expect(MAX_SOCKET_CONNECTIONS_PER_IP).toBe(5);
  });
});

describe("SocketConnectionTracker — sweep", () => {
  it("drops ids the liveness predicate reports dead and prunes empty IPs", () => {
    const tracker = new SocketConnectionTracker();
    const live = new Set(["live-1", "live-2"]);
    tracker.admit("1.2.3.4", "live-1");
    tracker.admit("1.2.3.4", "live-2");
    tracker.admit("1.2.3.4", "dead-1");
    tracker.admit("5.6.7.8", "dead-2");
    expect(tracker.stats()).toEqual({ ips: 2, sockets: 4 });

    tracker.sweep((id) => live.has(id));

    expect(tracker.stats()).toEqual({ ips: 1, sockets: 2 });
    // The dead slots are free again.
    expect(tracker.admit("1.2.3.4", "new-1")).toBe("ok");
    // The whole dead IP key is gone (Map bounded to live IPs).
    expect(tracker.admit("5.6.7.8", "new-2")).toBe("ok");
  });
});

describe("resolveSocketClientIp — H11-mirroring cap key (R97-06)", () => {
  function fakeSocket(headers: Record<string, unknown>, address = "10.0.0.5") {
    return { handshake: { headers, address } };
  }

  it("no headers at all → falls back to the transport address", () => {
    expect(resolveSocketClientIp(fakeSocket({}, "203.0.113.5"))).toBe("203.0.113.5");
  });

  it("direct-to-Render connection: rightmost XFF (Render-appended peer) IS the client", () => {
    const socket = fakeSocket({ "x-forwarded-for": "198.51.100.7" });
    expect(resolveSocketClientIp(socket)).toBe("198.51.100.7");
  });

  it("a FORGED CF-Connecting-IP on a direct connection is IGNORED (peer not Cloudflare)", () => {
    // The R97-01 attack shape applied to the WS surface: attacker hits
    // subnation2.onrender.com directly with a forged CF header. The
    // rightmost XFF is the attacker's own IP (Render-appended) — the cap
    // must key on THAT, not the forged value (else every request could
    // rotate to a fresh cap bucket).
    const socket = fakeSocket({
      "x-forwarded-for": "198.51.100.7",
      "cf-connecting-ip": "1.2.3.4",
    });
    expect(resolveSocketClientIp(socket)).toBe("198.51.100.7");
  });

  it("genuine Cloudflare traffic: CF-Connecting-IP wins when the peer is a CF edge", () => {
    // 104.16.1.1 ∈ 104.16.0.0/13 (Cloudflare published range) — the peer
    // Render actually saw. CF-Connecting-IP is then Cloudflare's own
    // trustworthy client value.
    const socket = fakeSocket({
      "x-forwarded-for": "198.51.100.7, 104.16.1.1",
      "cf-connecting-ip": "198.51.100.7",
    });
    expect(resolveSocketClientIp(socket)).toBe("198.51.100.7");
  });

  it("two DIFFERENT clients through the SAME CF edge resolve to different cap keys", () => {
    // The over-blocking hazard: keying on the raw rightmost XFF would
    // return "104.16.1.1" for BOTH users, collapsing them into one
    // 5-slot bucket.
    const alice = fakeSocket({
      "x-forwarded-for": "198.51.100.7, 104.16.1.1",
      "cf-connecting-ip": "198.51.100.7",
    });
    const bob = fakeSocket({
      "x-forwarded-for": "203.0.113.9, 104.16.1.1",
      "cf-connecting-ip": "203.0.113.9",
    });
    expect(resolveSocketClientIp(alice)).toBe("198.51.100.7");
    expect(resolveSocketClientIp(bob)).toBe("203.0.113.9");
  });
});
