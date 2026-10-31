import { useEffect, useRef, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * R192 (T2-1 — the website-audit's one genuine missing state class): the
 * global connectivity cue.
 *
 * `navigator.onLine` was referenced only in lib/healthz.ts — an offline
 * user got per-surface error cards but no global context, and the static
 * offline shell covers only the JS-never case. Libyan mobile links make
 * "offline mid-session" a real journey condition.
 *
 * Contract (the audit's constraints, kept):
 *   • a slim floating pill — never blocks, never overlays content
 *     (sits above the mobile nav / the desktop bottom edge);
 *   • `onLine` is a HINT: `false` is a real signal (no interface) and
 *     shows the persistent pill; `true` proves nothing — only the
 *     offline→online TRANSITION gets a brief, hedged recovery note
 *     («عاد الاتصال بالشبكة» — network, not internet);
 *   • sr-only announced via role="status" + aria-live="polite" (the
 *     R135 FE-2 state-swap idiom);
 *   • renders null while online-and-stable — zero cost, zero noise.
 */
export function ConnectivityBanner() {
  const [offline, setOffline] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearDismiss = () => {
      if (dismissTimer.current !== null) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };

    const goOffline = () => {
      clearDismiss();
      setJustReconnected(false);
      setOffline(true);
    };
    const goOnline = () => {
      setOffline(false);
      // The transition note: 4 s, then gone. Rapid flapping resets it.
      clearDismiss();
      setJustReconnected(true);
      dismissTimer.current = setTimeout(() => setJustReconnected(false), 4_000);
    };

    // Sync once on mount (a boot that starts offline shows the pill).
    setOffline(!navigator.onLine);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      clearDismiss();
    };
  }, []);

  if (!offline && !justReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      /* bottom-16 clears the 60px MobileNav (the --mobile-nav-h pin);
         sm:bottom-6 tucks above the desktop edge. w-fit + mx-auto =
         a centered pill that never covers interactive content. */
      className="fixed bottom-16 sm:bottom-6 inset-x-0 mx-auto w-fit z-40
                 flex items-center gap-2 px-3.5 py-2 rounded-full
                 bg-card border border-border/60 shadow-calm
                 text-xs font-semibold text-muted-foreground"
    >
      {offline ? (
        <>
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>أنت غير متصل — تحقّق من شبكتك</span>
        </>
      ) : (
        <>
          <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>عاد الاتصال بالشبكة</span>
        </>
      )}
    </div>
  );
}
