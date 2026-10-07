import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // A4-F12 (R120-B2 / WCAG 1.4.11): the resting border needs ≥3:1
          // against the field's own fill. The previous `border-input/80`
          // measured 1.18:1 (dark card) / 1.28:1 (white card) — and even
          // full `--border` only reaches 1.29/1.37, because both tokens
          // sit within a few lightness points of the surfaces they edge.
          // `--muted-foreground` is the one border-capable token tuned
          // per theme for visibility: at /75 it measures 5.0:1 dark and
          // 3.7:1 light vs the card (4.99/3.71 — vs the input's own
          // card/60 fill the same, within rounding), staying ≥3:1 in both
          // themes on card, page and overlay surfaces. Hover bumps toward
          // the full token (8.0 dark / 6.7 light); the focus ring layers
          // on top unchanged (F3-01 carries focus contrast).
          "input-premium flex h-10 w-full rounded-xl border border-muted-foreground/75 bg-card/60 px-3 py-1 text-base shadow-sm",
          "file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground",
          "placeholder:text-muted-foreground",
          "hover:border-muted-foreground/90",
          // F3-01 (R111 WCAG 1.4.11): the focus ring was `ring-primary/60`
          // — a 60%-alpha brand wash measuring 2.03:1 (dark) / 2.92:1
          // (light) against the page background, below the 3:1 non-text
          // contrast floor for the focus indicator itself. Full-opacity
          // `ring-ring` (the same token the global :focus-visible outline
          // rides) measures 3.96:1 dark / 4.82-5.30:1 light. The border
          // tint stays as a secondary cue only — the ring carries the
          // contrast requirement.
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:border-primary/45",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
