import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/hooks/useSeo";

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
 * H-4 (R142): the legacy `?token=` branch is DELETED — its own doc
 * mandated removal "once every active session has rolled over via the
 * cookie path", and that rollover completed long ago (98-F3 predates
 * 40+ rounds; every 30-day session minted since carries the cookie
 * only, and no mint route returns a body-borne token). The branch was
 * dormant-but-armed login-CSRF-shaped code: any future route that ever
 * echoed a real token would have re-armed it.
 *
 * Recovery path: if no auth_error is in the URL AND there is no cookie
 * session either, the SPA's auth guards on "/" will redirect to
 * /login. The hang state below covers a different failure mode — if
 * THIS module never paints further (network of the next chunk stalls,
 * browser is offline mid-transition), users would see a permanent
 * spinner. We surface a manual escape after 12s.
 */
export default function AuthCallbackPage() {
  const [, navigate] = useLocation();
  const [hangVisible, setHangVisible] = useState(false);
  // R157: a transient-screen title (the R146 login class) — the page is
  // mounted during the cookie-bounce, and the RouteAnnouncer reading the
  // previous page's title was a stale announcement after this navigation.
  const seoBlock = useSeo({
    title: "جارٍ تسجيل الدخول — SubNation",
    description: "جارٍ إكمال تسجيل الدخول بأمان عبر SubNation.",
    path: "/auth/callback",
    robots: "noindex,nofollow",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("auth_error");

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`);
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
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      {seoBlock}
      {/* R157: the loading/hang states announced to assistive tech
          (role=status polite while polling; the 12s hang swap flips to
          role=alert so the verdict is heard) + a document title so the
          RouteAnnouncer stops reading the PREVIOUS page's title after
          the navigation to this transient screen (the R146 login fix's
          class — this page had none). */}
      <div
        role={hangVisible ? "alert" : "status"}
        aria-live={hangVisible ? undefined : "polite"}
        className="flex flex-col items-center gap-3 text-muted-foreground max-w-sm text-center"
      >
        {hangVisible ? (
          <>
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm font-bold text-foreground">انقطع الاتصال أثناء تسجيل الدخول</p>
            <p className="text-xs leading-relaxed">
              قد تكون الشبكة بطيئة أو هناك مشكلة في الخادم. يمكنك المحاولة مرة أخرى من صفحة الدخول.
            </p>
            {/* R116-S1 CTA recipe + token discipline: system Button
                (gradient variant, text-primary-foreground) replaces the
                hand-rolled bg-primary/text-white link. */}
            <Button asChild size="lg" className="mt-2">
              <Link href="/login">العودة لتسجيل الدخول</Link>
            </Button>
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
