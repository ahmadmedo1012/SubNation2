import { AlertCircle, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Localised error banner for auth-callback failures.
 *
 * The Telegram redirect-flow GET callback (and any future provider that
 * uses the same pattern) lands the user on `/login?error=<reason>`
 * when something goes wrong. This component reads that param ONCE on
 * mount, looks up a friendly Arabic message, then strips the param
 * from the URL so a refresh doesn't keep nagging.
 *
 * Reason codes are stable and come from the backend — never logged
 * here, never sent anywhere. Just rendered.
 */

const ERROR_MESSAGES: Record<
  string,
  { title: string; tone: "warning" | "error" | "info" }
> = {
  // User cancelled the Telegram auth screen — friendly tone, not red.
  cancelled: {
    title: "تم إلغاء تسجيل الدخول. يمكنك المحاولة مرة أخرى أو اختيار طريقة أخرى.",
    tone: "info",
  },
  // Replay attack mitigated — clear, non-alarming.
  replay_detected: {
    title: "تم استخدام رابط تسجيل الدخول من قبل. ابدأ من جديد.",
    tone: "warning",
  },
  // Auth token expired before reaching the server.
  stale_auth_date: {
    title: "انتهت صلاحية جلسة Telegram. حاول مرة أخرى.",
    tone: "warning",
  },
  // Signature failed — likely BotFather domain misconfiguration.
  bad_signature: {
    title: "تعذّر التحقق من Telegram. تأكد من إعدادات البوت.",
    tone: "error",
  },
  // Payload missing required fields — usually a misconfigured callback URL.
  missing_hash: {
    title: "تعذّر التحقق من Telegram. حاول مرة أخرى.",
    tone: "error",
  },
  missing_id: {
    title: "تعذّر التحقق من Telegram. حاول مرة أخرى.",
    tone: "error",
  },
  // Provider not enabled in admin settings.
  provider_disabled: {
    title: "تسجيل الدخول عبر Telegram غير مفعّل حالياً.",
    tone: "warning",
  },
  // Generic server-side failure.
  server_error: {
    title: "حدث خطأ غير متوقع. حاول مرة أخرى.",
    tone: "error",
  },
};

function readErrorParam(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  // Cap length to prevent rendering arbitrary URL noise.
  return code.slice(0, 64);
}

function clearErrorParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("error");
  window.history.replaceState({}, "", url.toString());
}

export function AuthErrorBanner() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const initial = readErrorParam();
    if (initial) {
      setCode(initial);
      // Strip the URL param so a refresh doesn't re-show the banner.
      // We've already captured it in state.
      clearErrorParam();
    }
  }, []);

  if (!code) return null;

  const entry = ERROR_MESSAGES[code] ?? {
    title: "حدث خطأ غير متوقع. حاول مرة أخرى.",
    tone: "error" as const,
  };

  const palette =
    entry.tone === "info"
      ? "bg-blue-500/8 border-blue-500/22 text-blue-400"
      : entry.tone === "warning"
        ? "bg-amber-500/8 border-amber-500/22 text-amber-400"
        : "bg-destructive/10 border-destructive/22 text-destructive";

  const Icon = entry.tone === "info" ? Info : AlertCircle;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`mb-4 px-3 py-2.5 border rounded-xl text-sm flex items-center gap-2.5 ${palette}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 leading-relaxed">{entry.title}</span>
      <button
        type="button"
        onClick={() => setCode(null)}
        className="opacity-70 hover:opacity-100 transition-opacity"
        aria-label="إغلاق"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
