import { useEffect } from "react";
import { toast } from "sonner";
import { connectSocket, getSocket } from "../lib/socket";

export function useSocket(userId?: number | string) {
  useEffect(() => {
    if (!userId) return;

    const socket = connectSocket(userId);

    socket.on("order-updated", (data) => {
      console.log("Order updated:", data);
      toast.success(`تم تحديث حالة طلبك #${data.id} إلى ${data.status}`);
      // In a real app, we would invalidate React Query queries here
    });

    socket.on("topup-updated", (data) => {
      console.log("Topup updated:", data);
      if (data.status === "approved") {
        toast.success(`تم شحن محفظتك بـ ${data.amount} د.ل بنجاح!`);
      } else {
        toast.error(`تم رفض طلب الشحن الخاص بك`);
      }
    });

    return () => {
      socket.off("order-updated");
      socket.off("topup-updated");
    };
  }, [userId]);
}
