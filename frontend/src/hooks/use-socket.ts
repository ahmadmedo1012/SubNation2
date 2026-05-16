import type { Socket } from "socket.io-client";
import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { connectSocket } from "../lib/socket";

/**
 * Subscribe to user-scoped Socket.IO events.
 *
 * Emits:
 *   - order-updated → toast "تم تحديث حالة طلبك …"
 *   - topup-updated → toast (success or destructive based on status)
 *
 * All toasts route through the unified `@/hooks/use-toast` shim (Sonner
 * under the hood) so a single Toaster instance owns the stack — no
 * duplicates, no stuck-on-screen failures.
 *
 * Errors from the socket transport are warned to the console but never
 * surfaced to the user; the Socket.IO adapter retries automatically.
 */
export function useSocket(userId?: number | string) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const init = async () => {
      try {
        const socket = await connectSocket(userId);
        if (!active || !socket) return;

        socketRef.current = socket;

        socket.on("order-updated", (data: { id: number | string; status: string }) => {
          toast({
            title: `تم تحديث حالة طلبك #${data.id}`,
            description: `الحالة الجديدة: ${data.status}`,
            id: `order-${data.id}-${data.status}`,
          });
        });

        socket.on("topup-updated", (data: { amount: number; status: string }) => {
          if (data.status === "approved") {
            toast({
              title: `تم شحن المحفظة`,
              description: `${data.amount} د.ل أُضيفت إلى رصيدك`,
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
        socketRef.current.off("connect_error");
        socketRef.current.off("error");
      }
    };
  }, [userId]);
}
