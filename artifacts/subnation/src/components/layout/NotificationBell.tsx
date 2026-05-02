import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatDate, statusLabel, statusColor } from "@/lib/utils";

interface NotifItem {
  id: string;
  type: "order" | "topup";
  title: string;
  subtitle: string;
  status: string;
  time: string;
}

const STORAGE_KEY = "sn_notif_seen";

function getLastSeen(): number {
  return parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
}

function setLastSeen() {
  localStorage.setItem(STORAGE_KEY, String(Date.now()));
}

export function NotificationBell() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function fetchNotifications() {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [ordersRes, topupsRes] = await Promise.all([
        fetch("/api/orders", { headers }),
        fetch("/api/wallet/topups", { headers }),
      ]);
      const orders = ordersRes.ok ? await ordersRes.json() : [];
      const topups = topupsRes.ok ? await topupsRes.json() : [];

      const notifs: NotifItem[] = [];

      for (const o of orders.slice(0, 5)) {
        notifs.push({
          id: `order-${o.id}`,
          type: "order",
          title: o.product_name ?? "طلب",
          subtitle: o.status === "completed" ? "تم تسليم بيانات الاشتراك" : statusLabel(o.status),
          status: o.status,
          time: o.created_at ?? "",
        });
      }
      for (const t of topups.slice(0, 5)) {
        if (t.status === "pending") continue;
        notifs.push({
          id: `topup-${t.id}`,
          type: "topup",
          title: `شحن ${t.amount?.toFixed(2)} د.ل`,
          subtitle: statusLabel(t.status),
          status: t.status,
          time: t.reviewed_at ?? t.created_at ?? "",
        });
      }

      notifs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setItems(notifs.slice(0, 8));

      const lastSeen = getLastSeen();
      const newCount = notifs.filter(n => n.time && new Date(n.time).getTime() > lastSeen).length;
      setUnread(newCount);
    } catch {}
  }

  useEffect(() => {
    if (!token) return;
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleOpen = () => {
    setOpen(v => {
      if (!v) {
        setLastSeen();
        setUnread(0);
      }
      return !v;
    });
  };

  if (!token) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        aria-label="الإشعارات"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden" style={{ left: "auto", right: 0 }}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-bold text-sm">الإشعارات</span>
            {unread > 0 && <span className="text-xs text-primary font-bold">{unread} جديد</span>}
          </div>

          {items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />
              لا توجد إشعارات
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
              {items.map(item => (
                <div key={item.id} className="px-4 py-3 hover:bg-secondary/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.status === "completed" || item.status === "approved" ? "bg-emerald-400" : item.status === "rejected" || item.status === "failed" ? "bg-red-400" : "bg-yellow-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                      {item.time && <div className="text-xs text-muted-foreground/60 mt-0.5">{formatDate(item.time)}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
