import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// R158 (hooks lane — decomposition): the notifications data machine
// (the notifs/loadState atoms, the poll/socket/resync freshness
// effect, the fetch-sequence + latest-list refs and the optimistic
// mark-read pair) moved verbatim to @/hooks/useNotifications — this
// file keeps the open/close UI wiring, the button and the portal
// mount. The Notif row shape is the hook's exported contract now.
//
// R167 (layout decomposition — F13): the panel, its per-item row, its
// footer link and the TYPE_CONFIG table moved verbatim to ./bell/
// (NotificationPanel / NotificationRow / PanelFooter / type-config).
// TYPE_CONFIG's public address survives via the re-export below (the
// NAV_SECTIONS re-export idiom — status-tokens.test.tsx and
// pages/notifications.tsx keep importing it from here).
import { Bell, BellDot } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatCount } from "@/lib/utils";
import { useNotifications, type Notif } from "@/hooks/useNotifications";
import { useLocation } from "wouter";
import { NotificationPanel } from "./bell/NotificationPanel";

export { TYPE_CONFIG } from "./bell/type-config";

export function NotificationBell() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // R158 (hooks lane): the data machine — notifs/unread/loadState +
  // fetchAll/markAllRead/markRead (the 60 s visible-tab poll, the
  // NOTIFICATION_NEW_EVENT / SOCKET_RESYNC_EVENT accelerators, the
  // fetch-seq guard and the optimistic mark-read rollbacks) — lives in
  // @/hooks/useNotifications; the call site sits where the machine's
  // own effects used to, so effect execution order is unchanged.
  const { notifs, unread, loadState, fetchAll, markAllRead, markRead } = useNotifications({
    token,
  });

  const handleAction = useCallback(
    (n: Notif, href: string) => {
      void markRead(n.id);
      setOpen(false);
      navigate(href);
    },
    [markRead, navigate],
  );

  // Close on outside click. The ref closure is fine here because
  // wrapRef.current is mutated by React, not captured.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      // Account for the portal'd panel — clicks INSIDE the panel must not
      // count as "outside". The panel has data-notification-panel="1".
      const target = e.target as Element | null;
      if (target?.closest('[data-notification-panel="1"]')) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // R157: close on page scroll — the panel is position:fixed computed at
  // open (resize deliberately ignored), so scrolling the page left it
  // floating mid-air while the bell scrolled away. Closing is cheaper
  // and more honest than repositioning; passive — it never blocks the
  // scroll. The same one-gesture dismissal class as the outside-click.
  // NOTE capture:true + the panel-body guard: the panel's own list is
  // overflow-y-auto (line ~679) — a scroll INSIDE the panel must not
  // close it, so the handler ignores scrolls whose target sits within
  // [data-notification-panel], exactly like the mousedown handler.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-notification-panel="1"]')) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!token) return null;

  return (
    <div className="relative" ref={wrapRef}>
      {/* Bell button — 94-C3 (A3 P1-3): touch-target lifts the hit box
          from 32×32 (p-2 + w-4 icon) to the 44×44 WCAG 2.5.5 floor.
          R120-B1 (A4-F7): the accessible name carries the unread count
          (mirroring the cart idiom «السلة، N منتج») — a screen-reader
          user heard «الإشعارات» with no signal that anything was
          unread. 9+ cap matches the visual badge. */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 touch-target rounded-lg transition-all duration-150 active:scale-90 ${
          open
            ? "bg-primary/12 text-primary-text"
            : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground"
        }`}
        aria-label={
          unread > 0
            ? `الإشعارات، ${
                unread > 9
                  ? "9+"
                  : formatCount(unread, {
                      one: "إشعار غير مقروء",
                      two: "إشعاران غير مقروءان",
                      few: "إشعارات غير مقروءة",
                      many: "إشعاراً غير مقروءاً",
                      other: "إشعار غير مقروء",
                    })
              }`
            : "الإشعارات"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {unread > 0 ? <BellDot className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 bg-primary text-primary-foreground text-3xs font-bold rounded-full flex items-center justify-center px-0.5 shadow-md shadow-primary/30 badge-pulse">
            {/* R128-A5 (A5-3): the count swap pops — an inner span keyed on
                the DISPLAYED value so num-pop replays when the visible
                number changes without displacing the outer badge-pulse
                (two `animation` declarations can't share one element; the
                pulse owns the shell, the pop owns the number). */}
            <span key={unread > 9 ? "9+" : String(unread)} className="num-pop">
              {unread > 9 ? "9+" : unread}
            </span>
          </span>
        )}
      </button>

      {/* Panel — portal'd to <body> to escape any parent transform / overflow.
          Mobile: full-width, fixed under the top bar.
          Desktop: 360px wide, anchored under the bell. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <NotificationPanel
            notifs={notifs}
            unread={unread}
            loadState={loadState}
            onRetry={() => void fetchAll()}
            onClose={() => setOpen(false)}
            onMarkAllRead={() => void markAllRead()}
            onMarkRead={(id) => void markRead(id)}
            onAction={handleAction}
            anchorRect={buttonRef.current?.getBoundingClientRect() ?? null}
          />,
          document.body,
        )}
    </div>
  );
}
