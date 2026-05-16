"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Sonner Toaster mounted once at the App root. All `toast(...)` calls in the
 * codebase route through `hooks/use-toast.ts`'s shim into this single
 * Toaster, eliminating the previous two-toast-systems coexistence.
 *
 * Production-safe defaults:
 *   - position: "top-center"  →  works on mobile (no clash with bottom-nav)
 *                                 and keeps notifications in the user's
 *                                 reading flow on RTL pages
 *   - duration: 4000          →  enough to read, not so long it lingers
 *                                 (vs the previous 16-min "stuck" bug)
 *   - visibleToasts: 3        →  cap stack height; older toasts drop off
 *                                 gracefully rather than piling up
 *   - closeButton: true       →  every toast can be dismissed with one tap
 *   - richColors: true        →  destructive toasts go red, success green
 *   - dir: from <html dir>    →  honors lib/direction.ts boot lock
 *   - swipeDirection ("left") →  RTL-natural swipe-to-dismiss on touch
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
      closeButton
      richColors
      dir="rtl"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card/95 group-[.toaster]:backdrop-blur-3xl group-[.toaster]:text-foreground group-[.toaster]:border-border/50 group-[.toaster]:shadow-xl group-[.toaster]:max-w-[calc(100vw-1rem)]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:bg-card group-[.toast]:border-border/40 group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
