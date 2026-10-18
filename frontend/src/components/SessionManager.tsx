import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { customFetch } from "@workspace/api-client-react";
import { LogOut, Smartphone, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

interface Session {
  id: string;
  device: string;
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
 * Failures are honest in the UI (R127 B15-2): a failed sessions
 * load renders an inline Arabic error line + retry — never the false
 * «لا توجد جلسات نشطة» empty state a 401/5xx outage envelope used to
 * produce — and a FAILED logout-all fires a destructive toast instead
 * of a silent no-op (the user must not believe every device was
 * revoked when the request never landed). Sentry still captures the
 * underlying error server-side; it is not the operator affordance.
 */
export function SessionManager() {
  const { token } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // B15-2: retry key for the sessions fetch (the honest error line's
  // «إعادة المحاولة» re-runs the effect without a remount).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // R144-C1 (L16-3): rides customFetch — same URL/auth; non-2xx
        // throws ApiError (whose .data IS the parsed envelope
        // getErrorMessage read inline before), a malformed-JSON body
        // becomes ResponseParseError instead of the `.catch(() => ({}))`
        // shape, and the previously UNBOUNDED request gains the 20 s
        // budget. The honest error line + retry contract stays verbatim.
        const data = await customFetch<{ sessions?: Session[] }>("/api/auth/sessions", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        setSessions(data.sessions ?? []);
      } catch (e) {
        // Network/HTTP-level failure — same honest state, not the empty list.
        if (!cancelled) setLoadError(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

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
      // R144-C1 (L16-3): rides customFetch — same method/auth; non-2xx
      // throws ApiError (the envelope the inline parse fed
      // getErrorMessage below) and the previously UNBOUNDED POST gains
      // the 20 s budget. The redirect-on-success / destructive-toast-on
      // -failure contract stays verbatim.
      await customFetch("/api/auth/logout-all-devices", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      window.location.href = "/login";
      return;
    } catch (e) {
      // B15-2: a FAILED logout-all used to be a silent no-op — the
      // button clicks, nothing happens, and the user still believes
      // all devices were revoked. The failure is now surfaced as a
      // destructive toast (getErrorMessage, the console idiom); the
      // button itself remains the retry affordance and the session
      // list above is untouched (still rendered, still true).
      toast({
        title: "فشل تسجيل الخروج من جميع الأجهزة",
        description: getErrorMessage(e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 float-in" dir="rtl">
      {/* R139 (precision): /55 → /60 — the section-card resting edge
          every profile sibling now rides (the r138 family value). */}
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
      ) : loadError ? (
        /* B15-2: the honest outage state — a failed load is NEVER the
         * «لا توجد جلسات نشطة» empty list. Inline Arabic line + retry
         * (the admin error-banner idiom, scaled to the card). */
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 py-2 text-sm text-destructive"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-xs underline underline-offset-2 hover:opacity-80"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">لا توجد جلسات نشطة لعرضها.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between p-3 border rounded-xl ${
                session.current ? "border-primary/30 bg-primary/8" : "border-border/40 bg-muted/20"
              }`}
            >
              {/* R139 (precision): the current-session tint joins the
                  family's tinted-selected pair (border-primary/30 +
                  bg-primary/8 — orders' selected rows, MobileOrderCard,
                  admin TicketCard; was /25 + /5, the pre-r138 values).
                  Non-current rows already ride the nested-row register
                  (bg-muted/20 + /40) — byte-identical. */}
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">{session.device}</p>
                {/* R146 (backend carry-over): the «آخر نشاط» stamp is gone
                    — the backend dropped lastActive from GET /api/auth/sessions
                    (it was always the session's createdAt, a lie as a
                    "last activity" label); the row now shows the device +
                    current chip only, exactly what the API honestly knows. */}
              </div>
              {session.current && (
                <span className="text-3xs bg-primary/15 text-primary-text border border-primary/30 px-2 py-0.5 rounded-full font-bold shrink-0 ms-2">
                  {/* R139 (precision): chip edge /25 → /30 — the one
                      static-badge border value the family converged on
                      (139-f's variant-count badge decision). */}
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
        /* R124-I4 (A4 F1) twin: h-10 (40px) → min-h-11 — the 44px floor
           the profile logout sibling above already rides.
           R139 (precision): quiet danger at rest — the destructive
           ink/border/wash trio retires for muted ink + the
           status-error hover family (the cart clear-trigger's exact
           register, pinned by money-path-chrome-r139). Severity lives
           in the useConfirm destructive dialog above. */
        className="w-full mt-4 min-h-11 border-border/60 text-muted-foreground hover:text-status-error hover:bg-status-error/10 hover:border-status-error/30 font-bold rounded-xl gap-2 transition-all"
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
