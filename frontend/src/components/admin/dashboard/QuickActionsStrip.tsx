import { Clock, ListOrdered, Plus, Users } from "lucide-react";
import { Link } from "wouter";

// R137 (FE admin decomposition): the quick-actions strip moved verbatim
// from pages/admin/dashboard.tsx — the stats/statsLoading gate and the
// finance scope flow down as values; the CTAs are pure links.

export function QuickActionsStrip({
  canSeeMoney,
  pendingTopups,
}: {
  canSeeMoney: boolean;
  pendingTopups: number;
}) {
  return (
    /* R139 (precision): VERIFIED, no class change — the chips already
       ride the r138 resting register (border-border/60 → hover
       border-border, bg-secondary/60 muted fill, quiet warning /8
       tint for the topups CTA with severity in the count label);
       they sit inside the ambient-wash zone wrapper in the page but
       carry no elevation of their own (the KPI grid is the page's one
       elevated register). */
    <div className="flex flex-wrap items-center gap-2">
      {/* 94-C2 (A2 P2-10): uppercase/tracking dropped — the label
          is Arabic (A11 §8). */}
      <span className="text-3xs text-muted-foreground font-semibold hidden sm:inline">
        إجراءات:
      </span>
      {/* R122 (A1): the four quick-action CTAs were
          <Link><button>…</button></Link> — invalid
          interactive-in-interactive nesting + a doubled tab stop
          (the A4-F1 class; the admin pages escaped that sweep).
          Same fix as the app standard: ONE interactive element —
          the file's own urgent-banner idiom (Link > styled span
          with cursor-pointer). R122 (A2-P2): the topups CTA is
          additionally finance-gated (see canSeeMoney above). */}
      {canSeeMoney && (pendingTopups ?? 0) > 0 && (
        <Link href="/admin/topups">
          <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-warning/8 hover:bg-status-warning/15 border border-status-warning/20 hover:border-status-warning/35 text-status-warning transition-all duration-150 font-semibold press-spring cursor-pointer">
            <Clock className="w-3 h-3" /> موافقة الشحن ({pendingTopups})
          </span>
        </Link>
      )}
      <Link href="/admin/orders">
        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
          <ListOrdered className="w-3 h-3" /> الطلبات
        </span>
      </Link>
      <Link href="/admin/products">
        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
          <Plus className="w-3 h-3" /> منتج جديد
        </span>
      </Link>
      <Link href="/admin/users">
        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
          <Users className="w-3 h-3" /> المستخدمون
        </span>
      </Link>
    </div>
  );
}
