import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Official Telegram Login Widget integration.
 *
 * Spec: https://core.telegram.org/widgets/login
 *
 * The legacy widget (which is the de-facto Telegram Login since 2018)
 * works as follows:
 *
 *   1. We inject `https://telegram.org/js/telegram-widget.js?22` into a
 *      visible container. The script reads its own `data-*` attributes
 *      and renders a real Telegram-branded button into the same
 *      container.
 *   2. When the user clicks the button, Telegram opens a popup that
 *      asks them to confirm the login on telegram.org.
 *   3. On confirmation, the popup posts auth data back to the parent
 *      window which calls our `data-onauth` callback with the user
 *      object: `{ id, first_name, last_name, username, photo_url,
 *      auth_date, hash }`.
 *   4. We POST that payload to `/api/auth/telegram` where the backend
 *      verifies the HMAC-SHA256 hash using the bot token, checks
 *      auth_date freshness, applies replay protection, and issues a
 *      JWT — same pattern as Phone OTP and Google.
 *
 * Owner setup (one-time, in @BotFather):
 *
 *   /setdomain → choose bot → enter `subnation.ly`
 *
 * Then in /admin/settings:
 *
 *   Auth providers → Telegram → bot_username + bot_token + enable
 *
 * That's it. No env vars, no redeploys.
 */

interface TelegramLoginButtonProps {
  botUsername: string;
  /** Called with the backend-issued JWT after a successful exchange. */
  onSuccess: (token: string) => void;
  /** Called with a localised, user-safe message on any failure. */
  onError: (message: string) => void;
}

declare global {
  interface Window {
    /** Per-instance callback registered by the widget script. */
    [key: `__tgLogin_${string}`]:
      | ((data: Record<string, string | number>) => void)
      | undefined;
  }
}

function readReferralFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref) return undefined;
  const trimmed = ref.trim().toUpperCase().slice(0, 16);
  return trimmed || undefined;
}

export function TelegramLoginButton({
  botUsername,
  onSuccess,
  onError,
}: TelegramLoginButtonProps) {
  // Stable per-instance callback name. We use a unique ID so multiple
  // mounts (StrictMode dev double-invoke, two pages mounted in transition)
  // never overwrite each other.
  const reactId = useId();
  const callbackName = `__tgLogin_${reactId.replace(/[^a-zA-Z0-9]/g, "")}` as const;
  const containerRef = useRef<HTMLDivElement>(null);
  const [exchanging, setExchanging] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Register the auth callback on `window` under the unique name.
    //    The widget will look up `window[callbackName]` after auth.
    window[callbackName] = async (data) => {
      setExchanging(true);
      try {
        const referral = readReferralFromUrl();
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, referralCode: referral }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          token?: string;
          error?: string;
        };
        if (!res.ok || !json.token) {
          throw new Error(json.error ?? "فشل تسجيل الدخول عبر Telegram");
        }
        onSuccess(json.token);
      } catch (err: unknown) {
        onError(
          err instanceof Error ? err.message : "تعذّر إكمال تسجيل الدخول عبر Telegram",
        );
      } finally {
        setExchanging(false);
      }
    };

    // 2. Inject the official widget script. The script reads its own
    //    data-* attributes and renders the Telegram button into the
    //    same parent element.
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = "large";
    script.dataset.radius = "12";
    script.dataset.requestAccess = "write";
    script.dataset.userpic = "false";
    script.dataset.onauth = `${callbackName}(user)`;
    script.onerror = () => setScriptFailed(true);

    container.appendChild(script);

    // 3. Cleanup: remove the script + button + global callback so a
    //    later remount doesn't leak handlers.
    return () => {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [botUsername, callbackName, onSuccess, onError]);

  if (scriptFailed) {
    return (
      <div className="text-xs text-destructive text-center bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2.5">
        تعذّر تحميل أداة Telegram — تحقق من الاتصال أو حاول لاحقاً
      </div>
    );
  }

  return (
    <div className="relative" dir="ltr">
      {/* Container the widget script renders into. The widget produces
          its own pixel-perfect button styled per Telegram brand
          guidelines — we DON'T style it ourselves, only ensure
          centering and consistent height with the other buttons. */}
      <div
        ref={containerRef}
        className="flex items-center justify-center min-h-[44px] [&>iframe]:!rounded-xl [&>iframe]:!w-full"
        aria-label="تسجيل الدخول عبر Telegram"
      />

      {/* Subtle skeleton while the script downloads + iframe paints —
          replaced atomically by the real Telegram button. */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-muted-foreground text-xs opacity-60 [div:has(>iframe)+&]:hidden">
        <div className="h-11 w-full bg-muted/40 animate-pulse rounded-xl" />
      </div>

      {/* In-flight overlay shown while we POST to /api/auth/telegram. */}
      {exchanging && (
        <div className="absolute inset-0 bg-background/85 backdrop-blur-[2px] rounded-xl flex items-center justify-center gap-2 text-sm text-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>جارٍ التحقق...</span>
        </div>
      )}
    </div>
  );
}
