import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Trust card — the icon + title + description tiles that close the
 * homepage ("تسليم فوري / دفع آمن / دعم 24/7"). Centralizes the
 * icon-bubble + bordered tinted surface treatment so future sections
 * (loyalty perks, referral benefits) reuse the same shape.
 *
 * `tone` maps to status tokens (success / warning / info) so the
 * tile responds to theme changes — the previous in-place version
 * hard-coded `text-yellow-400` etc., which read OK in dark mode but
 * looked washed-out on the light theme.
 */
type Tone = "success" | "warning" | "info" | "primary";

const TONE_FG: Record<Tone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  info: "text-status-info",
  primary: "text-primary-text",
};

const TONE_BG: Record<Tone, string> = {
  success: "bg-status-success/8 border-status-success/18",
  warning: "bg-status-warning/8 border-status-warning/18",
  info: "bg-status-info/8 border-status-info/18",
  primary: "bg-primary/8 border-primary/18",
};

export interface TrustCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: Tone;
}

export function TrustCard({
  icon: Icon,
  title,
  description,
  tone = "primary",
  className,
  ...props
}: TrustCardProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-2xl border transition-shadow duration-300",
        "hover:shadow-md hover:shadow-black/15",
        TONE_BG[tone],
        className,
      )}
      {...props}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-background/45 border border-border/30">
        <Icon className={cn("w-4 h-4", TONE_FG[tone])} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="font-bold text-sm mb-0.5">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
