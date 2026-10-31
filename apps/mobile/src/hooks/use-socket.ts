import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  getGetMeQueryKey,
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
} from "@workspace/api-client-native";

import { API_URL } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-store";
import { useAuth } from "@/lib/auth";

type SocketEvents = { [event: string]: (payload: unknown) => void };

// Module-level singleton (the web's lib/socket.ts discipline): one socket
// for the app no matter how many screens mount the hook, torn down when
// the last consumer unmounts — never a second connection per navigation.
let socket: Socket | null = null;
let mounted = 0;

/**
 * Page-scoped realtime for the money surfaces (the native arm of the
 * web's useSocket): connects a Socket.IO client to the API origin with
 * the native session as `auth.userToken` (the backend handshake field —
 * backend/src/lib/socket/auth.ts reads it when no auth_token cookie
 * rides along, which is exactly the native case), ONLY while the user
 * is authenticated.
 *
 * Built-in listeners (money that moved must reach every surface the
 * moment the server says so — the web's R-140-o resync rule; review
 * R7-a P2-1: the catalog now mirrors the backend's ACTUAL user-room
 * emitters — topup-updated / order-updated / notification-new — the
 * previous "wallet" listener was dead code, the backend never emits
 * it):
 *   • "topup-updated"    → invalidate the topups list, the wallet probe
 *     and the ledger (a pending→approved flip lands in-page).
 *   • "order-updated"    → the web's useSocket twin: a predicate sweep
 *     over every "/api/orders" cache entry (the list AND every open
 *     detail page — the detail key is built from orderCode, a prefix
 *     matcher can't reach it) + the wallet/me/ledger set (R187 B-F1:
 *     a REFUND emits exactly this event after crediting the money).
 *   • "notification-new" → invalidate the notifications family (the
 *     paged key + the badge count recompute on next read).
 *   • "connect"          → the web's reconnect-resync twin: events
 *     missed while the socket was down replay as one invalidation
 *     sweep over the same families (reconnection stays on).
 *
 * Callers pass additional `{ event: handler }` pairs; handlers are read
 * through a ref indirection, so re-renders with new closures NEVER
 * re-subscribe (no listener stacking, no re-render storms).
 *
 * Transport errors are console-warned only — Socket.IO reconnects on
 * its own (reconnection stays on) and the query invalidations double as
 * the recovery path when a reconnect eventually lands.
 */
export function useSocket(events: SocketEvents = {}): void {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (status !== "authenticated") return;
    let disposed = false;
    mounted += 1;

    const invalidateMoney = () => {
      void queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });
    };
    // "order-updated" carries { id, status, order_code? } — the money
    // invalidation rides unconditionally (the web twin's own documented
    // reason: a non-refund status moves no money, and the extra refetch
    // of unchanged data is harmless — ONE code path for the pair).
    const invalidateOrders = () => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return typeof first === "string" && first.startsWith("/api/orders");
        },
      });
      void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });
    };
    const invalidateNotifications = () => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return typeof first === "string" && first.startsWith("/api/notifications");
        },
      });
    };
    const resyncAll = () => {
      invalidateMoney();
      invalidateOrders();
      invalidateNotifications();
    };

    void (async () => {
      const token = await getStoredToken();
      if (disposed || !token) return;
      if (!socket) {
        socket = io(API_URL, {
          // The native session is the 30-day JWT from SecureStore — the
          // server's handshake reads auth.userToken and joins the user's
          // room server-side (room membership is never client-driven).
          auth: { userToken: token },
          reconnection: true,
        });
        socket.on("topup-updated", invalidateMoney);
        socket.on("order-updated", invalidateOrders);
        socket.on("notification-new", invalidateNotifications);
        // Reconnect resync: whatever the socket missed while down lands
        // as one sweep (fires on the FIRST connect too — a fresh boot's
        // queries are already in flight, the sweep is then a no-op-ish
        // refetch of in-flight keys, react-query dedupes them).
        socket.on("connect", resyncAll);
        socket.on("connect_error", (error: Error) => {
          console.warn(`[socket] connect_error: ${error.message}`);
        });
      }
      // Ref-indirection registration: the latest closure fires without
      // ever re-subscribing (and duplicate names are off'd first so a
      // remount can never stack a second listener for one event).
      for (const name of Object.keys(eventsRef.current)) {
        socket.off(name);
        socket.on(name, (payload: unknown) => eventsRef.current[name]?.(payload));
      }
    })();

    return () => {
      disposed = true;
      mounted -= 1;
      if (mounted <= 0 && socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, [status, queryClient]);
}
