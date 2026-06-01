import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Section heading with the brand-pink leading bar that appears
 * across home / category / wallet / orders pages. Replaces the
 * inline `<span className="w-1 h-4 bg-primary rounded-full"/>`
 * pattern that was hand-rolled at every site.
 *
 * Defaults to <h2> for SEO outlining; pass `as="h3"` (etc.) when
 * the heading sits inside a deeper section.
 */
type Tone = "primary" | "success" | "warning" | "info" | "muted";

const TONE: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-status-success",
  warning: "bg-status-warning",
  info: "bg-status-info",
  muted: "bg-muted-foreground/40",
};

export interface SectionHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3" | "h4";
  tone?: Tone;
  trailing?: React.ReactNode;
}

export function SectionHeading({
  as: Tag = "h2",
  tone = "primary",
  trailing,
  className,
  children,
  ...props
}: SectionHeadingProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <Tag
        className={cn(
          "text-sm font-bold text-foreground/85 flex items-center gap-2 leading-none",
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className={cn("w-1 h-4 rounded-full", TONE[tone])} />
        {children}
      </Tag>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
