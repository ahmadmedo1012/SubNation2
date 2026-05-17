import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { LogOut, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

interface Session {
  id: string;
  device: string;
  lastActive: string;
  current: boolean;
}

/**
 * Active-sessions panel for /profile.
 *
 * Lists currently-active sessions for the user and offers a
 * destructive "logout from all devices" button. Visual style
 * mirrors the surrounding profile cards (rounded-2xl, bordered,
 * card background, header with icon + title) so the section
 * doesn't feel like an unstyled island.
 *
 * Failures are silent in the UI — Sentry's network instrumentation
 * captures the actual error, and a stale list won't lock the user
 * out of anything (the logout-all endpoint is independent).
 */
export function SessionManager() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/sessions", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) setSessions(data.sessions ?? []);
      } catch {
        // Sentry network instrumentation captures the real error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    } catch {
      // Sentry captures it; the user can re-attempt via the page reload.
    }
    setShowLogoutAllConfirm(false);
  };

  return (
    <div className="bg-card border border-border/55 rounded-2xl p-5 float-in" dir="rtl">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
          <Smartphone className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="font-black">الأجهزة النشطة</h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-14 rounded-xl skeleton-shimmer" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">لا توجد جلسات نشطة لعرضها.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between p-3 border rounded-xl ${
                session.current ? "border-primary/25 bg-primary/5" : "border-border/40 bg-muted/20"
              }`}
            >
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">{session.device}</p>
                <p className="text-[10px] text-muted-foreground">
                  آخر نشاط: {new Date(session.lastActive).toLocaleDateString("ar-LY")}
                </p>
              </div>
              {session.current && (
                <span className="text-[10px] bg-primary/15 text-primary border border-primary/25 px-2 py-0.5 rounded-full font-bold shrink-0 mr-2">
                  الحالي
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => setShowLogoutAllConfirm(true)}
        disabled={loading}
        className="w-full mt-4 h-10 border-destructive/25 text-destructive hover:bg-destructive/7 hover:border-destructive/45 font-bold rounded-xl gap-2 transition-all"
      >
        <LogOut className="w-4 h-4" />
        تسجيل الخروج من جميع الأجهزة
      </Button>

      {showLogoutAllConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold">تأكيد تسجيل الخروج</h3>
            <p className="text-sm text-muted-foreground">
              هل أنت متأكد من رغبتك في تسجيل الخروج من جميع الأجهزة؟ ستحتاج لتسجيل الدخول مجدداً
              على كل جهاز.
            </p>
            <div className="flex gap-3 justify-end pt-1">
              <Button
                variant="outline"
                onClick={() => setShowLogoutAllConfirm(false)}
                className="h-10 px-5"
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={handleLogoutAll}
                className="h-10 px-5"
              >
                تأكيد
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
