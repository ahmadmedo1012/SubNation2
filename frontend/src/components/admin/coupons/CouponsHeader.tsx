import { Button } from "@/components/ui/button";
import { Plus, Tag } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/coupons.tsx —
// the page header (icon tile + h1 + «كوبون جديد» CTA) and the three-stat
// strip (honest R120-B4 total count / active / total uses). The counts
// are page-derived values passed DOWN; the create dialog opens through
// the page-owned onCreate (the form atom + the money-discount create
// POST stay in the page). The move only changes its address; DOM,
// classes and Arabic copy are byte-identical.

export function CouponsHeader({
  couponsCount,
  activeCount,
  totalUsed,
  onCreate,
}: {
  couponsCount: number;
  activeCount: number;
  totalUsed: number;
  onCreate: () => void;
}) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Tag className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">الكوبونات والخصومات</h1>
            <p className="text-xs text-muted-foreground">إنشاء وإدارة أكواد الخصم</p>
          </div>
        </div>
        <Button
          onClick={onCreate}
          className="gap-1.5 text-sm bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 press-spring"
        >
          <Plus className="w-3.5 h-3.5" />
          كوبون جديد
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-1">
          <div className="text-2xl font-bold text-foreground tabular-nums">{couponsCount}</div>
          {/* R120-B4 (A2-F22): honest wording. The list endpoint
              (routes/coupons.ts AUD103-4-F9) caps at 200 newest rows
              with NO page param — «إجمالي الكوبونات» claimed a total
              the payload cannot know once the cap is hit. A short list
              IS the whole set (the total is then true); a full 200-row
              page switches to «عرض N (الأحدث أولاً)». Load-more is not
              trivial against the hand-rolled fetch here (no page
              contract server-side) — wording honesty this round. */}
          <div className="text-xs text-muted-foreground mt-0.5">
            {couponsCount >= 200 ? `عرض ${couponsCount} (الأحدث أولاً)` : "إجمالي الكوبونات"}
          </div>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-2">
          <div className="text-2xl font-bold text-status-success tabular-nums">{activeCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">نشطة</div>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-3">
          <div className="text-2xl font-bold text-primary tabular-nums">{totalUsed}</div>
          <div className="text-xs text-muted-foreground mt-0.5">مرات الاستخدام</div>
        </div>
      </div>
    </>
  );
}
