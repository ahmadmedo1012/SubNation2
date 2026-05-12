import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { connectSocket, getSocket } from "../lib/socket";

export function useSocket(userId?: number | string) {
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const init = async () => {
      try {
        const socket = await connectSocket(userId);
        if (!active || !socket) return;
        
        socketRef.current = socket;

        socket.on("order-updated", (data: { id: number | string; status: string }) => {
          console.log("Order updated:", data);
          toast.success(`تم تحديث حالة طلبك #${data.id} إلى ${data.status}`);
        });

      socket.on("topup-updated", (data: { amount: number; status: string }) => {
        console.log("Topup updated:", data);
        if (data.status === "approved") {
          toast.success(`تم شحن محفظتك بـ ${data.amount} د.ل بنجاح!`);
        } else {
          toast.error(`تم رفض طلب الشحن الخاص بك`);
        }
      });

      socket.on("connect_error", (error: Error) => {
        console.warn("Socket connection error (non-critical):", error.message);
      });

        socket.on("error", (error: Error) => {
          console.warn("Socket error (non-critical):", error.message);
        });
      } catch (err) {
        console.warn("Socket initialization failed (non-critical):", err);
      }
    };

    init();

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
