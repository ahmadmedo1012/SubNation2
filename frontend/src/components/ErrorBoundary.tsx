import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

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
      return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
          <div className="text-center max-w-sm w-full space-y-7">
            {/* Icon — 94-C3 (A3 P2-1): raw red-500/400 hues → the shared
                --status-error family (same tone AuthErrorBanner/StatusBadge
                ride), so the light theme keeps AA contrast. */}
            <div className="mx-auto w-20 h-20 rounded-2xl bg-status-error/10 border border-status-error/22 flex items-center justify-center">
              <AlertTriangle className="w-9 h-9 text-status-error" />
            </div>

            {/* Message */}
            <div>
              <h1 className="text-xl font-black mb-2.5 text-foreground">حدث خطأ غير متوقع</h1>
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
                  <pre className="mt-2 text-[10px] text-status-error/75 bg-status-error/8 border border-status-error/15 rounded-lg p-3 overflow-auto text-left leading-relaxed">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-95 text-primary-foreground font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-primary/20 w-full sm:w-auto"
              >
                <RefreshCw className="w-4 h-4" />
                إعادة التحميل
              </button>
              <button
                onClick={() => {
                  window.location.href = "/";
                }}
                className="flex items-center gap-2 bg-secondary/60 hover:bg-secondary border border-border text-muted-foreground hover:text-foreground font-medium px-6 py-3 rounded-xl transition-all w-full sm:w-auto"
              >
                <Home className="w-4 h-4" />
                الرئيسية
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
