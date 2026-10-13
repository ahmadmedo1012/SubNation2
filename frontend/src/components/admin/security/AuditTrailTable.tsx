import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  auditActionLabel,
  auditMetadataLine,
  AUDIT_ACTOR_TYPE_LABELS,
  type AdminAuditLog,
} from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the audit tab's loaded branch: the accountability table (R128 B3-F4
// bidi-isolated @username cell, the B11-F1 metadata attribution line,
// the Arabic action map + raw stable string) and the finite pager over
// the frozen ?page=&limit= contract. The page owns the auditQuery, the
// auditPage atom and the queryKey the pager flips; the extract takes
// values + the setAuditPage setter (the functional updater
// `setAuditPage((p) => …)` rides down verbatim — same atom, same math)
// and the isFetching flag (was `auditQuery.isFetching` inline).

export function AuditTrailTable({
  auditLogs,
  auditPage,
  setAuditPage,
  auditHasMore,
  isFetching,
}: {
  auditLogs: AdminAuditLog[];
  auditPage: number;
  setAuditPage: Dispatch<SetStateAction<number>>;
  auditHasMore: boolean;
  isFetching: boolean;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        {/* R-140-l (semantics): Arabic aria-label mirrors the tab's
            visible h2 («سجل إجراءات المسؤولين») — the accountability
            artifact announces its subject instead of a bare «جدول»;
            scope="col" already rode every th. Read-only rows (no row
            handlers, no sort, no selection) — nothing else to name. */}
        <table aria-label="سجل إجراءات المسؤولين" className="w-full text-sm">
          <thead>
            <tr
              /* R139 (precision): the header band joins the table register
                 (the UsersDesktopTable / OrdersTable idiom) — a solid
                 bg-muted/30 quiet band + the /60 seam; th cells already
                 ride font-semibold + muted ink. */
              className="text-right text-xs text-muted-foreground border-b border-border/60 bg-muted/30"
            >
              <th scope="col" className="py-2 px-3 font-semibold">
                المسؤول
              </th>
              <th scope="col" className="py-2 px-3 font-semibold">
                الإجراء
              </th>
              <th scope="col" className="py-2 px-3 font-semibold">
                الهدف
              </th>
              <th scope="col" className="py-2 px-3 font-semibold">
                IP
              </th>
              <th scope="col" className="py-2 px-3 font-semibold">
                الوقت
              </th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log) => (
              /* R139 (precision): row seams step /30→/60 — one hairline
                 rhythm per table (matching the header seam above; the
                 139-e row register). No hover wash is ADDED here: the
                 audit rows are read-only accountability lines (no row
                 handler, no expansion) — a hover affordance would promise
                 interactivity this table never had. */
              <tr key={log.id} className="border-b border-border/60 align-top">
                <td className="py-2.5 px-3">
                  {/* R128 (B3-F4): the @username attribution is
                                  admin/webhook-controlled text that
                                  rendered with inherited RTL direction —
                                  a username carrying RLO/LRO bidi
                                  controls visually reorders WHO approved
                                  WHAT in the accountability artifact this
                                  tab exists for. dir="ltr" implies
                                  unicode-bidi: isolate (mirrors the
                                  metadata/action/target/ip cells around
                                  it); applied to the username branch only
                                  — the fallback branches render local
                                  Arabic labels. truncate + the metadata
                                  line's max-w keep a long username from
                                  blowing the column. */}
                  <div
                    dir={log.actorUsername ? "ltr" : undefined}
                    className="font-semibold max-w-[240px] truncate"
                  >
                    {log.actorUsername
                      ? `@${log.actorUsername}`
                      : log.actorId !== null
                        ? `${AUDIT_ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType} #${log.actorId}`
                        : (AUDIT_ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType)}
                  </div>
                  {/* B11-F1 attribution: the metadata line
                                  names the telegram actor / source the
                                  actorId column can't. */}
                  {auditMetadataLine(log.metadata) && (
                    <div
                      dir="ltr"
                      className="text-3xs text-muted-foreground mt-0.5 max-w-[240px] truncate"
                    >
                      {auditMetadataLine(log.metadata)}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-3 font-semibold">
                  {auditActionLabel(log.action)}
                  <div dir="ltr" className="text-3xs text-muted-foreground mt-0.5">
                    {log.action}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground" dir="ltr">
                  {log.targetType
                    ? `${log.targetType}${log.targetId !== null ? ` #${log.targetId}` : ""}`
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground" dir="ltr">
                  {log.ip ?? "—"}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                  {formatDate(log.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Finite pager over the frozen page/limit contract
                      (hasMore is the server's honest flag). */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-muted-foreground">الصفحة {auditPage}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={auditPage <= 1 || isFetching}
            onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
          >
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
            السابقة
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!auditHasMore || isFetching}
            onClick={() => setAuditPage((p) => p + 1)}
          >
            التالية
            <ChevronLeft className="w-3.5 h-3.5 mr-1" />
          </Button>
        </div>
      </div>
    </>
  );
}
