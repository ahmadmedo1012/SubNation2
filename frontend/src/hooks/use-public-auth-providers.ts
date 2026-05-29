import { useEffect, useState } from "react";

interface PublicAuthProviders {
  /** WhatsApp OTP gateway is configured + reachable. */
  whatsappEnabled: boolean;
  /** True once the providers endpoint has been queried (success or fail). */
  fetched: boolean;
}

/**
 * Tiny probe of `/api/auth/providers` for the public login/register pages.
 *
 * Surfaces the WhatsApp-gateway availability flag. Telegram + Google are
 * advertised in the `providers` array of the same response (consumed by
 * <AuthProviders />); this hook only handles the WhatsApp flag because
 * the WhatsApp form is a separate, peer one-click button rendered by
 * the page directly.
 *
 * Soft-fails: on network error the flag stays false and the user falls
 * back to Telegram + Google buttons.
 */
export function usePublicAuthProviders(): PublicAuthProviders {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers");
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as
          | { whatsapp_enabled?: boolean }
          | null;
        if (cancelled) return;
        setWhatsappEnabled(!!data?.whatsapp_enabled);
      } catch {
        // network error — keep the safe defaults. The user can still
        // authenticate via Telegram or Google buttons rendered by
        // <AuthProviders />.
      } finally {
        if (!cancelled) setFetched(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { whatsappEnabled, fetched };
}
