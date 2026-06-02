import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { AlertCircle, Loader2 } from "lucide-react";

const HANG_TIMEOUT_MS = 12_000;

/**
 * OAuth callback landing page (Google → backend → token in URL).
 *
 * Normal path: query has `?token=…`, we hand it to the auth context
 * and bounce to "/". Total time on this page ≈ 30-100ms.
 *
 * Recovery path: if `useEffect` ran but no `token` / `auth_error` was
 * present in the URL, the navigate() to "/login" still fires almost
 * instantly. The hang state below covers a different failure mode —
 * if THIS module never paints further (network of the next chunk
 * stalls, browser is offline mid-transition), users would see a
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

    if (token) {
      setToken(token);
      navigate("/");
    } else if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`);
    } else {
      navigate("/login");
    }
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
            <p className="text-sm">جارٍ تسجيل الدخول...</p>
          </>
        )}
      </div>
    </div>
  );
}
