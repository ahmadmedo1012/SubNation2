import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
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
    return { hasError: true, error };
  }

  componentDidCatch() {}

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
          <div className="text-center max-w-sm w-full space-y-7">
            {/* Icon */}
            <div className="mx-auto w-20 h-20 rounded-2xl bg-red-500/8 border border-red-500/15 flex items-center justify-center">
              <AlertTriangle className="w-9 h-9 text-red-400" />
            </div>

            {/* Message */}
            <div>
              <h1 className="text-xl font-black mb-2.5 text-foreground">
                حدث خطأ غير متوقع
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                نعتذر، حدث خطأ في هذه الصفحة.
                <br />
                يرجى إعادة التحميل أو التواصل مع فريق الدعم.
              </p>
              {this.state.error && (
                <details className="mt-4 text-right">
                  <summary className="text-xs text-muted-foreground/40 cursor-pointer hover:text-muted-foreground transition-colors">
                    تفاصيل الخطأ (للمطورين)
                  </summary>
                  <pre className="mt-2 text-[10px] text-red-400/70 bg-red-500/5 border border-red-500/10 rounded-lg p-3 overflow-auto text-left leading-relaxed">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-95 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-primary/20 w-full sm:w-auto"
              >
                <RefreshCw className="w-4 h-4" />
                إعادة التحميل
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
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
