import { useEffect, useState } from "react";

interface PublicAuthProviders {
  /** WhatsApp OTP gateway is configured + reachable. */
  whatsappEnabled: boolean;
  /**
   * Legacy Firebase Phone OTP is enabled. Default: false. The platform
   * has migrated to WhatsApp OTP for phone-based sign-in. Operator can
   * re-enable temporarily via the backend env var PHONE_AUTH_ENABLED=true.
   */
  phoneAuthEnabled: boolean;
  /** True once the providers endpoint has been queried (success or fail). */
  fetched: boolean;
}

/**
 * Tiny probe of `/api/auth/providers` for the public login/register pages.
 *
 * Surfaces TWO independent flags:
 *   - `whatsappEnabled`  — WhatsApp OTP gateway available
 *   - `phoneAuthEnabled` — legacy Firebase Phone OTP allowed
 *
 * Soft-fails: on network error both flags stay false (the safer default —
 * fall back to Telegram + Google rather than rendering a phone form
 * whose backend route is now blocked).
 */
export function usePublicAuthProviders(): PublicAuthProviders {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [phoneAuthEnabled, setPhoneAuthEnabled] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers");
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as
          | { whatsapp_enabled?: boolean; phone_auth_enabled?: boolean }
          | null;
        if (cancelled) return;
        setWhatsappEnabled(!!data?.whatsapp_enabled);
        setPhoneAuthEnabled(!!data?.phone_auth_enabled);
      } catch {
        // network error — keep the safe defaults (both false). The user
        // can still authenticate via Telegram or Google buttons rendered
        // by <AuthProviders />.
      } finally {
        if (!cancelled) setFetched(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { whatsappEnabled, phoneAuthEnabled, fetched };
}
