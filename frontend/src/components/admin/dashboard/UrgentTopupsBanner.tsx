import { AlertTriangle, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { formatCount } from "@/lib/utils";

// R137 (FE admin decomposition): the urgent pending-topups banner moved
// verbatim from pages/admin/dashboard.tsx — the finance scope gate
// (canSeeMoney) and the pending count stay in the page; the count flows
// down as a value.

export function UrgentTopupsBanner({ pendingTopups }: { pendingTopups: number }) {
  return (
    /* R125-I2 (A6-B4): every raw yellow-400 ink/tint on this banner
       collapses to ~1.4-1.5:1 on the shipped light admin theme —
       the --status-warning token family replaces them (the
       StatusBadge ink — both-theme safe).
       R139 (precision): VERIFIED quiet-danger-at-rest, no class change —
       the /8 surface tint + /20 edge is already the calmest warning
       register r138 pinned for banners (login's primary/8 banners),
       the severity lives in CONTENT (the plural-routed count + the
       «يحتاج إلى موافقة يدوية فورية» reason line — the §6 risk-state
       contract), and the icon stage (warning/15 tile + full-ink glyph)
       carries the one accent. The CTA keeps the warning ink + /30
       border pill at rest (no filled red/amber button). The banner
       also stays FLAT (no elevation) — the KPI grid below is this
       page's one elevated register. */
    <div className="flex items-center justify-between p-4 bg-status-warning/8 border border-status-warning/20 rounded-2xl gap-4 float-in">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-status-warning/15 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4.5 h-4.5 text-status-warning" />
        </div>
        <div>
          <p className="font-bold text-sm text-status-warning">
            {/* B14-5 / A8-F19 (R127-L11, the held site): formatCount
                plural routing — the frozen singular rendered
                «2 طلب شحن بانتظار المراجعة» / «3 طلب شحن…» for the
                dual/plural counts. Same full-noun-phrase idiom as
                wallet.tsx's «قيد المراجعة» banner counter. */}
            {formatCount(pendingTopups, {
              one: "طلب شحن بانتظار المراجعة",
              two: "طلبان شحن بانتظار المراجعة",
              few: "طلبات شحن بانتظار المراجعة",
              many: "طلباً شحن بانتظار المراجعة",
              other: "طلب شحن بانتظار المراجعة",
            })}
          </p>
          <p className="text-xs text-muted-foreground">يحتاج إلى موافقة يدوية فورية</p>
        </div>
      </div>
      <Link href="/admin/topups">
        <span className="shrink-0 text-xs font-bold text-status-warning border border-status-warning/30 px-3 py-1.5 rounded-xl hover:bg-status-warning/10 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />
          مراجعة الكل
        </span>
      </Link>
    </div>
  );
}
