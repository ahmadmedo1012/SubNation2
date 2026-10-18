import { CheckCheck } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { Notif } from "@/hooks/useNotifications";
import { TYPE_CONFIG } from "./type-config";

// R167 (layout decomposition): extracted verbatim from the list branch
// of NotificationPanel (components/layout/NotificationBell.tsx) — the
// per-notification row: the unread stripe + tint, the row-body button
// (the keyboard/SR open path), the per-type icon chip, the clamped
// dir="auto" message line, the relative timestamp and the action/
// mark-read chip pair. The panel owns the list + tri-state; this row
// takes the notification + the panel's three callbacks and renders.
// The move only changes the markup's address — zero behavior, zero
// copy change (the notification-bell-panel/markread render pins
// follow this surface).

export function NotificationRow({
  n,
  onMarkRead,
  onClose,
  onAction,
}: {
  n: Notif;
  onMarkRead: (id: number) => void;
  onClose: () => void;
  onAction: (n: Notif, href: string) => void;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
  const IconComp = cfg.icon;
  const ActionIconComp = cfg.actionIcon;
  const actionHref = n.link ?? cfg.actionHref;

  return (
    <div
      className={`relative flex flex-col gap-0 px-4 py-3.5 transition-colors duration-150 ${
        !n.is_read ? "bg-primary/[0.03]" : ""
      }`}
    >
      {!n.is_read && (
        /* R124-A3 #12 (refuse rule): colored side stripes on list
           rows stay at 1px — w-0.5 (2px) reduced to the system's
           stripe language; the row tint + pulsing dot still
           carry the unread state. */
        <div className="absolute right-0 top-3 bottom-3 w-px bg-primary/60 rounded-full" />
      )}

      {/* Row body as a real button so keyboard/screen-reader users
          can open the notification (previously a clickable div
          with no focus path). */}
      <button
        type="button"
        className="flex items-start gap-3 text-start cursor-pointer hover:opacity-85 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl -m-1 p-1"
        onClick={() => {
          if (!n.is_read) onMarkRead(n.id);
          if (actionHref) {
            onClose();
            onAction(n, actionHref);
          }
        }}
      >
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${cfg.bg} ${cfg.border}`}
        >
          <IconComp className={`w-3.5 h-3.5 ${cfg.color}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm font-semibold leading-snug ${
                !n.is_read ? "text-foreground" : "text-foreground/75"
              }`}
            >
              {n.title}
            </p>
            {!n.is_read && (
              <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 badge-pulse" />
            )}
          </div>
          {n.message && (
            /* R128-A4 (F-1 cousin): dir="auto" on the clamped
               user-content line — notification bodies mix
               scripts freely (WhatsApp replies, Latin brand
               names), and in the RTL block the line-clamp's
               ellipsis eats a Latin run's beginning. Same
               isolation idiom as the product-name surfaces. */
            <p
              dir="auto"
              className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed"
            >
              {n.message}
            </p>
          )}
          <p className="text-3xs text-muted-foreground mt-1.5 font-semibold">
            {formatRelativeTime(n.created_at)}
          </p>
        </div>
      </button>

      {(actionHref || cfg.actionLabel) && (
        <div className="flex items-center gap-2 mt-2 me-11">
          {actionHref && cfg.actionLabel && (
            <button
              type="button"
              onClick={() => onAction(n, actionHref)}
              className={`flex min-h-11 items-center gap-1.5 text-2xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-150 hover:opacity-80 active:scale-95 ${cfg.bg} ${cfg.border} ${cfg.color}`}
            >
              {cfg.actionLabel}
              {ActionIconComp && <ActionIconComp className="w-3 h-3" />}
            </button>
          )}
          {!n.is_read && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(n.id);
              }}
              className="flex min-h-11 items-center gap-1 text-2xs text-muted-foreground hover:text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/40 transition-all duration-150"
            >
              <CheckCheck className="w-2.5 h-2.5" />
              تحديد كمقروء
            </button>
          )}
        </div>
      )}
    </div>
  );
}
