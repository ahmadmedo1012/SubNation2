import { useEffect, useState } from "react";

interface PublicAuthProviders {
  /** WhatsApp OTP gateway is configured + reachable. */
  whatsappEnabled: boolean;
  /**
   * Live pairing status of the WhatsApp session (r95): "ready" when
   * OTPs can flow right now, "settling" while the just-linked session
   * is inside the settle window (96-F2), "failed" when the gateway
   * reports the channel dead (97-F5 / J-1 — backend 97-F3 now passes
   * this verbatim instead of masking it), any other OpenWA lifecycle
   * value (qr_ready / initializing / disconnected / …) or null (probe
   * failed) otherwise. Used for an honest hint under the button —
   * never to hard-hide the entry (the operator can complete pairing
   * at any moment).
   */
  whatsappStatus: string | null;
  /**
   * 96-F2 (R96-A4 §1.3E): derived from whatsappStatus — true while
   * the live probe reports "settling": the session was JUST linked
   * and the settle window (sender-key / app-state propagation) is
   * still running. Consumers render an honest "preparing" hint
   * instead of letting the first OTP land in WhatsApp's "Waiting for
   * this message" window. Never blocks the entry — the window is
   * short by design.
   */
  whatsappSettling: boolean;
  /**
   * 97-F5 (J-1): derived from whatsappStatus — true when the gateway
   * reports "failed": the channel is NOT mid-pairing and there is no
   * point suggesting a retry. Consumers render the honest
   * operator-fix copy («غير مرتبطة حاليًا — استخدم Google أو Telegram
   * مؤقتًا») in a muted info style instead of the misleading
   * «قيد الربط مؤقتاً» generic hint.
   */
  whatsappFailed: boolean;
  /** True once the providers endpoint has been queried (success or fail). */
  fetched: boolean;
}

/**
 * Tiny probe of `/api/auth/providers` for the public login/register pages.
 *
 * Surfaces the WhatsApp-gateway availability flag + live session status.
 * Telegram + Google are advertised in the `providers` array of the same
 * response (consumed by <AuthProviders />); this hook only handles the
 * WhatsApp fields because the WhatsApp form is a separate, peer
 * one-click button rendered by the page directly.
 *
 * Soft-fails: on network error the flag stays false and the user falls
 * back to Telegram + Google buttons.
 */
export function usePublicAuthProviders(): PublicAuthProviders {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers");
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as {
          whatsapp_enabled?: boolean;
          whatsapp_status?: string | null;
        } | null;
        if (cancelled) return;
        setWhatsappEnabled(!!data?.whatsapp_enabled);
        // Absent field (older backend) → null → the UI shows no hint.
        setWhatsappStatus(data?.whatsapp_status ?? null);
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

  return {
    whatsappEnabled,
    whatsappStatus,
    whatsappSettling: whatsappStatus === "settling",
    whatsappFailed: whatsappStatus === "failed",
    fetched,
  };
}
