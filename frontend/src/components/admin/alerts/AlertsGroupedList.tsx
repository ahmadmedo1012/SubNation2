import { CheckCheck, Trash2 } from "lucide-react";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { TYPE_META } from "@/components/admin/alerts/alerts-meta";
import type { AdminAlertItem, AlertType } from "@/components/admin/alerts/alerts-inbox-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the date-grouped inbox body: the اليوم/أمس/هذا الأسبوع/أقدم group
// headers and the alert rows (unread dot, type tile, title + label chip,
// relative time, hover/focus action cluster). The markRead / deleteAlert
// mutations stay in the page — this shell takes the grouped rows down and
// reports taps through onMarkRead(id) / onDelete(alert) (the delete is
// confirm-gated in the page's confirmDeleteAlert); row onClick marks read
// exactly as before. The move only changes its address; DOM, classes,
// aria and Arabic copy are byte-identical.

export function AlertsGroupedList({
  groups,
  onMarkRead,
  onDelete,
}: {
  groups: { label: string; items: AdminAlertItem[] }[];
  onMarkRead: (id: number) => void;
  onDelete: (alert: AdminAlertItem) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          {/* Date group header */}
          <div className="flex items-center gap-3 mb-3">
            {/* 94-C2 (A2 P2-10): uppercase/tracking dropped —
                letter-spacing severs Arabic letter connections
                (A11 §8, rule documented in layout.tsx). */}
            <span className="text-2xs font-bold text-muted-foreground">{group.label}</span>
            {/* R139 (precision): the group rule joins the /20 hairline
                family (the receipt-rhythm value at quiet section
                boundaries — r138-e's card-internal-separator decision);
                /40 was a between-value. */}
            <div className="flex-1 h-px bg-border/20" />
            <span className="text-3xs text-muted-foreground">{group.items.length}</span>
          </div>

          <div className="space-y-1.5">
            {group.items.map((alert) => {
              const meta = TYPE_META[alert.type as AlertType] ?? TYPE_META.system;
              const Icon = meta.icon;
              return (
                <div
                  key={alert.id}
                  onClick={() => !alert.isRead && onMarkRead(alert.id)}
                  /* R125 (A6 B-15): opacity-60 dimmed the read rows'
                     muted message text to ≈3.6:1 dark / 2.7:1 light
                     (1.4.3). No single opacity value passes BOTH
                     themes, so the read-state distinction now rides
                     the row surface alone (bg-card/40 + border/40,
                     no shadow, no hover) — text stays at its
                     token contrast. */
                  /* R139 (precision): the unread row joins the calm
                     queue register — the resting shadow + its hover
                     elevation retire (no row elevation; the hover is
                     the border step /60 → full alone, the topups-card
                     decision), while the read row keeps its quieter
                     /40 surface untouched (the pinned B-15 read/
                     unread distinction rides exactly these fills). */
                  className={`group flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all duration-150 ${
                    alert.isRead
                      ? "bg-card/40 border-border/40 cursor-default"
                      : "bg-card border-border/60 cursor-pointer hover:border-border"
                  }`}
                >
                  {/* Unread dot */}
                  <div className="relative shrink-0 mt-0.5">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.bg}`}
                    >
                      <Icon className={`w-4 h-4 ${meta.color}`} />
                    </div>
                    {!alert.isRead && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background badge-pulse" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm leading-snug ${alert.isRead ? "font-semibold text-foreground/70" : "font-bold"}`}
                      >
                        {alert.title}
                        {/* R125 (A6 B-15): the unread state was
                            color-only (pulse dot + tint) — an
                            sr-only word makes it explicit. */}
                        {!alert.isRead && <span className="sr-only"> — غير مقروء</span>}
                      </span>
                      <span
                        className={`text-3xs px-1.5 py-px rounded-full border shrink-0 ${meta.bg} ${meta.color} ${meta.border}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    {alert.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {alert.message}
                      </p>
                    )}
                    <div className="mt-1">
                      <span
                        className="text-2xs text-muted-foreground"
                        title={formatDate(alert.createdAt)}
                      >
                        {formatRelativeTime(alert.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions — visible on hover (desktop) / always
                      visible on touch: opacity-0 makes them unreachable
                      on phones where there is no hover.
                      R125 (A6 B-2): sm:group-focus-within reveals
                      the cluster when keyboard focus reaches the
                      buttons — they were focusable but invisible
                      through opacity-0 (2.4.7); the hover aesthetic
                      is unchanged. */}
                  <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                    {!alert.isRead && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkRead(alert.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="تعيين كمقروء"
                        aria-label={`تعيين تنبيه «${alert.title}» كمقروء`}
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(alert);
                      }}
                      className="p-1.5 rounded-lg hover:bg-status-error/10 text-muted-foreground hover:text-status-error transition-colors"
                      title="حذف"
                      aria-label={`حذف تنبيه «${alert.title}»`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
