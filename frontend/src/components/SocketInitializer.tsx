import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket } from "@/lib/socket";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

export function SocketInitializer() {
  const { token, adminToken } = useAuth();

  // Only fetch user data when we have a token
  const { data: user, error: userError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: 1,
    },
  });

  // Log user fetch errors (non-critical)
  useEffect(() => {
    if (userError) {
      console.warn("Failed to fetch user data (non-critical):", userError);
    }
  }, [userError]);

  // User Socket
  useSocket(user?.id);

  // Admin Socket
  useEffect(() => {
    if (adminToken) {
      const init = async () => {
        try {
          await connectAdminSocket();
        } catch (err) {
          console.warn("Admin socket connection failed (non-critical):", err);
        }
      };
      init();
    }
  }, [adminToken]);

  return null;
}
