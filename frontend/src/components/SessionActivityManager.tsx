import { useAuth } from "@/lib/auth";
import { SOCKET_RESYNC_EVENT, parkSocketIfConnected, reviveSocket } from "@/lib/socket";
import {
  invalidateAdminRealtimeFamilies,
  invalidateStorefrontTransactionalFamilies,
} from "@/lib/socket-resync";
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
 *
 * R127-B6-2 (B6 sockets audit): the visibility resync now ALSO carries
 * the admin realtime families (lib/socket-resync.ts) for admin
 * sessions. The park docblock in lib/socket.ts always claimed "the
 * catch-up invalidation on the next visibilitychange(visible)
 * (SessionActivityManager) covers events that fired while parked" —
 * but this component invalidated storefront families only, and a
 * deliberate park ("io client disconnect") never arms the resync
 * flag, so SOCKET_RESYNC_EVENT cannot fire on revive either. The
 * 300 s admin pages self-healed on their polls; tickets + risk-event
 * lists have NO polling, so a parked operator's queues stayed stale
 * indefinitely. Admin sessions pay the extra invalidations only on
 * the same throttled visibility cadence as everyone else.
 *
 * R127-B6-3: this component is also the STOREFRONT consumer of
 * SOCKET_RESYNC_EVENT (lib/socket.ts dispatches it exactly once per
 * documented disconnect → reconnect cycle). The R104 page-scoped
 * split left the event with no storefront listener — the money
 * screens (wallet.tsx / order-detail.tsx, both poll-less) stayed
 * stale through an active-tab network blip while the lib/socket.ts
 * docblock still promised the R96-M5 recovery. The storefront branch
 * is token-gated; the ADMIN branch of the same event stays in
 * SocketInitializer (admin sessions only) so neither session shape
 * double-invalidates.
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
      invalidateStorefrontTransactionalFamilies(queryClient);
      // R127-B6-2: a parked ADMIN tab missed admin-stats-update pushes
      // too — and tickets/risk (below) have no polling to fall back on.
      // Same throttled cadence as the storefront set above.
      if (adminToken) {
        invalidateAdminRealtimeFamilies(queryClient);
      }
    };

    // R127-B6-3: the storefront SOCKET_RESYNC_EVENT consumer — the
    // R96-M5 money-screen recovery restored. Fired exactly once per
    // documented disconnect → reconnect cycle by lib/socket.ts, so no
    // throttle is needed (the cycle itself is rate-limited by
    // reconnects). Token-gated: the admin families on this event are
    // SocketInitializer's branch (admin sessions only), keeping the
    // two listeners on disjoint key-sets.
    const handleSocketResyncEvent = () => {
      if (!token) return;
      invalidateStorefrontTransactionalFamilies(queryClient);
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
    // R127-B6-3: storefront money-screen recovery on socket reconnect.
    window.addEventListener(SOCKET_RESYNC_EVENT, handleSocketResyncEvent);
    document.addEventListener("pointerdown", handleActivity, { passive: true });
    document.addEventListener("keydown", handleActivity);

    return () => {
      clearParkTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener(SOCKET_RESYNC_EVENT, handleSocketResyncEvent);
      document.removeEventListener("pointerdown", handleActivity);
      document.removeEventListener("keydown", handleActivity);
    };
  }, [token, adminToken, queryClient]);

  return null;
}
