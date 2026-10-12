import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { LEVEL_META, type RiskEventRow } from "@/components/admin/risk/risk-meta";
import { Link } from "wouter";

// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the desktop fraud-queue table (sticky-glass thead, semibold th,
// border-b zebra rows, the whole-row drill-in anchor). The events pages
// (the accumulating infinite query) stay in the page — this shell takes
// the flattened rows DOWN; the per-row tone/userLabel derivations are
// row-local and ride along verbatim. The move only changes its address;
// DOM, classes, aria and Arabic copy are byte-identical.

export function RiskEventsTable({ events }: { events: RiskEventRow[] }) {
  return (
    <>
      {/* Canonical admin table chrome + horizontal scroll on mobile —
                previously a bespoke border-border/40 bg-card/60 card with
                no overflow handling (7 columns crushed at 375px). */}
      <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead
              /* R128 (A3-F2): the fraud queue is the longest-scanned
                       table without the sticky-glass header — adopt the
                       orders/users money-directory recipe (sticky glass
                       thead, semibold th, border-b rows, one zebra value). */
              className="sticky top-0 z-10 text-xs text-muted-foreground bg-card/85 backdrop-blur-md border-b border-border"
            >
              <tr>
                {/* 96-F7 (R96 A6 #15 + #6): scope="col" for screen
                          readers; dates pinned to -u-nu-latn so engines
                          without ar-LY data never emit Arabic-Indic
                          numerals. */}
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  المستوى
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  النوع
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  المستخدم
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  القاعدة
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  النقاط
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  الإجراء
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  الوقت
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const tone = LEVEL_META[e.level];
                const userLabel =
                  e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                return (
                  <tr
                    key={e.id}
                    className={`relative border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer ${
                      i % 2 !== 0 ? "bg-muted/[0.035]" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <StatusBadge variant={tone.tone} size="xs">
                        {tone.label}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{e.event_type}</td>
                    <td className="px-4 py-2.5 text-xs">{userLabel}</td>
                    <td className="px-4 py-2.5 text-2xs text-muted-foreground">
                      {e.rule_fired.slice(0, 2).join(", ") || "—"}
                      {e.rule_fired.length > 2 && ` +${e.rule_fired.length - 2}`}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{e.score}</td>
                    <td className="px-4 py-2.5 text-2xs text-muted-foreground">{e.action_taken}</td>
                    <td className="px-4 py-2.5 text-2xs text-muted-foreground whitespace-nowrap">
                      {/* R125-I4 (A3-10): the whole row navigates —
                                the date cell's anchor stretches over the
                                row (after:inset-0 against the relative
                                tr), so the drill-in target is the entire
                                row, not a small date link in the last
                                column. Real anchor semantics + keyboard
                                access stay (single tab stop per row, the
                                docblock's "click a row" is finally true
                                on desktop). */}
                      <Link
                        href={`/admin/risk/events/${e.id}`}
                        aria-label={`فتح تحقيق الحدث رقم ${e.id}`}
                        className="text-primary-text hover:underline after:absolute after:inset-0 after:content-['']"
                      >
                        {formatDate(e.created_at)}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
