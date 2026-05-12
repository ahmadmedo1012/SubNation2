import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";

interface Session {
  id: string;
  device: string;
  lastActive: string;
  current: boolean;
}

export function SessionManager() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);

  useEffect(() => {
    if (token) {
      fetchSessions();
    }
  }, [token]);

  const fetchSessions = async () => {
    try {
      const response = await fetch("/api/auth/sessions", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutAll = async () => {
    try {
      const response = await fetch("/api/auth/logout-all-devices", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (response.ok) {
        window.location.href = "/login";
      }
    } catch (error) {
      console.error("Failed to logout all devices:", error);
    }
    setShowLogoutAllConfirm(false);
  };

  if (loading) {
    return <div className="text-center py-4">جاري التحميل...</div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <h3 className="text-lg font-semibold">الأجهزة النشطة</h3>
      {sessions.length === 0 ? (
        <p className="text-muted-foreground">لا توجد جلسات نشطة</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between p-4 border rounded ${
                session.current ? "bg-muted" : ""
              }`}
            >
              <div>
                <p className="font-medium">{session.device}</p>
                <p className="text-sm text-muted-foreground">
                  آخر نشاط: {new Date(session.lastActive).toLocaleDateString("ar-LY")}
                </p>
              </div>
              {session.current && (
                <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                  الحالي
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => setShowLogoutAllConfirm(true)}
        className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
      >
        تسجيل الخروج من جميع الأجهزة
      </button>
      {showLogoutAllConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card p-6 rounded-lg max-w-sm w-full space-y-4">
            <h3 className="text-lg font-semibold">تأكيد تسجيل الخروج</h3>
            <p className="text-sm text-muted-foreground">
              هل أنت متأكد من رغبتك في تسجيل الخروج من جميع الأجهزة؟
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLogoutAllConfirm(false)}
                className="px-4 py-2 border rounded"
              >
                إلغاء
              </button>
              <button
                onClick={handleLogoutAll}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded"
              >
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
