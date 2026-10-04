import type { Socket } from "socket.io-client";
import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey, getListTopupsQueryKey } from "@workspace/api-client-react";
import { connectSocket } from "../lib/socket";
import { NOTIFICATION_NEW_EVENT } from "../lib/socket-events";
import { formatCurrency, statusLabel } from "@/lib/utils";

/**
 * Subscribe to user-scoped Socket.IO events.
 *
 * R104 (free-tier sleep economics): this hook is PAGE-SCOPED. It used to
 * be mounted at the App root for every authenticated user — a 25 s
 * ping/pong socket held for the whole session that kept the Render free
 * instance permanently awake (voiding the accepted sleep design). Now
 * only the pages with a genuine realtime need mount it: order-detail
 * (watching a fresh purchase flip to delivered) and the wallet page
 * (R116-S2: watching a pending topup flip to approved/rejected in-page
 * after the waiting modal closes). While mounted it:
 *
 *   - order-updated → toast "تم تحديث حالة طلبك …" + invalidate orders
 *   - topup-updated → toast (success or destructive based on status)
 *   - notification-new → window event → NotificationBell refetch
 *
 * Every other storefront surface runs on its existing fallbacks
 * (NotificationBell 60 s foreground poll, TopupWaitingModal 3 s
 * FOREGROUND poll while pending — R116-S2: no background polling — and
 * SessionActivityManager visibility resync). The socket parks when the
 * tab is hidden ≥ 15 min or idle ≥ 30 min
 * (SessionActivityManager) and revives on user presence.
 *
 * All toasts route through the unified `@/hooks/use-toast` shim (Sonner
 * under the hood) so a single Toaster instance owns the stack — no
 * duplicates, no stuck-on-screen failures.
 *
 * Errors from the socket transport are warned to the console but never
 * surfaced to the user; the Socket.IO adapter retries automatically
 * (bounded to 10 attempts — presence revival covers the rest).
 */
export function useSocket(userId?: number | string) {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const init = async () => {
      try {
        const socket = await connectSocket(userId);
        if (!active || !socket) return;

        socketRef.current = socket;

        socket.on(
          "order-updated",
          (data: { id: number | string; status: string; order_code?: string | null }) => {
            // 93-C5 / F-15 (A4 #14): the toast said "تم تحديث حالة طلبك"
            // while the visible orders list AND the open order-detail page
            // kept the old status — the screen contradicted its own toast
            // until a manual reload/navigation. Invalidate every
            // /api/orders* cache entry the moment the server flips the
            // status (mirrors the topup-updated handler's invalidations).
            //
            // The event carries the numeric orderId, but the order-detail
            // query key is built from the orderCode string
            // ([`/api/orders/${orderCode}`]) — a key-prefix matcher can't
            // reach it, so a predicate sweep covers both the list (all its
            // param variants) and every open detail page.
            void queryClient.invalidateQueries({
              predicate: (query) => {
                const first = query.queryKey[0];
                return typeof first === "string" && first.startsWith("/api/orders");
              },
            });
            // R94-A1 #15 (P3): every storefront surface identifies orders
            // by order_code (SNDB…) — a "#42" toast sent the user hunting
            // for an id format that exists nowhere in the UI. The payload
            // is forward-compatible: order_code is used when the backend
            // includes it (backend routes/admin/orders.ts:182,273 — emit
            // follow-up), falling back to the plain numeric id.
            const orderRef =
              typeof data.order_code === "string" && data.order_code
                ? `طلبك ${data.order_code}`
                : `طلبك رقم #${data.id}`;
            toast({
              title: `تم تحديث حالة ${orderRef}`,
              // Round-3 (8-e §3): raw English status enum ("processing",
              // "completed") leaked into an Arabic toast — route it through
              // the same statusLabel() mapping every storefront page uses.
              description: `الحالة الجديدة: ${statusLabel(data.status)}`,
              id: `order-${data.id}-${data.status}`,
            });
          },
        );

        socket.on("topup-updated", (data: { amount: number; status: string }) => {
          // Refresh both queries the moment the server flips the topup
          // status. The waiting modal subscribes to these queries, so
          // approval/rejection lands on screen without waiting for the
          // 3s polling fallback.
          queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });

          if (data.status === "approved") {
            toast({
              title: `تم شحن المحفظة`,
              // Round-3 (8-e §1.3): raw data.amount rendered "5" instead of
              // the money-formatted "5.00" every other topup surface shows.
              description: `${formatCurrency(data.amount)} أُضيفت إلى رصيدك`,
              id: `topup-${data.amount}-approved`,
            });
          } else {
            toast({
              title: `تم رفض طلب الشحن`,
              variant: "destructive",
              id: `topup-${data.amount}-${data.status}`,
            });
          }
        });

        socket.on("notification-new", (data: { id: number; type: string }) => {
          // The bell component owns the fetch/toast/badge logic (with
          // lastSeenMaxId dedupe) — we only nudge it to refetch NOW.
          // Toasting here as well would double-fire for the same id.
          window.dispatchEvent(new CustomEvent(NOTIFICATION_NEW_EVENT, { detail: data }));
        });

        socket.on("connect_error", (error: Error) => {
          // Non-critical: Socket.IO retries automatically. Surface in DevTools
          // for debugging without disturbing the user.
          console.warn("[socket] connect_error:", error.message);
        });

        socket.on("error", (error: Error) => {
          console.warn("[socket] error:", error.message);
        });
      } catch (err) {
        console.warn("[socket] initialization failed (non-critical):", err);
      }
    };

    void init();

    return () => {
      active = false;
      if (socketRef.current) {
        socketRef.current.off("order-updated");
        socketRef.current.off("topup-updated");
        socketRef.current.off("notification-new");
        socketRef.current.off("connect_error");
        socketRef.current.off("error");
      }
    };
    // R116-S2 (use-socket.ts:155 exhaustive-deps): queryClient listed —
    // the effect closes over it (three invalidation calls). It is a
    // stable reference from useQueryClient() (documented TanStack
    // contract), so listing it cannot re-run the effect in practice;
    // the real risk was the opposite direction (a future swap to a
    // context-derived client would silently keep the stale one).
  }, [userId, queryClient]);
}
