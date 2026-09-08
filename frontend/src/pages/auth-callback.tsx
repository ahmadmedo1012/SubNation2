import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { AlertCircle, Loader2 } from "lucide-react";

const HANG_TIMEOUT_MS = 12_000;

/**
 * OAuth callback landing page.
 *
 * Modern path (F-010 / security audit 004): the backend sets the
 * httpOnly auth_token cookie on the same response that 302s here, with
 * NO `?token=` in the URL. We rely on AuthProvider's mount-time
 * /api/auth/probe to detect the cookie session and set the sentinel
 * token; this page just bounces to "/" and lets the SPA re-hydrate.
 *
 * Legacy path: older Firebase / Telegram redirects still place
 * `?token=…` in the URL. We continue to honour them so a deploy that
 * lands the backend change before the frontend (or vice-versa) does
 * not strand sessions. The legacy branch is removed once every active
 * session has rolled over via the cookie path.
 *
 * Recovery path: if neither token nor auth_error is in the URL AND
 * there is no cookie session either, the SPA's auth guards on "/" will
 * redirect to /login. The hang state below covers a different failure
 * mode — if THIS module never paints further (network of the next
 * chunk stalls, browser is offline mid-transition), users would see a
 * permanent spinner. We surface a manual escape after 12s.
 */
export default function AuthCallbackPage() {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [hangVisible, setHangVisible] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("auth_error");

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (token) {
      // Legacy path — see component doc above.
      // A8-09 (round-94): scrub the token out of the address bar + history
      // the moment it is read. A crafted `?token=` link used to leave the
      // injected credential sitting in the URL (browser history, screen
      // shares, referrer leakage to embedded third parties). replaceState
      // with a clean path removes it before the SPA continues.
      setToken(token);
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/");
      return;
    }

    // F-010 cookie-only path: the backend has already set the
    // httpOnly auth_token cookie on the redirect response.
    // AuthProvider's mount-time /api/auth/probe detects the cookie and
    // seeds the sentinel token, so we just bounce home; SPA auth
    // guards take it from there if the probe came back unauthenticated.
    navigate("/");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHangVisible(true), HANG_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-muted-foreground max-w-sm text-center">
        {hangVisible ? (
          <>
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm font-bold text-foreground">انقطع الاتصال أثناء تسجيل الدخول</p>
            <p className="text-xs leading-relaxed">
              قد تكون الشبكة بطيئة أو هناك مشكلة في الخادم. يمكنك المحاولة مرة أخرى من صفحة الدخول.
            </p>
            <Link
              href="/login"
              className="mt-2 inline-flex items-center justify-center h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold press-spring shadow-md shadow-primary/22"
            >
              العودة لتسجيل الدخول
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">جارٍ تسجيل الدخول…</p>
          </>
        )}
      </div>
    </div>
  );
}
