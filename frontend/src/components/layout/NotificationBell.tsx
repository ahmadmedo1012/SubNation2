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
import { formatRelativeTime } from "@/lib/utils";
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

const TYPE_CONFIG: Record<
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
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    actionLabel: "المحفظة",
    actionIcon: ArrowLeft,
    actionHref: "/wallet",
  },
  order: {
    icon: ShoppingBag,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    actionLabel: "تفاصيل الطلب",
    actionIcon: ExternalLink,
  },
  support: {
    icon: MessageSquare,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    actionLabel: "التذكرة",
    actionIcon: ArrowLeft,
    actionHref: "/support",
  },
  loyalty: {
    icon: Star,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    actionLabel: "نقاطي",
    actionIcon: ArrowLeft,
    actionHref: "/loyalty",
  },
  product: {
    icon: Package,
    color: "text-primary",
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

  const unread = notifs.filter((n) => !n.is_read).length;

  const fetchAll = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data: Notif[] = await r.json();
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
    await fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [token]);

  const markRead = useCallback(
    async (id: number) => {
      if (!token) return;
      await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
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

  // Poll every 15 s. Effect re-runs only when token changes; the closure
  // reads the latest refs on each tick, so we don't need to rebuild the
  // interval on every render.
  useEffect(() => {
    if (!token) {
      // Reset refs on logout so a re-login starts clean.
      lastSeenMaxIdRef.current = 0;
      initialLoadDoneRef.current = false;
      return;
    }
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 15_000);
    return () => clearInterval(id);
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
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 rounded-lg transition-all duration-150 active:scale-90 ${
          open
            ? "bg-primary/12 text-primary"
            : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground"
        }`}
        aria-label="الإشعارات"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {unread > 0 ? <BellDot className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5 shadow-md shadow-primary/30 badge-pulse">
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
  const [vw, setVw] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const isMobile = vw < 480;

  // Compute panel position. On mobile we ignore anchorRect.
  // On desktop we right-align under the button, clamped 8px inside viewport.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        top: 56, // below the typical 48–52px top bar
        left: 8,
        right: 8,
        zIndex: 70,
      }
    : (() => {
        const top = (anchorRect?.bottom ?? 56) + 8;
        // Right edge of the panel sits at `anchorRect.right`, panel grows leftward.
        const rightEdge = anchorRect?.right ?? vw - 16;
        const right = Math.max(8, vw - rightEdge);
        return {
          position: "fixed",
          top,
          right,
          width: 360,
          maxHeight: `calc(100vh - ${top + 16}px)`,
          zIndex: 70,
        };
      })();

  return (
    <div
      data-notification-panel="1"
      className="bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/35 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
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
            <span className="bg-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-primary/8 press-spring"
            >
              <CheckCheck className="w-3 h-3" />
              قراءة الكل
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors press-spring"
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
                  <div className="absolute right-0 top-3 bottom-3 w-0.5 bg-primary/60 rounded-full" />
                )}

                <div
                  className="flex items-start gap-3 cursor-pointer hover:opacity-85 transition-opacity"
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
                    <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                </div>

                {(actionHref || cfg.actionLabel) && (
                  <div className="flex items-center gap-2 mt-2 mr-11">
                    {actionHref && cfg.actionLabel && (
                      <button
                        onClick={() => onAction(n, actionHref)}
                        className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all duration-150 hover:opacity-80 active:scale-95 ${cfg.bg} ${cfg.border} ${cfg.color}`}
                      >
                        {cfg.actionLabel}
                        {ActionIconComp && <ActionIconComp className="w-3 h-3" />}
                      </button>
                    )}
                    {!n.is_read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkRead(n.id);
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-muted-foreground px-2 py-1 rounded-lg hover:bg-muted/40 transition-all duration-150"
                      >
                        <CheckCheck className="w-2.5 h-2.5" />
                        تمييز كمقروء
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
          <p className="text-xs text-muted-foreground">{notifs.length} إشعار</p>
        </div>
      )}
    </div>
  );
}
