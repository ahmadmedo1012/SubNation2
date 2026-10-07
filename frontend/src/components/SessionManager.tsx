import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/lib/auth";
import { formatDateShort } from "@/lib/utils";
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
 * The destructive confirm routes through the shared useConfirm()
 * hook (Radix AlertDialog — role/aria, Escape, outside-click, focus
 * trap). The previous hand-rolled overlay had none of those
 * (B6-P1-3): it was the only confirm in the app a keyboard user
 * couldn't Escape out of.
 *
 * Failures are silent in the UI — Sentry's network instrumentation
 * captures the actual error, and a stale list won't lock the user
 * out of anything (the logout-all endpoint is independent).
 */
export function SessionManager() {
  const { token } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

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
    // Destructive confirm via the shared a11y-complete AlertDialog
    // (B6-P1-3). Same message text as the old hand-rolled overlay —
    // only the dialog mechanics changed.
    const ok = await confirm({
      title: "تأكيد تسجيل الخروج",
      description:
        "هل أنت متأكد من رغبتك في تسجيل الخروج من جميع الأجهزة؟ ستحتاج لتسجيل الدخول مجدداً على كل جهاز.",
      confirmLabel: "تأكيد",
      cancelLabel: "إلغاء",
      destructive: true,
    });
    if (!ok) return;
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
  };

  return (
    <div className="bg-card border border-border/55 rounded-2xl p-5 float-in" dir="rtl">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
          <Smartphone className="w-3.5 h-3.5 text-primary-text" />
        </div>
        <h2 className="font-bold">الأجهزة النشطة</h2>
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
                <p className="text-3xs text-muted-foreground">
                  {/* R122 (A1 P2-3): the bare toLocaleDateString("ar-LY") was
                      the 96-F7 Latin-digit-pin class (engines without ar-LY
                      data render Arabic-Indic ٠١٢ digits). formatDateShort
                      is pinned to ar-LY-u-nu-latn AND reads better for a
                      "last activity" stamp (relative «قبل 5 دقائق» under
                      48h, calendar date beyond). */}
                  آخر نشاط: {formatDateShort(session.lastActive)}
                </p>
              </div>
              {session.current && (
                <span className="text-3xs bg-primary/15 text-primary-text border border-primary/25 px-2 py-0.5 rounded-full font-bold shrink-0 mr-2">
                  الحالي
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => void handleLogoutAll()}
        disabled={loading}
        className="w-full mt-4 h-10 border-destructive/25 text-destructive hover:bg-destructive/7 hover:border-destructive/45 font-bold rounded-xl gap-2 transition-all"
      >
        <LogOut className="w-4 h-4" />
        تسجيل الخروج من جميع الأجهزة
      </Button>

      {/* Shared Radix AlertDialog (useConfirm) — renders only while a
          confirm is pending. */}
      <ConfirmDialog />
    </div>
  );
}
