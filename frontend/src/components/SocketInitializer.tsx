import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket } from "@/lib/socket";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

export function SocketInitializer() {
  const { token, adminToken } = useAuth();
  const { data: user } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
    },
  });

  // User Socket
  useSocket(user?.id);

  // Admin Socket
  useEffect(() => {
    if (adminToken) {
      connectAdminSocket();
    } else if (!token) {
      // If neither token nor adminToken, disconnect
      // disconnectSocket();
    }
  }, [adminToken, token]);

  return null;
}
