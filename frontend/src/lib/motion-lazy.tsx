// R145 (Motion infra): the app's single Motion feature provider.
//
// CONTRACT (chunk-architecture-r145): this module may ONLY be imported
// from lazy route chunks (home/category/product families) — never from
// the eager app shell (App.tsx / app-shell / Navbar / main.tsx /
// instrument.ts). Importing it eagerly would drag the vendor-motion
// chunk into the entry's modulepreload set and blow the eager-path
// budget gate (150 KiB warn / 160 KiB hard fail at PERFORMANCE.md).
// The eager-sum gate in vite.config.ts fails the build if that ever
// happens; this comment is the human-readable half of the same rule.
//
// Feature set: domAnimation (animations, variants, enter/exit, hover/
// tap/focus gestures, whileInView viewport triggers). domMax (layout
// animation + drag) is deliberately NOT loaded: no consumer needs it
// and the feature delta is roughly 6 KB vs 18 KB gz on this chunk.
//
// strict mode: the `motion.` component is BANNED app-wide — every
// consumer uses the `m.` component so the feature bundle stays the
// LazyMotion-loaded one (a stray `motion.` import silently ships the
// full engine into the importing chunk).
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";

/**
 * The one Motion provider. Wrap the route's root element with it once
 * per route subtree that uses `m`:
 *
 *   <MotionLazy>{children}</MotionLazy>
 *
 * reducedMotion="user" honors the OS preference at the library level —
 * the FINAL_UX_SYSTEM §2 kill-switch contract — on top of (not instead
 * of) the CSS-level global kill-switch in index.css. Per-element
 * fallbacks: consumers still gate scroll-linked transforms on
 * useReducedMotion() themselves so the STATIC composition ( Scroll
 * Craft: depth stays in the static composition when motion is reduced)
 * is complete without any animation.
 */
export function MotionLazy({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
