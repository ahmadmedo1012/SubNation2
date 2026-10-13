import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /**
   * 98-F7 (r97 F-14): identity that RESETS the boundary's error state
   * when it changes — the standard didUpdate reset pattern. Usage sites
   * pass the current route location (App.tsx renders one boundary around
   * the whole Switch, so a crashed /wallet must reset when the user
   * navigates to / — the boundary can't stay stuck on the error screen
   * for every subsequent route until a manual reload).
   *
   * Deliberately NOT the children element: AppRoutes re-renders on ANY
   * auth/theme state flip and mints a new Switch element each time, so
   * the old children-identity check reset the boundary on unrelated
   * re-renders too (error screen ↔ blank flicker while the same route
   * kept re-throwing). The route key resets exactly on navigation.
   *
   * When omitted, the legacy children-identity behavior is kept as a
   * fallback for any future mount site that renders a stable child.
   */
  resetKey?: string | number;
  /**
   * R118-B2 (A2 F-5): slim fallback for NON-route boundaries (App
   * chrome — Navbar / FlashSaleBanner / Footer / MobileNav). When
   * provided, a caught error renders THIS instead of the full-screen
   * recovery page: chrome crashes degrade to boundary-less navigation
   * while route content keeps rendering, instead of a whole-app white
   * screen (the chrome previously sat ABOVE the route boundary with
   * no guard of its own). `fallback={null}` is the intended usage.
   */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Log the error for debugging
    console.error("ErrorBoundary caught an error:", error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React render error:", error, errorInfo);
    // ── Lazy-load Sentry on the error path ─────────────────────────
    // The much more common no-error path no longer pulls @sentry/react
    // (~155 KB gzip) into the critical chunk graph. When an error DOES
    // fire we accept a one-time ~50–100 ms async-import cost to ship the
    // event — still vastly cheaper than blocking every cold visit on
    // Sentry. Errors during the brief boot-defer window are also caught
    // by the window error/rejection buffer in lib/boot-sentry.
    void import("@sentry/react").then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setContext("react", {
          componentStack: errorInfo.componentStack,
        });
        Sentry.captureException(error);
      });
    });
  }

  componentDidUpdate(prevProps: Props, _prevState: State) {
    // Reset error state when the RESET KEY changes (route change) — see
    // the resetKey docstring above for why children identity is only the
    // legacy fallback. Only a boundary currently SHOWING an error cares:
    // a healthy boundary re-rendering on a new key stays healthy.
    if (!this.state.hasError) return;
    if (this.props.resetKey !== undefined) {
      if (prevProps.resetKey !== this.props.resetKey) {
        this.setState({ hasError: false, error: undefined });
      }
      return;
    }
    // Legacy fallback (no resetKey): reset on children identity change.
    if (prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      // R118-B2 (A2 F-5): slim-fallback mount sites (App chrome) render
      // their own degradation UI (usually null) — the full-screen page
      // below is the ROUTE boundary's recovery experience.
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <div
          // R120-B5 (A3-F7): dvh straggler — the project's viewport-fill
          // convention is min-h-[100dvh] (home.tsx:416 documents it);
          // 100vh over-scrolls under mobile browser chrome, clipping the
          // reload/home actions on the crash screen of all places.
          className="min-h-[100dvh] bg-background flex items-center justify-center px-4 py-10"
          dir="rtl"
        >
          {/* R-140-f (the r139 calm-error register — fetch-error-card's
              page scale, verbatim family): the crash screen used to be a
              floating text column with HAND-ROLLED action buttons (flat
              bg-primary + hover:bg-primary/90 + active:scale-95 +
              shadow-lg shadow-primary/20 — exactly the pre-R116-S1
              hand-roll R138's calm-error re-tune retired in
              FetchErrorCard). The recovery experience now rides the
              family card: a calm bg-card frame on the /60 resting border
              (the state signal lives in the ONE red accent — the icon
              stage — not a red wall), role="alert" so the state is
              announced (the R125 A6 B-8 contract: an error screen is
              never silent), and the canonical CTA recipes — the primary
              reload rides Button size="lg" + w-full sm:w-auto (R116-S1),
              the secondary home ride Button variant="outline". §3's
              outage≠empty silhouette stays obvious: tinted error tile +
              role="alert" + a real reload CTA vs an empty state's muted
              ghost tile. */}
          <div
            role="alert"
            className="w-full max-w-sm text-center bg-card border border-border/60 rounded-2xl px-6 py-10 sm:px-8"
          >
            {/* Icon stage — the ONE red accent on the card (94-C3 A3
                P2-1: --status-error family; R130 A2-F2: the adjacent bold
                Arabic headline carries the state, so the glyph is
                decorative and hidden from the a11y tree). */}
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-status-error" aria-hidden="true" />
            </div>

            {/* Message — calm ink ladder: bold /80 headline (not a red
                wall), muted explanation. Arabic copy verbatim. */}
            <div>
              <h1 className="font-bold text-lg mb-1.5 text-foreground/80">حدث خطأ غير متوقع</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                نعتذر، حدث خطأ في هذه الصفحة.
                <br />
                يرجى إعادة التحميل أو التواصل مع فريق الدعم.
              </p>
              {this.state.error && (
                <details className="mt-4 text-right">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground transition-colors">
                    تفاصيل الخطأ (للمطورين)
                  </summary>
                  <pre className="mt-2 text-3xs text-status-error bg-status-error/8 border border-status-error/15 rounded-lg p-3 overflow-auto text-left leading-relaxed">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </div>

            {/* Actions — the REAL recovery affordances (a full reload and
                an escape to home), both canonical Button recipes now: the
                gradient fill, press-spring and the ONE focus-visible ring
                ride buttonVariants instead of a local hand-roll. */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
              <Button
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => window.location.reload()}
              >
                <RefreshCw />
                إعادة التحميل
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                <Home />
                الرئيسية
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
