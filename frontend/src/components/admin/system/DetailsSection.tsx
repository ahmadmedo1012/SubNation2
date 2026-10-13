import { ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode } from "react";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the native-<details> collapsible section every advanced-diagnostics
// panel renders through. Title + children flow down as props; the move
// only changes its address, DOM/classes byte-identical.

/**
 * Collapsible section using the native HTML <details> element.
 * - Zero new libraries. No JS state needed; the browser owns open/closed.
 * - Accessible by default (proper aria semantics, keyboard support).
 * - RTL-safe: chevron rotates the same way regardless of writing direction.
 * - Persists expand state inside the React tree across re-renders.
 */
export function DetailsSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    /* R139 (precision): VERIFIED, no change — the collapsible shell every
       advanced-diagnostics panel renders through already rides the r138
       resting register (solid bg-card + border-border/60 + rounded-2xl);
       the nine section panels inherit it, the inner /40 seam is the
       family's card-internal divider, and the native <details> semantics
       (zero JS state) are untouched this round. */
    <details
      open={defaultOpen}
      className="group bg-card border border-border/60 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none"
    >
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
        <span className="text-sm font-bold flex-1 truncate">{title}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
      </summary>
      <div className="px-4 pt-1 pb-4 border-t border-border/40">{children}</div>
    </details>
  );
}
