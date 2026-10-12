import { Bot, CheckCircle, Loader2, XCircle } from "lucide-react";
import type { TelegramTestResult } from "./settings-page-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the telegram diagnostic-ping card (the «اختبار» button + the structured
// result banner). tgTesting/tgTestResult are page-owned atoms passed DOWN;
// the diagnostic-test runner (the POST /api/admin/diagnostics/telegram-test
// with its session-expiry quiet-catch + the offline fallback result) stays
// IN the page. The move only changes its address; DOM, classes and Arabic
// copy are byte-identical.

export function TelegramDiagnosticPing({
  tgTesting,
  tgTestResult,
  onRunTest,
}: {
  tgTesting: boolean;
  tgTestResult: TelegramTestResult | null;
  onRunTest: () => void;
}) {
  return (
    /* ── Diagnostic ping ──────────────────────────────────
        Sends a real test message via the same dispatch path
        used by production notifications, so the operator
        gets end-to-end proof of delivery (or a clear error
        with a hint when something is wrong). */
    <div className="mt-5 p-4 bg-card border border-border/60 rounded-2xl">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-sm font-bold">اختبار التسليم</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            يُرسل رسالة فعلية للمحادثة المُعدّة للتحقق من قابلية وصول البوت.
          </p>
        </div>
        <button
          onClick={onRunTest}
          disabled={tgTesting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-bold text-xs transition-all press-spring"
        >
          {tgTesting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Bot className="w-3.5 h-3.5" />
          )}
          {tgTesting ? "جارٍ الإرسال…" : "اختبار اتصال البوت"}
        </button>
      </div>

      {tgTestResult && (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
            tgTestResult.delivered
              ? "bg-status-success/10 border-status-success/25 text-status-success"
              : "bg-status-error/10 border-status-error/25 text-status-error"
          }`}
        >
          {tgTestResult.delivered ? (
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-bold">
              {tgTestResult.delivered
                ? "تم التسليم بنجاح"
                : tgTestResult.configured
                  ? "فشل التسليم"
                  : "النظام غير مُعدّ"}
            </div>
            {tgTestResult.errorMessage && (
              <div className="font-mono text-3xs opacity-90 break-all">
                {tgTestResult.errorMessage}
              </div>
            )}
            {tgTestResult.hint && (
              <div className="text-2xs opacity-90 leading-relaxed">{tgTestResult.hint}</div>
            )}
            {tgTestResult.attempts > 0 && (
              <div className="text-3xs opacity-75">عدد المحاولات: {tgTestResult.attempts}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
