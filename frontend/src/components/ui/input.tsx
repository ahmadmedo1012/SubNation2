import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Resting border slightly stronger (was border-input only) so
          // the field reads as a real edge on the light theme — used to
          // disappear into the white card on focus-out.
          // Hover bumps to border-border/80 + the focus ring layers on
          // top of that, giving the user three distinct visual states
          // (idle / hover / focus) without changing the height.
          "input-premium flex h-10 w-full rounded-xl border border-input/80 bg-card/60 px-3 py-1 text-base shadow-sm",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          "hover:border-border/80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:border-primary/45",
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
