import { useAuth } from "@/lib/auth";
import { useEffect, useRef } from "react";

/**
 * Telegram Mini App auto-login.
 *
 * When the SubNation site is opened INSIDE the Telegram client (via a
 * `t.me/<bot>/<app>` Mini App link or a bot menu button), Telegram
 * auto-injects `window.Telegram.WebApp.initData` carrying a verified
 * user identity. The user is already authenticated by Telegram itself,
 * so they NEVER see the phone-number prompt that oauth.telegram.org
 * shows for first-time browser users.
 *
 * This hook detects that environment on mount and silently exchanges
 * the initData for a JWT via the backend `POST /api/auth/telegram/webapp`
 * endpoint. On any failure it silently no-ops — the user can still tap
 * the existing "Continue with Telegram" button which uses the public
 * redirect flow.
 *
 * Safety properties (in order of importance):
 *
 *   1. Only fires when the user is NOT already logged in. Will not
 *      re-issue tokens for an existing session, will not cause a
 *      logout-then-login churn.
 *
 *   2. Only fires when `window.Telegram.WebApp.initData` is a non-empty
 *      string. Public web users (no Telegram WebView wrapper) see a
 *      no-op.
 *
 *   3. Runs AT MOST ONCE per component mount. The ref guard makes it
 *      safe under React 18 StrictMode double-invocation.
 *
 *   4. Failures are silent (no toasts, no banners, no console errors).
 *      The redirect-flow `TelegramLoginButton` remains the public-web
 *      fallback. Any verification failure here is treated as "no
 *      auto-login this time" — never as an error.
 */
export function useTelegramWebAppAutoLogin() {
  const { token, setToken } = useAuth();
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    if (token) return; // already authenticated — nothing to do.
    if (typeof window === "undefined") return;

    type TelegramWebApp = { initData?: string };
    const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    const initData = tg?.initData;
    if (!initData || typeof initData !== "string" || initData.length === 0) return;

    triedRef.current = true;

    // Fire-and-forget. Any failure → silent no-op.
    void (async () => {
      try {
        // Forward the referral code from the URL too, mirroring the
        // existing redirect-flow contract. Telegram Mini Apps may also
        // launch with a `?ref=` query param when deep-linked.
        const referralCode = (() => {
          try {
            return (
              new URLSearchParams(window.location.search)
                .get("ref")
                ?.trim()
                .toUpperCase()
                .slice(0, 16) || undefined
            );
          } catch {
            return undefined;
          }
        })();

        const res = await fetch("/api/auth/telegram/webapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, referralCode }),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { token?: string } | null;
        if (!data?.token) return;
        setToken(data.token);
      } catch {
        // Network/parse error — public-web TelegramLoginButton still works.
      }
    })();
  }, [token, setToken]);
}
