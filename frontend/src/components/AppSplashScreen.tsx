import { Logo } from "@/components/layout/Logo";

/**
 * Brief loading screen shown while `AuthProvider` probes
 * `/api/auth/me` to determine whether the user has a live cookie
 * session. Renders for ~50-300 ms typically (one same-origin
 * round-trip), then `AuthGate` swaps in the real route tree.
 *
 * Design constraints (in priority order):
 *   1. NO flash of unauthenticated UI.
 *      → matches `bg-background` so there is zero color change
 *        between this screen and the eventual logged-in layout.
 *   2. NO layout shift on swap.
 *      → fills the viewport (`min-h-[100dvh]`); the logo is
 *        absolute-centered so its position is independent of the
 *        screen size.
 *   3. NO async dependencies.
 *      → does not call hooks, fetch data, or read context. If
 *        AuthProvider's probe hangs, this still renders cleanly.
 *   4. Theme-aware.
 *      → dark/light mode handled via existing CSS variables; no
 *        prop wiring needed.
 *   5. Minimal motion (Libya market = many low-end Android devices,
 *      respects `prefers-reduced-motion` automatically because
 *      `animate-pulse` is a transform-free Tailwind animation).
 *
 * This is also the screen people see on first visit before any
 * route lazy-imports resolve, so keep the import surface tiny.
 */
export function AppSplashScreen() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="جاري التحميل"
    >
      <div className="flex flex-col items-center gap-4">
        <Logo size="lg" showText />
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
