import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { storeToken } from "@/lib/auth-store";
import { settleTelegramCallbackUrl, isTelegramAuthCallback } from "@/lib/telegram-auth";
import { clearPendingReferral } from "@/hooks/use-whatsapp-otp";
import { useAuth } from "@/lib/auth";

/**
 * The Telegram native OIDC return route (subnation://auth/callback#token=…
 * &app_nonce=…).
 *
 * Review R7-a P2-5: the cold-start leg. Android routinely kills the
 * backgrounded app while the Chrome custom tab is open mid-auth; the
 * backend's redirect then RELAUNCHES the app through this URL — and
 * before this route existed, expo-router routed /auth/callback to
 * +not-found while the LoginScreen (the only handler of the callback,
 * mounted-only) never saw the minted 30-day JWT. The session row lived
 * server-side, the app never captured the credential.
 *
 * This route owns the cold-start leg and any url events that route here
 * while it is mounted; the LoginScreen keeps its own listener for the
 * warm case (both call the same idempotent storeToken + signIn pair —
 * the second call is a no-op-shaped duplicate fetch at worst).
 *
 * R192 (security, F-1): the token is accepted ONLY when the callback's
 * app_nonce matches the pending nonce the app itself minted and stored
 * in SecureStore at flow start — a forged deep link (login-CSRF) is
 * rejected and routed to the login screen; the stored session, if any,
 * is left untouched. A callback WITHOUT a token is a user cancellation —
 * home, as a guest.
 */
export default function TelegramAuthCallbackRoute() {
  const router = useRouter();
  const { signIn } = useAuth();
  const settledRef = useRef(false);

  useEffect(() => {
    const settle = (url: string | null) => {
      if (settledRef.current) return;
      if (!isTelegramAuthCallback(url)) {
        // Not our URL (or the app opened plain subnation://) — home.
        settledRef.current = true;
        router.replace("/");
        return;
      }
      void (async () => {
        const settlement = await settleTelegramCallbackUrl(url);
        if (settlement.status !== "ok") {
          // cancelled (no token) → home as a guest; rejected (injected
          // or stale callback — F-1) → the login screen, where the
          // user can simply retry the provider.
          settledRef.current = true;
          router.replace(settlement.status === "rejected" ? "/login" : "/");
          return;
        }
        settledRef.current = true;
        try {
          await storeToken(settlement.token);
          // The referral attribution rode the OIDC login URL — spent.
          await clearPendingReferral();
          await signIn(settlement.token);
        } finally {
          router.replace("/");
        }
      })();
    };

    // Cold start: the URL that launched the app.
    void Linking.getInitialURL().then(settle);
    // Warm: expo-router's linking integration navigates here on the
    // incoming url event — the event also reaches this listener.
    const subscription = Linking.addEventListener("url", ({ url }) => settle(url));
    return () => subscription.remove();
  }, [router, signIn]);

  // Blank while the mint completes (sub-second typical) — the splash
  // aesthetic, no flash of unrelated content.
  return null;
}
