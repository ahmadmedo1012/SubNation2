import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 press-spring select-none touch-action-manipulation" +
    " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/95 text-primary-foreground border border-primary-border shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30",
        // R128 (A1-F2): the surface channel (52% dark) — white ink on the
        // plain --destructive channel computed 3.99:1 (AA fail); the
        // surface pair keeps ink tokens untouched.
        destructive:
          "bg-destructive-surface text-destructive-foreground shadow-sm border border-destructive-border",
        outline:
          "border [border-color:var(--button-outline)] shadow-xs active:shadow-none bg-transparent",
        secondary: "border bg-secondary text-secondary-foreground border border-secondary-border",
        // Ghost: keep transparent at rest, but pick up a soft surface
        // on hover. Border stays transparent (kept the `border` class
        // so size math matches the other variants — pure-text ghosts
        // were 1px shorter and broke flex alignment in toolbars).
        ghost: "border border-transparent hover:bg-muted/45 hover:text-foreground",
        // 94-C3 (A3 P2-4): link text rides --primary-text (the text-safe
        // variant of the brand hue) — raw text-primary is the surface
        // color and lands ~3.9:1 on dark surfaces.
        link: "text-primary-text underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-lg px-3 text-xs",
        // R116-S1 CTA recipe: the canonical primary CTA across the
        // storefront is `<Button size="lg" className="w-full sm:w-auto">`
        // — 48px tall, full-width on mobile, auto on ≥sm. Pages must not
        // hand-roll h-11/h-12 + shadow + bg-primary overrides on top of it.
        lg: "h-12 px-8 text-base font-semibold",
        icon: "h-9 w-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
