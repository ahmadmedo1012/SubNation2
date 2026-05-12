import { useState, useEffect, useRef } from "react";
import {
  Bell,
  BellDot,
  CheckCheck,
  Wallet,
  ShoppingBag,
  MessageSquare,
  Star,
  Info,
  X,
  Package,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [prevUnreadIds, setPrevUnreadIds] = useState<Set<number>>(new Set());
  const initialLoadDone = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const unread = notifs.filter((n) => !n.is_read).length;
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const fetch_ = async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/notifications", { headers });
      if (!r.ok) return;
      const data: Notif[] = await r.json();
      setNotifs(data);
      const newUnreadIds = new Set(data.filter((n) => !n.is_read).map((n) => n.id));
      if (initialLoadDone.current) {
        const brand_new = data.filter((n) => !n.is_read && !prevUnreadIds.has(n.id));
        if (brand_new.length > 0) {
          const latest = brand_new[0];
          toast({ title: latest.title, description: latest.message ?? undefined });
        }
      } else {
        initialLoadDone.current = true;
      }
      setPrevUnreadIds(newUnreadIds);
    } catch {}
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", headers });
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const markRead = async (id: number) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", headers });
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const handleAction = (n: Notif, href: string) => {
    markRead(n.id);
    setOpen(false);
    navigate(href);
  };

  useEffect(() => {
    if (!token) return;
    fetch_();
    const id = setInterval(fetch_, 15_000);
    return () => clearInterval(id);
  }, [token]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Smart viewport-aware positioning
  useEffect(() => {
    if (!open || !popupRef.current) return;
    const popup = popupRef.current;
    // Reset to default
    popup.style.left = "";
    popup.style.right = "0";
    popup.style.transform = "";

    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      const vw = window.innerWidth;

      if (vw < 480) {
        // Mobile: center horizontally with full-ish width
        popup.style.right = "auto";
        popup.style.left = "50%";
        popup.style.transform = "translateX(-50%)";
        popup.style.width = `${Math.min(340, vw - 16)}px`;
      } else {
        // Desktop: prefer right-aligned, but shift if needed
        if (rect.left < 8) {
          popup.style.right = "auto";
          popup.style.left = "0";
        }
        if (rect.right > vw - 8) {
          popup.style.left = "auto";
          popup.style.right = "0";
        }
      }
    });
  }, [open]);

  if (!token) return null;

  return (
    <div className="relative" ref={wrapRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 rounded-lg transition-all duration-150 active:scale-90 ${
          open
            ? "bg-primary/12 text-primary"
            : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground"
        }`}
        aria-label="الإشعارات"
      >
        {unread > 0 ? <BellDot className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5 shadow-md shadow-primary/30 badge-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={popupRef}
          className="absolute top-full mt-2.5 w-[340px] bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/35 z-[60] overflow-hidden float-in"
          style={{ right: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/20">
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
                  onClick={markAllRead}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-primary/8 press-spring"
                >
                  <CheckCheck className="w-3 h-3" />
                  قراءة الكل
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors press-spring"
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
            <div className="max-h-[440px] overflow-y-auto divide-y divide-border/25 scrollbar-none">
              {notifs.map((n, i) => {
                const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
                const IconComp = cfg.icon;
                const ActionIconComp = cfg.actionIcon;

                // Resolve action href: prefer n.link for order/support, else fallback
                const actionHref = n.link ?? cfg.actionHref;

                return (
                  <div
                    key={n.id}
                    className={`
                      relative flex flex-col gap-0 px-4 py-3.5
                      transition-colors duration-150
                      float-in stagger-${Math.min(i + 1, 8)}
                      ${!n.is_read ? "bg-primary/[0.03]" : ""}
                    `}
                  >
                    {/* Unread indicator bar */}
                    {!n.is_read && (
                      <div className="absolute right-0 top-3 bottom-3 w-0.5 bg-primary/60 rounded-full" />
                    )}

                    <div
                      className="flex items-start gap-3 cursor-pointer hover:opacity-85 transition-opacity"
                      onClick={() => {
                        if (!n.is_read) markRead(n.id);
                        if (actionHref) {
                          setOpen(false);
                          navigate(actionHref);
                        }
                      }}
                    >
                      {/* Icon */}
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${cfg.bg} ${cfg.border}`}
                      >
                        <IconComp className={`w-3.5 h-3.5 ${cfg.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-sm font-semibold leading-snug ${!n.is_read ? "text-foreground" : "text-foreground/75"}`}
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

                    {/* Action buttons row */}
                    {(actionHref || cfg.actionLabel) && (
                      <div className="flex items-center gap-2 mt-2 mr-11">
                        {actionHref && cfg.actionLabel && (
                          <button
                            onClick={() => handleAction(n, actionHref)}
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
                              markRead(n.id);
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
            <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 text-center">
              <p className="text-xs text-muted-foreground">{notifs.length} إشعار</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
