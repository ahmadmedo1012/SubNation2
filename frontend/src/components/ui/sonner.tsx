"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";

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
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
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
