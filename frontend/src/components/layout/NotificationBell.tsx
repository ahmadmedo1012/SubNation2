import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bell,
  BellDot,
  CheckCheck,
  ExternalLink,
  Info,
  MessageSquare,
  Package,
  ShoppingBag,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatCount, formatRelativeTime } from "@/lib/utils";
import { NOTIFICATION_NEW_EVENT } from "@/lib/socket-events";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";

interface Notif {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * A9-2 (R126-L6): the history endpoint's hard cap — backend
 * routes/notifications.ts serves `.limit(40)` with no pagination params,
 * and this bell fetches it verbatim (no load-more). The footer count
 * used to read «40 إشعاراً» as if it were the user's lifetime total;
 * at exactly the cap the honest label is «آخر 40 …» (below the cap the
 * count IS the total — every row the user has is loaded). Full history
 * pagination (a /notifications page over ?page=) is deferred — see
 * the R126 worklog note.
 */
const NOTIFICATION_HISTORY_CAP = 40;

/**
 * Per-type presentation config for notification rows. Exported for the
 * status-token regression test (status-tokens.test.tsx).
 *
 * Colors ride the shared `--status-*` tokens (B6-P1-4): the previous
 * raw emerald/blue/purple/yellow Tailwind tuples were dark-mode-tuned
 * only — in the light theme they mis-tinted (too pale for AA contrast)
 * and bypassed the palette that status-badge/statusColor already
 * establish. `--status-purple` (support) was added to index.css for this.
 */
export const TYPE_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    color: string;
    bg: string;
    border: string;
    actionLabel?: string;
    actionIcon?: React.ElementType;
    actionHref?: string;
  }
> = {
  wallet: {
    icon: Wallet,
    color: "text-status-success",
    bg: "bg-status-success/10",
    border: "border-status-success/20",
    actionLabel: "المحفظة",
    actionIcon: ArrowLeft,
    actionHref: "/wallet",
  },
  order: {
    icon: ShoppingBag,
    color: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/20",
    actionLabel: "تفاصيل الطلب",
    actionIcon: ExternalLink,
    // Fallback destination when a notification carries no deep link —
    // without it the action chip (and the row's open affordance)
    // silently disappears for link-less order notifications.
    actionHref: "/orders",
  },
  support: {
    icon: MessageSquare,
    color: "text-status-purple",
    bg: "bg-status-purple/10",
    border: "border-status-purple/20",
    actionLabel: "التذكرة",
    actionIcon: ArrowLeft,
    actionHref: "/support",
  },
  loyalty: {
    icon: Star,
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    actionLabel: "نقاطي",
    actionIcon: ArrowLeft,
    actionHref: "/loyalty",
  },
  product: {
    icon: Package,
    // 94-C3 (A3 P2-4): text-primary → text-primary-text — the row icon
    // sits on a bg-primary/10 chip over a dark card; --primary (48%L) is
    // the surface variant, --primary-text (65%L) is the text/icon one.
    color: "text-primary-text",
    bg: "bg-primary/10",
    border: "border-primary/20",
    actionLabel: "تصفح",
    actionIcon: ArrowLeft,
    actionHref: "/",
  },
  system: {
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    border: "border-border/40",
  },
};

