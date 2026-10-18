// R145 (Motion primitives): the app's restrained scroll-reveal vocabulary.
//
// The recipe is the Scroll-Craft taste floor, encoded once so no consumer
// re-decides durations or curves:
//   - opacity 0 → 1 with a 14px rise, 620ms, cubic-bezier(0.23, 1, 0.32, 1)
//     (ease-out; never ease-in on UI — it delays the moment the eye is on)
//   - fires ONCE, slightly INSIDE the viewport (amount 0.2) so it triggers
//     when the reader is looking, not when the first pixel clears the fold
//   - children stagger 48ms — inside the sanctioned 30–80ms band
//   - reduced motion: MotionConfig reducedMotion="user" (mounted in
//     motion-lazy.tsx) automatically drops the transform and keeps the
//     opacity — "fewer and gentler, not zero"
//
// CONTRACT: these components import `m` from motion/react and therefore
// MUST be rendered inside <MotionLazy> (src/lib/motion-lazy.tsx). They
// are only ever imported by lazy route chunks — never the eager shell.
import { m } from "motion/react";
import type { Variants } from "motion/react";

/** The sanctioned ease — one curve app-wide for reveals. */
const EASE_OUT_QUIET = [0.23, 1, 0.32, 1] as const;

/** The rise distance: 14px. Under 24px reads as a fade-with-intent;
 *  over it reads as a slide. */
const RISE_PX = 14;

/** One reveal, 620ms. `delay` is the stagger slot (multiples of 48ms). */
const revealVariants: Variants = {
  hidden: { opacity: 0, y: RISE_PX },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.62, ease: EASE_OUT_QUIET, delay },
  }),
};

/** Group container that staggers its Reveal children by 48ms. */
const staggerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.048 } },
};

/** Child of RevealGroup — inherits the stagger, same quiet recipe. */
const staggerChildVariants: Variants = {
  hidden: { opacity: 0, y: RISE_PX },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.62, ease: EASE_OUT_QUIET },
  },
};

const VIEWPORT_ONCE = { once: true, amount: 0.2 } as const;

/** A single scroll-triggered reveal. Fires once, inside the viewport. */
export function Reveal({
  children,
  className,
  style,
  as = "div",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "section" | "header" | "h2" | "p" | "li" | "span";
  delay?: number;
}) {
  const Comp = m[as] as typeof m.div;
  return (
    <Comp
      className={className}
      style={style}
      variants={revealVariants}
      custom={delay}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT_ONCE}
    >
      {children}
    </Comp>
  );
}

/** A staggered reveal group — children use <RevealItem />. */
export function RevealGroup({
  children,
  className,
  style,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "section" | "ul" | "header";
}) {
  const Comp = m[as] as typeof m.div;
  return (
    <Comp
      className={className}
      style={style}
      variants={staggerVariants}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT_ONCE}
    >
      {children}
    </Comp>
  );
}

/** One item inside <RevealGroup /> — rides the 48ms stagger. */
export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li" | "article" | "span";
}) {
  const Comp = m[as] as typeof m.div;
  return (
    <Comp className={className} variants={staggerChildVariants}>
      {children}
    </Comp>
  );
}
