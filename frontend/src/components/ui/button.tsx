import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.96] select-none touch-action-manipulation" +
  " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-sm shadow-primary/20",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border border-destructive-border",
        outline:
          "border [border-color:var(--button-outline)] shadow-xs active:shadow-none bg-transparent",
        secondary:
          "border bg-secondary text-secondary-foreground border border-secondary-border",
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-lg px-3 text-xs",
        lg: "min-h-11 rounded-xl px-8 text-base",
        icon: "h-9 w-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
