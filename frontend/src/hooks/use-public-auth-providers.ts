import { useEffect, useState } from "react";

interface PublicAuthProviders {
  whatsappEnabled: boolean;
  /** True once the providers endpoint has been queried (success or fail). */
  fetched: boolean;
}

/**
 * Tiny probe of `/api/auth/providers` for the public login/register pages.
 *
 * Today it surfaces only `whatsapp_enabled` — the flag the public login
 * UI uses to decide between WhatsApp OTP and Firebase Phone OTP. Soft-
 * fails: a network error simply leaves whatsappEnabled=false, so the
 * Firebase phone fallback continues to render.
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
        // network error — leave defaults; Firebase fallback will render
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
