"use client";

import { useTheme } from "@/lib/theme";
import { toast, Toaster as Sonner } from "sonner";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { useEffect } from "react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Premium toast surface mounted once at the App root. We deliberately
 * drop Sonner's built-in `richColors` so we can drive the visual
 * language ourselves via CSS — leading-edge accent strip, tinted icon
 * bubble, glass panel, colored glow shadow. See the
 * "PREMIUM TOAST SYSTEM" block in index.css for the actual styling.
 *
 * Behavior preserved from the previous wrapper:
 *   - position: "top-center"  RTL-friendly, doesn't clash with bottom nav
 *   - duration: 4000          enough to read, not the 16-min stuck-toast bug
 *   - visibleToasts: 3        cap stack height
 *   - dir: "rtl"              swipe + layout honor RTL
 *   - closeButton: true       one-tap dismiss on every toast
 *
 * Lucide icons replace Sonner's defaults at the Toaster level so every
 * variant renders with consistent stroke-width and visual weight.
 *
 * A5-5 (R116 — lazy mount + pre-mount replay): App mounts this module
 * via React.lazy on idle (see IdleToaster in App.tsx), so sonner + the
 * five lucide icons stay out of the entry graph. sonner 2.x hydrates a
 * freshly-mounted <Toaster/> from an EMPTY list and only receives
 * toasts published AFTER its subscription — anything fired while this
 * chunk was still loading (session-expired redirects, boot-window
 * errors) would be silently lost. The mount effect below re-publishes
 * every active store toast (same ids, so later updates/dismissals
 * keep targeting them) — the queue flushes the moment the Toaster
 * appears, and each replayed toast restarts its duration timer (the
 * user has not seen it yet, so it keeps its full reading window).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  // App theme (sn_theme), NOT the OS preference. The previous import of
  // next-themes' useTheme resolved to "system" because no NextThemeProvider
  // is ever mounted in this SPA — toasts then followed the OS theme instead
  // of the theme the user picked in the app.
  const { theme } = useTheme();

  useEffect(() => {
    // The Sonner <Toaster/> child subscribes in its own mount effect,
    // and child effects run before this parent effect — so every
    // re-publish below is delivered to it exactly once.
    for (const active of toast.getToasts()) {
      // Dismiss-shaped entries are not renderable toasts.
      if (!("title" in active)) continue;
      // ExternalToast deliberately omits `type`/`title`/`jsx` (the
      // variant helpers own them) — but the runtime store carries
      // them and the Toaster reads `type` for the icon + [data-type]
      // accent styling. Spread the stored payload whole so the replay
      // is pixel-identical to a live toast; the id is preserved so
      // dedup / update / dismiss all keep working.
      toast(active.title, {
        ...(active as unknown as Record<string, unknown>),
        id: active.id,
      } as Parameters<typeof toast>[1]);
    }
    // Mount-only: the bridge exists solely to hydrate toasts fired
    // BEFORE this lazy chunk mounted.
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="top-center"
      duration={4000}
      visibleToasts={3}
      gap={12}
      offset="20px"
      closeButton
      dir="rtl"
      icons={{
        success: <CheckCircle2 strokeWidth={2.4} />,
        error: <AlertCircle strokeWidth={2.4} />,
        warning: <AlertTriangle strokeWidth={2.4} />,
        info: <Info strokeWidth={2.4} />,
        loading: <Loader2 className="animate-spin" strokeWidth={2.4} />,
      }}
      toastOptions={{
        classNames: {
          toast: "premium-toast",
          title: "premium-toast-title",
          description: "premium-toast-description",
          actionButton: "premium-toast-action",
          cancelButton: "premium-toast-cancel",
          closeButton: "premium-toast-close",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
