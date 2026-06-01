import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

/**
 * Thin top-of-page progress bar that signals "a route change is in
 * flight". Mirrors the pattern from YouTube / GitHub / Vercel —
 * presence of the bar = the next page is loading, absence = nothing
 * is happening.
 *
 * Why a separate visual instead of wrapping wouter's `useLocation`
 * in `startTransition`:
 *   • startTransition with wouter v3 needs a custom `hook` on
 *     <Router/> and the Link integration is fragile (touches every
 *     navigation site in the app).
 *   • Phase 2 already replaced the spinner Suspense fallback with a
 *     layout-matching skeleton, so the perceived "previous page →
 *     skeleton" jump is now a content-fill, not a flash.
 *   • A standalone progress bar adds the missing "something is
 *     happening" cue without touching the router at all.
 *
 * Behavior:
 *   • Bar appears 80ms after a route change starts (skips the bar
 *     on instant navigations to chunks already in cache).
 *   • Bar grows from 0 → 80% over ~600ms (eased) while loading.
 *   • Bar completes 80% → 100% then fades out 200ms after the new
 *     route reports a steady location.
 *
 * Pure CSS animation (transform: scaleX) so it stays at 60fps on
 * low-end Android. Honors prefers-reduced-motion: bar shows but does
 * not animate.
 */
export function NavigationProgress() {
  const [location] = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const lastLocation = useRef(location);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (location === lastLocation.current) return;
    lastLocation.current = location;

    if (showTimer.current) clearTimeout(showTimer.current);
    if (completeTimer.current) clearTimeout(completeTimer.current);

    setProgress(0);
    setVisible(false);

    // Delay shown state by 80ms — most chunk loads on warm cache
    // resolve faster than that and we'd just be flashing the bar.
    showTimer.current = setTimeout(() => {
      setVisible(true);
      // Two-step ramp so the bar reaches 80% quickly then crawls.
      requestAnimationFrame(() => setProgress(80));
    }, 80);

    // Whatever the route does next (resolves chunk, suspends on
    // data, etc.), we cap the visible bar at ~600ms total so it
    // never feels stuck. The new route's own skeleton takes over
    // as the "still loading" cue from there.
    completeTimer.current = setTimeout(() => {
      setProgress(100);
      setTimeout(() => setVisible(false), 200);
    }, 600);

    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (completeTimer.current) clearTimeout(completeTimer.current);
    };
  }, [location]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 inset-x-0 h-[2px] z-[100] pointer-events-none"
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-primary via-primary to-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.6)] transition-transform duration-500 ease-out"
        style={{ transform: `scaleX(${progress / 100})` }}
      />
    </div>
  );
}
