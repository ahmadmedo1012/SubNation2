import { useEffect, useRef, useState } from "react";

/**
 * R115-A10 (motion): pause ambient infinite animations (blob-drift and
 * friends) when their container leaves the viewport. Same technique as
 * home.tsx's 96-F5 (R96 F-4b) guest-hero pause, extracted so every page
 * riding a blurred drifting blob gets it for free — the 9s/13s infinite
 * animations with will-change:transform kept rasterizing big blurred
 * layers long after anyone could see them.
 *
 * Toggles `animation-play-state` via the returned style; the keyframes
 * themselves live in index.css. prefers-reduced-motion keeps winning via
 * the global kill-switch (animation-duration 0.01ms), and the initial
 * state is `running` so nothing flashes paused before the first observer
 * callback.
 *
 * @param enabled gate for conditionally-rendered trees — pass the same
 *   flag that mounts the observed subtree so the observer (re-)arms when
 *   it appears (ref.current is null on the first effect run otherwise).
 */
export function useOnScreen<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? true),
      { rootMargin: "64px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return {
    ref,
    onScreen,
    /** Inline style to spread on the animated element(s). */
    style: { animationPlayState: (onScreen ? "running" : "paused") as "running" | "paused" },
  };
}
