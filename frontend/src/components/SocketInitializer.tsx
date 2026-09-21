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
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/topups"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    };

    window.addEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
    return () => window.removeEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
  }, [adminToken, queryClient]);

  // ── Admin room listeners (Round-4, perf P1-3/P1-5) ────────────────────
  //
  // The backend emits `admin-stats-update` (topup approve/reject + order
  // bulk updates) and `admin-alert-new` (jobs/alertLogger emits on
  // insert). With these listeners in place, the covered admin queries
  // invalidate ON EVENT and their refetchIntervals are demoted to
  // 5-minute heartbeat fallbacks (see dashboard/orders/topups/users
  // pages + AdminLayout alert pollers).
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
          // page's {}, users' {search} variants, …).
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/topups"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
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
