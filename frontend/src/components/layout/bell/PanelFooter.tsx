import { Link } from "wouter";
import { formatCount } from "@/lib/utils";

// R167 (layout decomposition): extracted verbatim from the footer
// branch of NotificationPanel (components/layout/NotificationBell.tsx)
// — the honest count link to the paged full history (R157) with the
// 40-row cap's «آخر» honesty prefix (A9-2). The cap constant moved
// with it (this footer is its only consumer); the panel keeps the
// {notifs.length > 0} mount guard. The move only changes the footer's
// address — zero behavior, zero copy change (the
// notification-bell-panel footer-count render pins follow this
// surface).

/**
 * A9-2 (R126-L6): the history endpoint's hard cap — backend
 * routes/notifications.ts serves `.limit(40)` with no pagination params,
 * and this bell fetches it verbatim (no load-more). The footer count
 * used to read «40 إشعاراً» as if it were the user's lifetime total;
 * at exactly the cap the honest label is «آخر 40 …» (below the cap the
 * count IS the total — every row the user has is loaded). Full history
 * pagination lives on the /notifications page over ?page= (R128).
 */
const NOTIFICATION_HISTORY_CAP = 40;

export function PanelFooter({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 text-center shrink-0">
      {/* R157: the footer count is now a LINK to the paged full
          history — at the 40-row cap the panel used to be a dead
          end (the full page was reachable only via the drawer). */}
      <Link
        href="/notifications"
        onClick={() => onClose()}
        className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      >
        {/* 93-C8 (A11 §3): Arabic plural paradigm via formatCount.
            A9-2 (R126-L6): at the backend's 40-row cap the count is
            the LOADED slice, not the lifetime total — prefix
            «آخر» so the label never overclaims. */}
        {count >= NOTIFICATION_HISTORY_CAP ? "آخر " : ""}
        {formatCount(count, {
          two: "إشعاران",
          few: "إشعارات",
          many: "إشعاراً",
          other: "إشعار",
        })}
        <span aria-hidden="true">·</span>
        عرض الكل
      </Link>
    </div>
  );
}
