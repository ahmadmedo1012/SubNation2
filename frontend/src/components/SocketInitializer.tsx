import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket, reviveSocket, SOCKET_RESYNC_EVENT } from "@/lib/socket";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
import { getGetMeQueryKey, getGetWalletQueryKey, getListTopupsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Socket } from "socket.io-client";

/**
 * 96-F3 (R96 A4 §2.1): minimum spacing between visibility-driven
 * resyncs. The inspection fix direction asks for "data older than
 * ~30 s"; a plain 30 s throttle on the resync itself achieves the
 * same freshness bound with less machinery (no per-query
 * dataUpdatedAt walking) and still cannot storm the DB — the catalog
 * families are excluded entirely.
 */
const VISIBILITY_RESYNC_THROTTLE_MS = 30_000;

/**
 * Invalidate the TRANSACTIONAL query families — exactly the set
 * use-socket.ts invalidates on live events, reusing its key shapes:
 *
 *   - orders list + every open order-detail: the same predicate sweep
 *     over the "/api/orders" key prefix (the detail key is
 *     [`/api/orders/${orderCode}`] and params variants exist for the
 *     list, so only a predicate reaches them all);
 *   - wallet balance ([ "/api/wallet" ]);
 *   - wallet topups ([ "/api/wallet/topups" ]);
 *   - current user ([ "/api/auth/me" ]).
 *
 * Catalog/product queries are deliberately NOT invalidated — that
 * preserves the intentional anti-refetch-storm decision documented on
 * the QueryClient defaults (App.tsx: refetchOnWindowFocus/Reconnect
 * false). Money and identity state must not silently go stale; the
 * catalog can wait for its own staleness window.
 */
function invalidateTransactionalQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return typeof first === "string" && first.startsWith("/api/orders");
    },
  });
  void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  void queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
}

/**
 * Mounted once at the App root (after `<AuthProvider>`, token-gated by
 * DeferredSocketInitializer). Wires:
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
 *
 * 96-F3 (R96 M1 + M5 + A4 §2.1): additionally owns the network
 * resilience glue — socket revival on online/visibilitychange and the
 * one-shot transactional resync on reconnect (via the
 * `subnation:socket-resync` window event lib/socket.ts dispatches).
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

  // ── 96-F3 (R96 M1 + M5 + A4 §2.1): revival + one-shot resync ───────────
  //
  //   a. `online` / visibilitychange(visible): revive the socket when
  //      it exists but is not connected. socket.connect() is
  //      idempotent. This covers the paths socket.io does NOT
  //      auto-recover by itself: the old 5-attempt surrender (now
  //      Infinity, but a server-initiated disconnect still never
  //      auto-reconnects) and manager states a browser
  //      background/sleep cycle can leave behind.
  //
  //   b. `subnation:socket-resync`: dispatched by lib/socket.ts when
  //      the socket connects after a DOCUMENTED disconnect — one event
  //      per reconnect cycle. The transactional families above are
  //      invalidated exactly once; the refetches carry the events
  //      that were missed while offline (order status flips, topup
  //      approvals, wallet balance, identity).
  //
  //   c. visibilitychange(visible): the same transactional resync,
  //      throttled to one per 30 s — a phone reopening the app after
  //      minutes in a pocket sees current money state instead of the
  //      pre-sleep snapshot (NotificationBell already refetches on
  //      visibility for its own query; this covers the rest).
  useEffect(() => {
    let lastVisibilityResyncAt = 0;

    const handleResyncEvent = () => {
      invalidateTransactionalQueries(queryClient);
    };

    const handleOnline = () => {
      reviveSocket();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      reviveSocket();
      const now = Date.now();
      if (now - lastVisibilityResyncAt < VISIBILITY_RESYNC_THROTTLE_MS) return;
      lastVisibilityResyncAt = now;
      invalidateTransactionalQueries(queryClient);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(SOCKET_RESYNC_EVENT, handleResyncEvent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient]);

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
