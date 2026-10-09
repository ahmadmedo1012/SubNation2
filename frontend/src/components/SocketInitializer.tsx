import { useAuth } from "@/lib/auth";
import { connectAdminSocket, SOCKET_RESYNC_EVENT } from "@/lib/socket";
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
      // R126-L3 (A2-1): same key-set as handleStatsUpdate below — a
      // parked-socket window can carry ticket/risk writes too.
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/topups"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-risk-events"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-risk-dashboard"] });
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
  // badge (fed by stats) updated beside it.
  useEffect(() => {
    if (!adminToken) return;
    let active = true;
    let socketRef: Socket | null = null;

    const setup = async () => {
      try {
        const socket = await connectAdminSocket();
        if (!active || !socket) return;
        socketRef = socket;

        const handleStatsUpdate = () => {
          // Prefix-invalidations cover every params variant of each
          // list (dashboard's {limit:8} recent orders, the orders
          // page's {}, users' {search} variants, tickets' {status}
          // variants…). R126-L3 (A2-1/A4-B-5): the tickets list key +
          // the two risk keys join the set — the backend emits
          // admin-stats-update for ticket reply/status and risk label
          // writes, and tickets/risk-event have NO polling
          // (refetchOnWindowFocus is off app-wide), so these keys were
          // the missing freshness path for the support/security
          // queues on other tabs.
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/topups"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-risk-events"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-risk-dashboard"] });
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
      }
    };
  }, [adminToken, queryClient]);

  return null;
}
