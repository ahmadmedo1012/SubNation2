/**
 * Window CustomEvent names used to bridge Socket.IO events to components
 * that hold their data OUTSIDE react-query (raw fetch + local state).
 *
 * Round-4 (perf P1-4/P1-5): the server now pushes `notification-new` and
 * `admin-alert-new` the moment rows are inserted. The socket listeners
 * (hooks/use-socket.ts user branch, SocketInitializer admin branch)
 * translate them into these window events so the owning components
 * (NotificationBell, AdminLayout's alert-toast poller) can refetch
 * immediately and keep their own dedupe/toast logic in one place — the
 * polls become fallbacks instead of the primary freshness mechanism.
 */

/** Fired on `notification-new`: NotificationBell refetches (badge + toast). */
export const NOTIFICATION_NEW_EVENT = "subnation:notification-new";

/** Fired on `admin-alert-new`: AdminLayout's alert poller runs immediately. */
export const ADMIN_ALERT_NEW_EVENT = "subnation:admin-alert-new";
