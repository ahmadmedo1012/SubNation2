import { Loader2 } from "lucide-react";
import { useState } from "react";

/**
 * Telegram Login — CSP-safe redirect flow.
 *
 * BACKGROUND
 * ----------
 * The official `telegram-widget.js` script (loaded from telegram.org) uses
 * `eval()` internally for popup-message dispatch. Production CSP correctly
 * blocks `unsafe-eval`, which kills the widget. Adding `unsafe-eval`
 * globally would weaken the security posture for ALL scripts on the
 * page — unacceptable.
 *
 * SOLUTION
 * --------
 * Bypass the widget script entirely. Telegram's auth itself is just a
 * standard OAuth-style redirect. The widget is a convenience renderer;
 * the underlying flow is:
 *
 *   1. Client redirects (top-level navigation) to:
 *        https://oauth.telegram.org/auth?
 *          bot_id={BOT_ID}&
 *          origin={ORIGIN}&
 *          embed=0&
 *          request_access=write&
 *          return_to={CALLBACK_URL}
 *
 *   2. Telegram authenticates the user on its own domain (no iframe,
 *      no postMessage, runs in Telegram's CSP context).
 *
 *   3. Telegram redirects the browser to {CALLBACK_URL} with the
 *      signed payload appended as URL query params:
 *        ?id=…&first_name=…&last_name=…&username=…&photo_url=…
 *        &auth_date=…&hash=…
 *
 *   4. Our backend GET /api/auth/telegram/callback verifies the HMAC,
 *      runs replay protection, finds-or-creates the user, signs a
 *      JWT, and 302s the browser to /auth/callback?token=… which
 *      stores the JWT and lands on /.
 *
 * Top-level navigations are NOT controlled by `script-src`,
 * `frame-src`, `connect-src`, or `form-action` CSP directives, so this
 * flow is fully compatible with our hardened CSP — no allowances
 * needed for telegram.org or oauth.telegram.org.
 *
 * It also works:
 *   ✓ on desktop (full-page redirect, no popup blocker)
 *   ✓ on mobile (no postMessage / popup needed)
 *   ✓ in WebViews and in-app browsers
 *   ✓ under COOP: same-origin-allow-popups
 *   ✓ in Safari with strict ITP (no third-party storage)
 */

interface TelegramLoginButtonProps {
  /**
   * Numeric Telegram bot ID — the part of the bot token before the
   * colon. Exposed by /api/auth/providers (the backend parses
   * `bot_token` and surfaces only the numeric prefix; the full token
   * is never sent to the browser).
   */
  botId: string;
  /** Bot username (without the `@`). Currently unused for redirect flow
   *  but kept for diagnostics + future popup-mode fallback. */
  botUsername?: string;
  /** No-op in redirect flow — the backend handles success and ends up
   *  on /auth/callback. Kept to preserve the AuthProviders contract. */
  onSuccess?: (token: string) => void;
  /** Synchronous error display (for pre-redirect validation only).
   *  Errors that happen during the redirect cycle are surfaced via
   *  ?error= query params on /login (handled by LoginPage). */
  onError: (message: string) => void;
}

function readReferralFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref) return undefined;
  const trimmed = ref.trim().toUpperCase().slice(0, 16);
  return trimmed || undefined;
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#2AABEE" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
    </svg>
  );
}

export function TelegramLoginButton({ botId, onError }: TelegramLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!botId) {
      onError("لم يتم إعداد بوت Telegram");
      return;
    }

    try {
      setLoading(true);

      const origin = window.location.origin;
      const referral = readReferralFromUrl();

      // Build the return URL pointing at the FRONTEND callback page.
      //
      // Telegram appends the signed payload as a URL fragment
      // (#tgAuthResult=<base64>) — which is invisible to the server.
      // So the callback MUST be a SPA route that can read
      // window.location.hash. The SPA page POSTs the decoded payload
      // to /api/auth/telegram for verification + JWT issuance.
      const returnUrl = new URL("/auth/telegram-callback", origin);
      if (referral) returnUrl.searchParams.set("ref", referral);

      // Build the official Telegram OAuth URL.
      const authUrl = new URL("https://oauth.telegram.org/auth");
      authUrl.searchParams.set("bot_id", botId);
      authUrl.searchParams.set("origin", origin);
      authUrl.searchParams.set("embed", "0"); // 0 = redirect mode (no popup)
      authUrl.searchParams.set("request_access", "write");
      authUrl.searchParams.set("return_to", returnUrl.toString());

      // Top-level navigation — NOT subject to script-src / frame-src CSP.
      // Browser leaves our origin; Telegram authenticates; user comes
      // back to our backend with the signed payload.
      window.location.href = authUrl.toString();
    } catch (err) {
      setLoading(false);
      onError(
        err instanceof Error ? err.message : "تعذّر فتح صفحة Telegram، حاول مجدداً",
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || !botId}
      className="w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-medium text-sm disabled:opacity-60 press-spring"
      aria-label="المتابعة عبر Telegram"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TelegramIcon />}
      {loading ? "جارٍ التحويل..." : "المتابعة عبر Telegram"}
    </button>
  );
}
