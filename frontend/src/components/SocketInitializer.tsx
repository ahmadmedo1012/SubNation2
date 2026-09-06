import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket } from "@/lib/socket";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Socket } from "socket.io-client";

/**
 * Mounted once at the App root (after `<AuthProvider>`). Wires:
 *   1. The user's Socket.IO subscription to their own room — so order
 *      and topup updates fan out via Socket.IO instead of forcing the
 *      user to refresh the page.
 *   2. The admin Socket.IO subscription to the admin room — same
 *      semantics for admin notifications.
 *
 * The `useGetMe` call below explicitly passes `request: { headers }`
 * so the call returns a real user (the generated client doesn't have
 * a global Authorization injector). Without the headers, the call
 * returns 401, `user?.id` is undefined, and `useSocket(undefined)` is
 * a no-op — that's the cause of the "real-time updates feel
 * inconsistent" symptom: the WebSocket connects but never joins a
 * room, so server-emitted user-scoped events have nowhere to go.
 *
 * The shared queryKey (`getGetMeQueryKey()`) means home.tsx and any
 * other page that calls `useGetMe` reuse this cache hit — there's
 * exactly one `/api/auth/me` request per token lifetime, not one per
 * page mount.
 */
export function SocketInitializer() {
  const { token, adminToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: user, error: userError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: 1,
      // Match the staleTime used by the rest of the app (60 s) so a
      // navigation back to home doesn't trigger a redundant refetch.
      staleTime: 60_000,
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  useEffect(() => {
    if (userError) {
      console.warn("Failed to fetch user data (non-critical):", userError);
    }
  }, [userError]);

  useSocket(user?.id);

  // ── Admin room listeners (Round-4, perf P1-3/P1-5) ────────────────────
  //
  // The backend has ALWAYS emitted `admin-stats-update` (topup
  // approve/reject + order bulk updates) but no client ever listened —
  // every admin page compensated with 20–30 s polling. `admin-alert-new`
  // is new (jobs/alertLogger emits on insert). With these listeners in
  // place, the covered admin queries invalidate ON EVENT and their
  // refetchIntervals are demoted to 5-minute heartbeat fallbacks (see
  // dashboard/orders/topups/users pages + AdminLayout alert pollers).
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
