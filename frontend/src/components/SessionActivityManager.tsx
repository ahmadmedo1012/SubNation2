import { useAuth } from "@/lib/auth";
import { parkSocketIfConnected, reviveSocket } from "@/lib/socket";
import {
  getGetMeQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * R104 (free-tier sleep economics) — session-scoped activity manager.
 *
 * WHY THIS EXISTS: the Socket.IO engine exchanges ping/pong frames every
 * 25 s per connected socket. Inbound frames reset Render's 15-minute
 * idle timer, so ANY open socket (in a forgotten tab, a phone in a
 * pocket, a user who walked away) keeps the free instance awake 24/7 —
 * one such tab ≈ 730 of the 750 shared instance-hours/month. This
 * component makes socket liveness follow PRESENCE instead:
 *
 *   • user active (foreground + interaction within 30 min) → socket may
 *     stay connected (realtime is genuinely useful while someone is
 *     looking at the screen — and active use generates traffic anyway);
 *   • tab hidden ≥ 15 min → PARK (disconnect, listeners survive);
 *   • foreground but idle (no interaction) ≥ 30 min → PARK;
 *   • any interaction / tab visible / network online → REVIVE.
 *
 * It also owns the transactional resync previously driven by the
 * always-on socket (96-F3): on visibilitychange(visible), throttled to
 * one per 30 s, the money/identity query families (orders, wallet,
 * topups, me) are invalidated so a returning user sees current state —
 * no socket required. Catalog families are deliberately excluded (same
 * anti-refetch-storm policy as the QueryClient defaults in App.tsx).
 */

/** Foreground idle threshold: park the socket after this long without
 * a pointer/keyboard interaction. Active reading of a static page for
 * half an hour is not a realtime session. */
const FOREGROUND_IDLE_PARK_MS = 30 * 60_000;

/** Hidden-tab threshold: a backgrounded tab parks sooner — nobody sees
 * its toasts, and mobile OSes freeze timers past this anyway. */
const HIDDEN_PARK_MS = 15 * 60_000;

/** Minimum spacing between visibility-driven resyncs (96-F3 parity). */
const VISIBILITY_RESYNC_THROTTLE_MS = 30_000;

/**
 * The TRANSACTIONAL query families — exactly the set use-socket.ts
 * invalidates on live events, reusing its key shapes:
 *   - orders list + every open order-detail (predicate sweep — the
 *     detail key is [`/api/orders/${orderCode}`]);
 *   - wallet balance ([ "/api/wallet" ]);
 *   - wallet topups ([ "/api/wallet/topups" ]);
 *   - current user ([ "/api/auth/me" ]).
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
 * Mounted once at the App root (inside <AuthGate>). Renders nothing.
 * Guests run the listeners but they are all no-ops for them (no socket
 * singleton exists, and the resync invalidations only touch queries
 * that are disabled without a token).
 */
export function SessionActivityManager() {
  const { token, adminToken } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    let parkTimer: ReturnType<typeof setTimeout> | null = null;
    let lastVisibilityResyncAt = 0;

    const clearParkTimer = () => {
      if (parkTimer !== null) {
        clearTimeout(parkTimer);
        parkTimer = null;
      }
    };

    const schedulePark = () => {
      clearParkTimer();
      const hidden = document.visibilityState === "hidden";
      parkTimer = setTimeout(
        () => {
          parkTimer = null;
          parkSocketIfConnected();
        },
        hidden ? HIDDEN_PARK_MS : FOREGROUND_IDLE_PARK_MS,
      );
    };

    const resyncIfDue = () => {
      // Money/identity freshness for the returning user — only for
      // authed sessions (guests have none of these queries active).
      if (!token && !adminToken) return;
      const now = Date.now();
      if (now - lastVisibilityResyncAt < VISIBILITY_RESYNC_THROTTLE_MS) return;
      lastVisibilityResyncAt = now;
      invalidateTransactionalQueries(queryClient);
    };

    const handleActivity = () => {
      // Real user presence: any interaction revives the socket (if one
      // exists — never creates one) and re-arms the idle park timer.
      clearParkTimer();
      if (document.visibilityState === "visible") {
        reviveSocket();
      }
      schedulePark();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reviveSocket();
        resyncIfDue();
      }
      schedulePark();
    };

    const handleOnline = () => {
      // 96-F3 parity: network restoration revives the socket; the
      // resync flag in lib/socket.ts fires SOCKET_RESYNC_EVENT on the
      // next successful connect for socket-holding pages.
      reviveSocket();
    };

    const handlePageHide = () => {
      // pagehide (tab close / navigation away): nothing to revive later
      // in this page lifetime — let the browser tear everything down.
      clearParkTimer();
    };

    // Start the initial park schedule immediately.
    schedulePark();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("pointerdown", handleActivity, { passive: true });
    document.addEventListener("keydown", handleActivity);

    return () => {
      clearParkTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("pointerdown", handleActivity);
      document.removeEventListener("keydown", handleActivity);
    };
  }, [token, adminToken, queryClient]);

  return null;
}
