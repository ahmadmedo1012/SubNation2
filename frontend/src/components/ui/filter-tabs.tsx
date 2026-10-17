import { cn } from "@/lib/utils";
import type { ComponentType } from "react";

/**
 * R158-D (ledger b — the R158-C audit's tray/pill census): the shared
 * filter tray/chip primitive.
 *
 * Seven hand-rolled twins spoke one dialect with drifting callback
 * spellings (setStatusFilter / onSelect / onSetFilter / onFilterChange):
 * the five admin trays (topups/tickets/orders/alerts + the tickets
 * category chips — they convert next round, admin lane) and the two
 * non-admin relatives converted here (terms' tab pair + the orders
 * status chips). This primitive is that dialect, extracted:
 *
 *   • pill — `text-xs font-semibold` + `transition-all duration-150` +
 *     `aria-pressed` (the toggle-state idiom every twin already rode);
 *     the r138 calm active trio `bg-primary/15 text-primary-text
 *     border-primary/30 font-bold` / the boxed-transparent inactive
 *     (tray) or the muted-box inactive (chips) — both states carry the
 *     border box so toggling never jitters the 1px edge;
 *   • min-h-11 — the storefront 44px touch floor (DESIGN.md
 *     spacing.touch-target) the terms tabs (R123-E4b P3-f) and the
 *     orders chips (R116-S2 — a mis-tap while scrolling silently
 *     dropped the filter) already enforced. The admin dialect allows
 *     smaller edge buttons but nothing forbids the floor, so the next
 *     round's admin conversions inherit it;
 *   • `variant="tray"` — the segmented wash track
 *     (bg-secondary/40 + border/60 + rounded-2xl + p-1) the four
 *     admin status tabs ride; `variant="chips"` — the tray-less
 *     wrap row (the tickets category-bar + the orders chips);
 *   • `scrollable` adds the family's overflow-x-auto scrollbar-none
 *     rail (the alerts tray's long type list);
 *   • counts — `null` means UNKNOWN and renders nothing (the R126-L3
 *     honesty rule: an inactive tab's server-side window cannot know
 *     its bucket size), 0 hides, and >0 renders per `countBadge`:
 *     "inline" (the quiet muted metadata the topups/orders twins
 *     ride) / "chip" (the alerts micro-chip) / "none";
 *   • `tone` — the status-token active fill (the orders chips'
 *     documented per-bucket colors: pending rides warning, completed
 *     success, the refunded bucket info — R116-S2: a refund is not a
 *     failure). Default "primary" is the family trio.
 *
 * Native buttons + Tailwind only (the audit's ponytail verdict — no
 * library); the page keeps every side effect: the URL write-backs ride
 * page-owned wrappers/effects around `onSelect`.
 */

/** The active-fill tones. "primary" is the family trio; the rest ride
 * the --status-* tokens (never raw Tailwind hues — DESIGN.md). */
export type FilterTabsTone = "primary" | "info" | "warning" | "success" | "error";

const ACTIVE_TONE: Record<FilterTabsTone, string> = {
  primary: "bg-primary/15 text-primary-text border-primary/30",
  info: "bg-status-info/15 text-status-info border-status-info/30",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/30",
  success: "bg-status-success/15 text-status-success border-status-success/30",
  error: "bg-status-error/15 text-status-error border-status-error/30",
};

export interface FilterTabItem<T extends string = string> {
  value: T;
  label: string;
  /** Bucket size. `null` = unknown (renders nothing — the R126-L3
   * honesty rule); `0` hides the badge; `>0` renders per `countBadge`. */
  count?: number | null;
  /** Decorative leading glyph (aria-hidden — the label carries the
   * meaning; lucide's component ref). */
  icon?: ComponentType<{ className?: string }>;
  /** Active-fill tone. Default "primary". */
  tone?: FilterTabsTone;
}

export function FilterTabs<T extends string>({
  items,
  value,
  onSelect,
  variant = "tray",
  scrollable = false,
  countBadge = "inline",
  ariaLabel,
  className,
}: {
  items: FilterTabItem<T>[];
  value: T;
  onSelect: (v: T) => void;
  /** "tray" = the segmented wash track; "chips" = the tray-less wrap row. */
  variant?: "tray" | "chips";
  scrollable?: boolean;
  countBadge?: "inline" | "chip" | "none";
  /** Names the group for assistive tech (role="group" — the toggle
   * buttons inside expose their own aria-pressed state). */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      {...(ariaLabel ? { role: "group", "aria-label": ariaLabel } : {})}
      className={cn(
        variant === "tray"
          ? "flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1"
          : "flex flex-wrap gap-1.5",
        scrollable && "overflow-x-auto scrollbar-none w-fit max-w-full",
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.value;
        const showCount = item.count != null && item.count > 0 && countBadge !== "none";
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onSelect(item.value)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 border",
              active
                ? cn(ACTIVE_TONE[item.tone ?? "primary"], "font-bold")
                : variant === "tray"
                  ? "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60",
            )}
          >
            {Icon ? <Icon className="w-3 h-3" aria-hidden="true" /> : null}
            {item.label}
            {showCount &&
              (countBadge === "chip" ? (
                <span
                  className={cn(
                    "text-3xs font-bold px-1.5 py-px rounded-full",
                    active
                      ? "bg-primary/15 text-primary-text"
                      : "bg-muted/60 text-muted-foreground",
                  )}
                >
                  {item.count}
                </span>
              ) : (
                <span className="text-3xs font-bold text-muted-foreground tabular-nums">
                  {item.count}
                </span>
              ))}
          </button>
        );
      })}
    </div>
  );
}
