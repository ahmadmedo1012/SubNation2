import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { connectAdminSocket } from "@/lib/socket";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";

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

  useEffect(() => {
    if (adminToken) {
      void connectAdminSocket().catch((err) => {
        console.warn("Admin socket connection failed (non-critical):", err);
      });
    }
  }, [adminToken]);

  return null;
}
