import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket, SOCKET_RESYNC_EVENT } from "@/lib/socket";
import { invalidateAdminRealtimeFamilies } from "@/lib/socket-resync";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Socket } from "socket.io-client";

/**
 * R104 (free-tier sleep economics) — ADMIN realtime channel only.
 *
 * Previously this component ALSO connected a Socket.IO socket for every
 * authenticated user on every page (held for the whole session, 25 s
 * engine pings, reconnectionAttempts: Infinity). A single open
 * authenticated tab therefore kept the Render free instance awake 24/7
 * (~730 of the 750 shared instance-hours/month) — voiding the
 * deployment's accepted sleep design (render.yaml header) by accident.
 *
 * New socket policy (mission Phase J — "who needs Socket.IO, when,
 * why"):
 *   • ADMIN sessions: this component — the admin room powers live
 *     topup/order approvals and alert toasts for the operator. It is
 *     mounted via DeferredSocketInitializer which is adminToken-gated;
 *     SessionActivityManager parks the socket when the tab is hidden
 *     ≥ 15 min or idle ≥ 30 min so a forgotten admin tab cannot burn
 *     the month either.
 *   • STOREFRONT users: NO persistent socket. Realtime is page-scoped
 *     (order-detail mounts hooks/use-socket for post-purchase status);
 *     everywhere else the existing fallbacks carry the UX — the
 *     NotificationBell 60 s foreground poll, TopupWaitingModal's 3 s
 *     poll while a topup is pending, and SessionActivityManager's
 *     visibility resync refreshing money/identity families when the
 *     user returns.
 *
 * The transactional resync (SOCKET_RESYNC_EVENT + visibilitychange) that
 * used to live here moved to SessionActivityManager — it never needed a
 * socket and now serves ALL authed sessions, not just socket-holders.
 * R127-B6-3: this component kept (and keeps) only the ADMIN branch of
 * SOCKET_RESYNC_EVENT; the storefront money-screen branch lives in
 * SessionActivityManager (mounted for every authed session — this
 * component is adminToken-gated and never mounts for storefront
 * sessions).
 */
export function SocketInitializer() {
  const { adminToken } = useAuth();
  const queryClient = useQueryClient();

  // One-shot resync on reconnect after a DOCUMENTED disconnect
  // (lib/socket.ts dispatches SOCKET_RESYNC_EVENT exactly once per
  // disconnect→connect cycle). Covers admin-list changes that were
  // emitted while the socket was parked/disconnected.
  useEffect(() => {
    const handleResyncEvent = () => {
      if (!adminToken) return;
      // R126-L3 (A2-1) + R127-B6-6: the shared key-set (8 families —
      // the R126-L3 seven + products) also covers a parked-socket
      // window carrying ticket/risk/product writes. The storefront
      // branch of this event lives in SessionActivityManager.
      invalidateAdminRealtimeFamilies(queryClient);
    };

    window.addEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
    return () => window.removeEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
  }, [adminToken, queryClient]);

  // ── Admin room listeners (Round-4, perf P1-3/P1-5) ────────────────────
  //
  // The backend emits `admin-stats-update` from every family whose
  // writes move admin numbers — topup approve/reject, order bulk
  // updates, users PATCH, ticket reply/status, risk label/bulk-label
  // and the products write family (R125-I6 + R126 wave-1) — plus
  // `admin-alert-new` (jobs/alertLogger emits on insert). With these
  // listeners in place, the covered admin queries invalidate ON EVENT
  // and their refetchIntervals are demoted to 5-minute heartbeat
  // fallbacks (see dashboard/orders/topups/users pages + AdminLayout
  // alert pollers). R126-L3 (A2-1/A4-B-5): the invalidation key-set
  // now carries the tickets list + the two risk keys as well —
  // tickets/risk-event have no polling, so without them a second
  // operator's reply left this tab's queue stale while the layout
  // badge (fed by stats) updated beside it. R127-B6-6: the products
  // list key joins the set (products.tsx's base-key invalidation
  // comment always claimed socket coverage; the 60 s poll stays as
  // the dropout fallback). The key-set itself lives in
  // lib/socket-resync.ts (shared with SessionActivityManager's
  // visibility + resync-event paths).
  useEffect(() => {
    if (!adminToken) return;
    let active = true;
    let socketRef: Socket | null = null;

    // R127-B6-4 (B6 sockets audit): the admin socket branch had NO
    // connection_limited / connect_error listeners — the branch that
    // actually collides with the backend's documented CGNAT scenario
    // (Libyan mobile carriers NAT many users behind one address; the
    // 6th connection behind a carrier IP is politely capped, ignored,
    // hard-disconnected, retried, re-capped… until the manager
    // surrenders). Mirrors hooks/use-socket.ts exactly: ONE toast with
    // a stable id per occurrence (sonner refreshes instead of stacking
    // — no toast spam), connect_error warned to the console for
    // DevTools/Sentry forensics without disturbing the operator.
    // Registered/unregistered with NAMED handlers: off(event, fn)
    // must not strip the storefront's own connection_limited /
    // connect_error listeners on the shared singleton (use-socket.ts
    // registers both on the same socket object).
    const handleConnectionLimited = (data: { reason?: string; message?: string }) => {
      toast({
        title: "عدد الاتصالات مرتفع",
        description:
          data.message ?? "سنحاول إعادة الاتصال تلقائياً — أغلق التبويبات الأخرى وحاول مجدداً",
        id: "socket-connection-limited",
      });
    };
    const handleConnectError = (error: Error) => {
      // Non-critical: Socket.IO retries automatically (bounded at 10
      // attempts; SessionActivityManager revives on presence). Surface
      // in DevTools for debugging without disturbing the user.
      console.warn("[admin-socket] connect_error:", error.message);
    };

    const setup = async () => {
      try {
        const socket = await connectAdminSocket();
        if (!active || !socket) return;
        socketRef = socket;

        const handleStatsUpdate = () => {
          // Shared 8-family set (lib/socket-resync.ts) — prefix
          // invalidations cover every params variant of each list
          // (dashboard's {limit:8} recent orders, the orders page's
          // {}, users' {search} variants, tickets' {status} variants,
          // products' list params…).
          invalidateAdminRealtimeFamilies(queryClient);
        };

        const handleAlertNew = () => {
          // Alert drawer (react-query) + unread badge refresh…
          void queryClient.invalidateQueries({ queryKey: ["admin-alerts"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-alerts-unread-count"] });
          // …and the AdminLayout toast poller runs its /new?since= fetch
          // immediately (it owns the localStorage lastId dedupe + Arabic
          // toast labels, so toasting here would double-fire).
          window.dispatchEvent(new CustomEvent(ADMIN_ALERT_NEW_EVENT));
        };

        socket.on("admin-stats-update", handleStatsUpdate);
        socket.on("admin-alert-new", handleAlertNew);
        socket.on("connection_limited", handleConnectionLimited);
        socket.on("connect_error", handleConnectError);
      } catch (err) {
        console.warn("Admin socket setup failed (non-critical):", err);
      }
    };

    void setup();

    return () => {
      active = false;
      if (socketRef) {
        socketRef.off("admin-stats-update");
        socketRef.off("admin-alert-new");
        // Precise off(event, fn) — see the note above the handlers.
        socketRef.off("connection_limited", handleConnectionLimited);
        socketRef.off("connect_error", handleConnectError);
      }
    };
  }, [adminToken, queryClient]);

  return null;
}
