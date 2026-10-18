import { Loader2 } from "lucide-react";
import { useState } from "react";
import { getErrorMessage } from "@/lib/errors";
// R167-C (F17): the paper plane rides the shared brand glyph
// (components/brand/TelegramGlyph) — byte-identical path + 18px size;
// aria-hidden opted in to match this site's pre-extraction markup.
import { TelegramGlyph } from "@/components/brand/TelegramGlyph";

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
  /** R154 (P2): when true, the button starts the modern OIDC flow
   *  (GET /api/auth/telegram/oidc/login) instead of the legacy widget
   *  redirect — the backend builds the oauth.telegram.org Authorization
   *  Code + PKCE URL server-side (state/nonce/verifier live in the
   *  backend's single-use store; the browser never sees a secret).
   *  Registration through this flow never asks for a phone number
   *  (scopes are openid + profile only). */
  oidc?: boolean;
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

/**
 * 93-C5 / F-15 (A4 #3): read + validate the ?redirect= buy-intent target
 * from the login page's URL. Same-origin internal paths only
 * (slash-prefixed, no protocol/host, no "//") so it can't be abused as
 * an open redirect — mirrors login.tsx's readRedirectTarget. The target
 * must survive the Telegram round-trip, so it is re-appended to the
 * return_to URL and honored by telegram-callback after sign-in.
 */
function readRedirectTargetFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (!target || !target.startsWith("/") || target.startsWith("//")) return undefined;
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    return url.pathname + url.search;
  } catch {
    return undefined;
  }
}

export function TelegramLoginButton({ botId, oidc = false, onError }: TelegramLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!botId) {
      onError("لم يتم إعداد بوت Telegram");
      return;
    }

    try {
      setLoading(true);

      const referral = readReferralFromUrl();
      // 93-C5 / F-15 (A4 #3): the guarded destination must survive the
      // round-trip (the legacy flow re-appends it to return_to; the
      // R154 OIDC flow passes it to the login endpoint which binds it
      // into the server-side state).
      const redirect = readRedirectTargetFromUrl();

      if (oidc) {
        // R154 (P2) — the modern transport: one top-level navigation to
        // the backend, which issues state/PKCE/nonce, redirects to
        // oauth.telegram.org, and completes the Authorization Code flow
        // on the callback. No popup, no cross-window postMessage, no
        // CSP allowances; COOP-irrelevant (top-level navigation).
        const login = new URL("/api/auth/telegram/oidc/login", window.location.origin);
        if (referral) login.searchParams.set("ref", referral);
        if (redirect) login.searchParams.set("redirect", redirect);
        window.location.href = login.toString();
        return;
      }

      const origin = window.location.origin;

      // Build the return URL pointing at the FRONTEND callback page.
      //
      // Telegram appends the signed payload as a URL fragment
      // (#tgAuthResult=<base64>) — which is invisible to the server.
      // So the callback MUST be a SPA route that can read
      // window.location.hash. The SPA page POSTs the decoded payload
      // to /api/auth/telegram for verification + JWT issuance.
      const returnUrl = new URL("/auth/telegram-callback", origin);
      if (referral) returnUrl.searchParams.set("ref", referral);
      if (redirect) returnUrl.searchParams.set("redirect", redirect);

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
      // R148 (error-copy sweep): raw extractor → getErrorMessage (the
      // R144-C1 idiom) — the auth-url fetch's ApiError prefix never lands
      // raw in this Arabic error slot.
      onError(getErrorMessage(err) || "تعذّر فتح صفحة Telegram، حاول مجدداً");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || !botId}
      className="w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-semibold text-sm disabled:opacity-60 press-spring"
      aria-label="المتابعة عبر Telegram"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TelegramGlyph aria-hidden />}
      {/* R123-E4b (P3-k): single-glyph ellipsis «…» (was ASCII "..."). */}
      {loading ? "جارٍ التحويل…" : "المتابعة عبر Telegram"}
    </button>
  );
}