export function NotificationBell() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ── Refs (not state) for the polling closure to see the latest values ───
  //
  // The previous version held `prevUnreadIds` and `initialLoadDone` in
  // useState, but the polling effect's setInterval closure was keyed on
  // [token]. Once the effect ran, the closure captured the INITIAL state
  // values. Subsequent state updates re-rendered the component but did NOT
  // re-create the interval, so every 15 s the same stale closure ran with
  // `prevUnreadIds = Set()` and `initialLoadDone = false` — re-firing the
  // toast for every unread notification on every poll.
  //
  // Switching to refs: the polling closure reads `.current` which always
  // returns the latest value, no dep-array gymnastics needed.
  const lastSeenMaxIdRef = useRef<number>(0);
  const initialLoadDoneRef = useRef<boolean>(false);

  // 98-F7 (r97 F-10): request sequence for fetchAll — a slow 60 s poll
  // response that lands AFTER a socket-triggered refetch used to overwrite
  // the fresher list (last-arrival wins). Only the LATEST request may
  // write state.
  const fetchSeqRef = useRef(0);

  // 98-F7 (r97 F-10): latest-list mirror — the mark* callbacks below need
  // the PRE-optimistic snapshot for a failure rollback WITHOUT re-creating
  // their identities on every poll (same rationale as lastSeenMaxIdRef —
  // stable callbacks keep the panel prop identity stable). Synced after
  // every commit; read synchronously at click time (pre-flip state).
  const notifsRef = useRef<Notif[]>([]);
  useEffect(() => {
    notifsRef.current = notifs;
  }, [notifs]);

  const unread = notifs.filter((n) => !n.is_read).length;

  const fetchAll = useCallback(async () => {
    if (!token) return;
    const seq = ++fetchSeqRef.current;
    try {
      const r = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      // 98-F7 (r97 F-11 raw-fetch hardening): guard the parse AND the
      // shape — a 200 with a non-JSON body (proxy error page) used to
      // throw an uncaught rejection out of the .then chain; a 200 with
      // a non-array body would have called setNotifs(garbage).
      const data = (await r.json().catch(() => null)) as Notif[] | null;
      // 98-F7 (r97 F-10): late stale response (older poll racing a
      // socket-triggered refetch) must not overwrite the newer list —
      // only the latest request owns the state.
      if (seq !== fetchSeqRef.current) return;
      if (!Array.isArray(data)) return;
      setNotifs(data);

      // Compute the max notification id we've now received.
      const currentMaxId = data.reduce((m, n) => Math.max(m, n.id), 0);

      if (initialLoadDoneRef.current) {
        // Show a toast ONLY for genuinely new unread notifications (id is
        // monotonically increasing in the backend; comparing IDs is
        // O(1) and immune to reorderings).
        const brandNew = data.filter((n) => !n.is_read && n.id > lastSeenMaxIdRef.current);
        if (brandNew.length > 0) {
          // Show the most-recent one only — surfacing 5 toasts at once is
          // worse UX than the bell badge plus a single "you have new" hint.
          const latest = brandNew[0];
          toast({
            title: latest.title,
            description: latest.message ?? undefined,
            // Stable id per notification id so a duplicate poll cannot
            // create a duplicate toast even if our gate misfires.
            id: `notif-${latest.id}`,
          });
        }
      } else {
        initialLoadDoneRef.current = true;
      }

      lastSeenMaxIdRef.current = Math.max(lastSeenMaxIdRef.current, currentMaxId);
    } catch {
      // network blip — next 15 s tick retries
    }
  }, [token]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    // 98-F7 (r97 F-10): optimistic flip with EXACT rollback — the POST had
    // no try/catch and no r.ok check, so a network failure or 4xx/5xx left
    // the whole list visually "read" while the server never recorded it
    // (the badge lied until the next poll reverted it — up to 60 s).
    const snapshot = notifsRef.current;
    setNotifs(snapshot.map((n) => ({ ...n, is_read: true })));
    try {
      const r = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      // Roll the bell state back to the pre-click truth. Deliberately no
      // toast: the next 60 s poll / socket event reconciles silently —
      // the existing UX contract for this component.
      setNotifs(snapshot);
    }
  }, [token]);

  const markRead = useCallback(
    async (id: number) => {
      if (!token) return;
      // 98-F7 (r97 F-10): same optimistic + rollback contract per row. The
      // pre-state comes from the ref (the action chip can fire on an
      // already-read row — handleAction is unguarded there — so "unread"
      // cannot be assumed; the exact prior value is restored).
      const wasRead = notifsRef.current.find((n) => n.id === id)?.is_read ?? false;
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      try {
        const r = await fetch(`/api/notifications/${id}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch {
        setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: wasRead } : n)));
      }
    },
    [token],
  );

  const handleAction = useCallback(
    (n: Notif, href: string) => {
      void markRead(n.id);
      setOpen(false);
      navigate(href);
    },
    [markRead, navigate],
  );

  // Freshness strategy (Round-4, perf P1-4): the server pushes a
  // `notification-new` socket event the moment a notification row is
  // inserted — the socket listener (hooks/use-socket.ts) translates it
  // into the NOTIFICATION_NEW_EVENT window event and this component
  // refetches IMMEDIATELY (badge + toast land in ~1 RTT). The 60 s
  // interval below is only a socket-dropout fallback, still gated to
  // visible tabs (Round-3 8-c §2.2 — a backgrounded tab fires nothing).
  useEffect(() => {
    if (!token) {
      // Reset refs on logout so a re-login starts clean.
      lastSeenMaxIdRef.current = 0;
      initialLoadDoneRef.current = false;
      return;
    }
    void fetchAll();
    let id: ReturnType<typeof setInterval> | null = setInterval(() => void fetchAll(), 60_000);
    const onSocketNotification = () => void fetchAll();
    window.addEventListener(NOTIFICATION_NEW_EVENT, onSocketNotification);
    const onVisibility = () => {
      if (document.hidden) {
        if (id !== null) {
          clearInterval(id);
          id = null;
        }
      } else {
        void fetchAll();
        if (id === null) id = setInterval(() => void fetchAll(), 60_000);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (id !== null) clearInterval(id);
      window.removeEventListener(NOTIFICATION_NEW_EVENT, onSocketNotification);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, fetchAll]);

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
            {unread > 9 ? "9+" : unread}
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

function NotificationPanel({
  notifs,
  unread,
  onClose,
  onMarkAllRead,
  onMarkRead,
  onAction,
  anchorRect,
}: {
  notifs: Notif[];
  unread: number;
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  onAction: (n: Notif, href: string) => void;
  anchorRect: DOMRect | null;
}) {
  // ── Positioning ────────────────────────────────────────────────────────
  // Mobile (vw < 480): full-width, fixed below the top bar (top: 56px).
  // Desktop: anchored to the right edge of the bell button. We compute the
  // anchor position once on mount and don't react to window resize — opening
  // the panel during resize is a non-event we don't need to optimize.
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const isMobile = vw < 480;

  // 96-F5 (R96-M08 + M02 + M16): the mobile panel used to sit at a
  // hard-coded top: 56 with NO maxHeight. In the installed PWA
  // (black-translucent) the Navbar header now grows by
  // env(safe-area-inset-top), so 56 was wrong by exactly that inset —
  // and a long list ran past the viewport with the bottom rows
  // unreachable (position: fixed ignores page scroll). Derive the
  // offset from the header's REAL bottom edge (measured live from the
  // marker attribute Navbar sets) and cap the panel with a dvh-based
  // maxHeight so the body's overflow-y-auto actually engages.
  const headerEl =
    typeof document !== "undefined"
      ? document.querySelector<HTMLElement>('[data-navbar-header="1"]')
      : null;
  const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 56;

  // Compute panel position. On mobile we ignore anchorRect.
  // On desktop we right-align under the button, clamped 8px inside viewport.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        // 8px breathing gap below the real header bottom (safe-area
        // aware in PWA mode; 56 + inset + 8 in browser mode).
        top: headerBottom + 8,
        left: 8,
        right: 8,
        // 96-F5 (R96-M02): cap = viewport − header − 8px top gap − 8px
        // bottom gap, in dvh so the iOS URL-bar resize can't leave
        // rows below the fold. The flex-1 body then scrolls internally.
        maxHeight: `calc(100dvh - ${headerBottom + 16}px)`,
      }
    : (() => {
        const top = (anchorRect?.bottom ?? 56) + 8;
        // RTL anchoring: in this app the bell sits in the Navbar actions
        // cluster on the LEFT side of the screen (inline-end in RTL), so
        // a right-edge-anchored panel that grows leftward extends past
        // the left viewport edge and gets clipped on 480–1300px screens.
        // Anchor the panel's LEFT edge to the bell's left edge instead
        // (grows rightward, toward the reading flow origin), and clamp
        // so a narrow viewport can still fit a (shrunk) panel.
        const leftEdge = anchorRect?.left ?? 8;
        const width = Math.min(360, vw - leftEdge - 8);
        const left = Math.max(8, Math.min(leftEdge, vw - width - 8));
        return {
          position: "fixed",
          top,
          left,
          width,
          // R120-B1 (A3-F7): dvh straggler — the mobile branch above is
          // 100dvh; 100vh here overshot by the browser chrome on
          // dynamic-toolbar viewports, pushing the last rows under the
          // URL bar.
          maxHeight: `calc(100dvh - ${top + 16}px)`,
        };
      })();

  // C3 (V2 a11y audit): the portal'd panel is mounted at the END of
  // document.body — keyboard focus stays on the bell and Tab walks the
  // whole page before reaching the dialog. Move focus INTO the panel on
  // mount so the dialog is immediately operable (role="dialog" already
  // set below); Escape still closes it via the outer key handler.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-notification-panel="1"
      /* R124-A3 #10 (declare elevation once): the ghost-card pairing
         (near-invisible border/60 under a wide double shadow) is gone —
         the panel now rides the repo's defensible pairing (visible
         border + small shadow, same as ProductCard/Input/MobileNav).
         R115 (A10 a11y tail): z-50 keeps the panel INSIDE the modal
         layer instead of the old inline zIndex:70, which made it bleed
         above every Radix dialog (also z-50) — DOM order (this portal
         mounts at body end) still paints it above the Navbar. */
      className="bg-card border border-border/70 rounded-2xl shadow-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 outline-none z-50"
      style={panelStyle}
      role="dialog"
      aria-label="الإشعارات"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/20 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-bold text-sm">الإشعارات</span>
          {unread > 0 && (
            <span className="bg-primary text-primary-foreground text-3xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="-my-2 flex items-center gap-1.5 touch-target text-xs text-muted-foreground hover:text-primary-text transition-colors px-2.5 py-1.5 rounded-lg hover:bg-primary/8 press-spring"
            >
              <CheckCheck className="w-3 h-3" />
              {/* 93-C8 (A11 §2): unified mark-as-read verb. */}
              تحديد الكل كمقروء
            </button>
          )}
          {/* 94-C3 (A3 P1-3): 26×26 → 44×44 hit box; -my-2 keeps the
              header row from growing. */}
          <button
            type="button"
            onClick={onClose}
            className="-my-2 flex h-11 w-11 items-center justify-center touch-target p-1.5 rounded-lg hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors press-spring"
            aria-label="إغلاق"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {notifs.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <div className="relative w-14 h-14 mx-auto mb-3">
            <div className="absolute inset-0 rounded-2xl bg-muted/50 blur-sm" />
            <div className="relative w-14 h-14 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center">
              <Bell className="w-6 h-6 opacity-20" />
            </div>
          </div>
          <p className="text-sm font-bold text-foreground/60 mb-0.5">لا توجد إشعارات</p>
          <p className="text-xs text-muted-foreground">ستظهر هنا آخر التحديثات</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/25 scrollbar-none">
          {notifs.map((n) => {
            const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
            const IconComp = cfg.icon;
            const ActionIconComp = cfg.actionIcon;
            const actionHref = n.link ?? cfg.actionHref;

            return (
              <div
                key={n.id}
                className={`relative flex flex-col gap-0 px-4 py-3.5 transition-colors duration-150 ${
                  !n.is_read ? "bg-primary/[0.03]" : ""
                }`}
              >
                {!n.is_read && (
                  /* R124-A3 #12 (refuse rule): colored side stripes on list
                     rows stay at 1px — w-0.5 (2px) reduced to the system's
                     stripe language; the row tint + pulsing dot still
                     carry the unread state. */
                  <div className="absolute right-0 top-3 bottom-3 w-px bg-primary/60 rounded-full" />
                )}

                {/* Row body as a real button so keyboard/screen-reader users
                    can open the notification (previously a clickable div
                    with no focus path). */}
                <button
                  type="button"
                  className="flex items-start gap-3 text-start cursor-pointer hover:opacity-85 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl -m-1 p-1"
                  onClick={() => {
                    if (!n.is_read) onMarkRead(n.id);
                    if (actionHref) {
                      onClose();
                      onAction(n, actionHref);
                    }
                  }}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${cfg.bg} ${cfg.border}`}
                  >
                    <IconComp className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm font-semibold leading-snug ${
                          !n.is_read ? "text-foreground" : "text-foreground/75"
                        }`}
                      >
                        {n.title}
                      </p>
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 badge-pulse" />
                      )}
                    </div>
                    {n.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                        {n.message}
                      </p>
                    )}
                    <p className="text-3xs text-muted-foreground mt-1.5 font-semibold">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                </button>

                {(actionHref || cfg.actionLabel) && (
                  <div className="flex items-center gap-2 mt-2 mr-11">
                    {actionHref && cfg.actionLabel && (
                      <button
                        type="button"
                        onClick={() => onAction(n, actionHref)}
                        className={`flex min-h-11 items-center gap-1.5 text-2xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-150 hover:opacity-80 active:scale-95 ${cfg.bg} ${cfg.border} ${cfg.color}`}
                      >
                        {cfg.actionLabel}
                        {ActionIconComp && <ActionIconComp className="w-3 h-3" />}
                      </button>
                    )}
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkRead(n.id);
                        }}
                        className="flex min-h-11 items-center gap-1 text-2xs text-muted-foreground hover:text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/40 transition-all duration-150"
                      >
                        <CheckCheck className="w-2.5 h-2.5" />
                        تحديد كمقروء
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {notifs.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 text-center shrink-0">
          <p className="text-xs text-muted-foreground">
            {/* 93-C8 (A11 §3): Arabic plural paradigm via formatCount.
                A9-2 (R126-L6): at the backend's 40-row cap the count is
                the LOADED slice, not the lifetime total — prefix
                «آخر» so the label never overclaims. */}
            {notifs.length >= NOTIFICATION_HISTORY_CAP ? "آخر " : ""}
            {formatCount(notifs.length, {
              two: "إشعاران",
              few: "إشعارات",
              many: "إشعاراً",
              other: "إشعار",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
