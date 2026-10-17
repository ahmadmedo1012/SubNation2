import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * R157-C (design-system): the shared native-select primitive.
 *
 * The admin console + storefront rode five divergent hand-rolled
 * `<select>` recipes (bare `px-3 py-1.5 border rounded`, a /55 muted
 * inset, a full-border secondary fill…) — this extract is the audit's
 * "un-tokenized form-control tail" fix: ONE select on the Input recipe
 * (input.tsx), so every form field shares geometry.
 *
 * Deliberately the NATIVE `<select>` (not Radix — ponytail): native
 * dropdowns have the best mobile UX (OS picker sheets on iOS/Android)
 * and Arabic accessibility (real option semantics for SRs). The UA
 * popup stays native on purpose — `color-scheme` is already set per
 * theme on :root/.light (index.css R115-A6 #14), so the OS-rendered
 * option list follows the active theme; only the closed control below
 * is themed by these classes.
 *
 * RTL: the site is `dir="rtl"` (index.html), so the chevron sits at
 * the inline-END (physical left) via the logical `end-2.5` inset +
 * `pe-8` padding — mirrored automatically if a dir ever flips.
 */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // The input.tsx recipe, verbatim geometry: h-10, rounded-xl,
          // bg-card/60, the A4-F12 calibrated ≥3:1 border, the F3-01
          // focus ring, disabled + the A13-F7 pointer:fine zoom guard.
          "input-premium flex h-10 w-full appearance-none rounded-xl border border-muted-foreground/75 bg-card/60 py-1 ps-3 pe-8 text-base shadow-sm",
          "hover:border-muted-foreground/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:border-primary/45",
          "disabled:cursor-not-allowed disabled:opacity-50 [@media(min-width:48rem)_and_(pointer:fine)]:text-sm",
          "cursor-pointer",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {/* The chevron the native arrow gave up with appearance-none —
          the CatalogFiltersBar sibling-icon pattern, folded in. */}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
