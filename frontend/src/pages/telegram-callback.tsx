import { useAuth } from "@/lib/auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

const HANG_TIMEOUT_MS = 12_000;

/**
 * Telegram redirect-flow callback page.
 *
 * BACKGROUND
 * ----------
 * Telegram's OAuth-style auth endpoint at oauth.telegram.org/auth
 * appends the signed user payload to the `return_to` URL as a URL
 * FRAGMENT, not query string:
 *
 *   https://subnation.ly/auth/telegram-callback?ref=ABC#tgAuthResult=<base64>
 *
 * Fragments are NEVER sent to the server (this is Telegram's chosen
 * security property — auth tokens don't end up in server access
 * logs). So a backend GET handler at the same URL would see an
 * empty query and incorrectly map the redirect to "cancelled". The
 * fragment must be read in the browser, then POSTed to the
 * backend's /api/auth/telegram for HMAC verification and session
 * issuance.
 *
 * FLOW
 * ----
 *   1. TelegramLoginButton sets return_to to this page.
 *   2. User auths on Telegram, Telegram redirects here with the
 *      payload in the fragment.
 *   3. We decode the base64-encoded JSON.
 *   4. We POST it (plus the referral code from the query string) to
 *      /api/auth/telegram which verifies HMAC, runs replay
 *      protection, finds-or-creates the user, signs a JWT, returns
 *      `{ token, is_new_user }`.
 *   5. We store the JWT via the auth context, then navigate("/",
 *      { replace: true }) so the back button doesn't return here.
 *   6. Any failure surfaces a stable reason code via
 *      /login?error=<reason> for AuthErrorBanner to render.
 */

interface DecodedTelegramPayload {
  /** All authentication fields (id, first_name, last_name, username,
   *  photo_url, auth_date, hash). Numeric values may already be
   *  strings — backend coerces. */
  data: Record<string, string | number>;
  /** The referral code from `?ref=` on this page's URL (NOT from
   *  Telegram — we put it on return_to ourselves). */
  referralCode?: string;
}

/**
 * Decode the Telegram redirect payload. Tries the fragment format
 * first (current Telegram behaviour); falls back to query string for
 * defence-in-depth in case Telegram's redirect format changes.
 */
function decodeTelegramPayload(): DecodedTelegramPayload | null {
  if (typeof window === "undefined") return null;

  // Capture referral code from query string before consuming the URL.
  const search = new URLSearchParams(window.location.search);
  const referralCode = search.get("ref")?.trim().toUpperCase().slice(0, 16) || undefined;

  // 1. Preferred: fragment with `#tgAuthResult=<base64>`.
  const hash = window.location.hash ?? "";
  const tgAuthResultPrefix = "#tgAuthResult=";
  if (hash.startsWith(tgAuthResultPrefix)) {
    const encoded = hash.slice(tgAuthResultPrefix.length);
    try {
      // Telegram uses base64url; convert to standard base64 + pad.
      let normalised = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const padding = normalised.length % 4;
      if (padding) normalised += "=".repeat(4 - padding);
      const json = atob(normalised);
      const data = JSON.parse(json) as Record<string, unknown>;
      if (data && typeof data === "object" && data.id !== undefined && data.hash) {
        return {
          data: data as Record<string, string | number>,
          referralCode,
        };
      }
    } catch {
      // Malformed fragment — treat as no payload.
    }
  }

  // 2. Fallback: query string with id + hash + auth_date directly.
  if (search.has("id") && search.has("hash") && search.has("auth_date")) {
    const data: Record<string, string> = {};
    search.forEach((value, key) => {
      if (key !== "ref") data[key] = value;
    });
    return { data, referralCode };
  }

  return null;
}

export default function TelegramCallbackPage() {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const handled = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [hangVisible, setHangVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHangVisible(true), HANG_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Strict-mode + remount guard — the network call must run exactly
    // once. Replay protection on the backend would reject a duplicate
    // POST anyway, but failing early is cleaner.
    if (handled.current) return;
    handled.current = true;

    const payload = decodeTelegramPayload();
    if (!payload) {
      // No fragment AND no usable query — user cancelled, came back
      // to the URL manually, or the redirect was malformed.
      navigate("/login?error=cancelled", { replace: true });
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload.data,
            referralCode: payload.referralCode,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          token?: string;
          error?: string;
          reason?: string;
        };

        if (!res.ok || !json.token) {
          const reason = json.reason || "server_error";
          navigate(`/login?error=${encodeURIComponent(reason)}`, { replace: true });
          return;
        }

        // Success — store JWT then leave the URL behind so the back
        // button doesn't bring the user back to this transient page.
        setToken(json.token);
        // Strip the fragment from the URL bar before navigating away.
        if (window.location.hash) {
          window.history.replaceState({}, "", window.location.pathname);
        }
        navigate("/", { replace: true });
      } catch {
        setError("server_error");
        navigate("/login?error=server_error", { replace: true });
      }
    })();
  }, [setToken, navigate]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground max-w-sm text-center">
        {hangVisible ? (
          <>
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm font-bold text-foreground">تأخّر تسجيل الدخول عبر Telegram</p>
            <p className="text-xs leading-relaxed">
              قد تكون الشبكة بطيئة. حاول مرة أخرى من صفحة تسجيل الدخول.
            </p>
            <Link
              href="/login"
              className="mt-2 inline-flex items-center justify-center h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold press-spring shadow-md shadow-primary/22"
            >
              العودة لتسجيل الدخول
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
            <p className="text-sm">جارٍ إكمال تسجيل الدخول عبر Telegram…</p>
            {error && <p className="text-xs text-destructive">حدث خطأ، إعادة التوجيه…</p>}
          </>
        )}
      </div>
    </div>
  );
}
