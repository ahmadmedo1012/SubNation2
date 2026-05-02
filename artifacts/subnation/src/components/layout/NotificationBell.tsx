import { useState, useEffect, useRef } from "react";
import { Bell, Check, CheckCheck, Wallet, ShoppingBag, MessageSquare, Star, Info, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Link } from "wouter";

interface Notif {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  wallet: { icon: <Wallet className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-400/10" },
  order: { icon: <ShoppingBag className="w-3.5 h-3.5" />, color: "text-blue-400", bg: "bg-blue-400/10" },
  support: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-purple-400", bg: "bg-purple-400/10" },
  loyalty: { icon: <Star className="w-3.5 h-3.5" />, color: "text-yellow-400", bg: "bg-yellow-400/10" },
  system: { icon: <Info className="w-3.5 h-3.5" />, color: "text-muted-foreground", bg: "bg-muted/50" },
};

export function NotificationBell() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifs.filter(n => !n.is_read).length;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const fetch_ = async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/notifications", { headers });
      if (r.ok) setNotifs(await r.json());
    } catch {}
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", headers });
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const markRead = async (id: number) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", headers });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  useEffect(() => {
    if (!token) return;
    fetch_();
    const id = setInterval(fetch_, 15_000);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!token) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        aria-label="الإشعارات"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 w-80 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden"
          style={{ right: 0, left: "auto" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">الإشعارات</span>
              {unread > 0 && (
                <span className="bg-primary/10 text-primary text-xs font-black px-1.5 py-0.5 rounded-full">{unread}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-secondary">
                  <CheckCheck className="w-3 h-3" />
                  قراءة الكل
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {notifs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">لا توجد إشعارات</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-border/40">
              {notifs.map(n => {
                const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
                const inner = (
                  <div
                    onClick={() => !n.is_read && markRead(n.id)}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors cursor-pointer ${!n.is_read ? "bg-primary/3" : ""}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-sm font-medium leading-snug ${!n.is_read ? "text-foreground" : "text-foreground/80"}`}>{n.title}</p>
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                      </div>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                      <p className="text-xs text-muted-foreground/60 mt-1">{formatDate(n.created_at)}</p>
                    </div>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)}>{inner}</Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
