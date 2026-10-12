import { Button } from "@/components/ui/button";
import { Gift, RefreshCw } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the page header (icon tile + h1 + the «تحديث» refetch CTA). The
// refresh fires through the page-owned onRefresh (the list query, the
// credit POST and every atom stay in the page). The move only changes
// its address; DOM, classes and Arabic copy are byte-identical.

export function ReferralsHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center float-in">
            <Gift className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">برنامج الإحالة</h1>
            <p className="text-xs text-muted-foreground">إدارة ومتابعة إحالات المستخدمين</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onRefresh()}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className="w-3 h-3" />
          تحديث
        </Button>
      </div>
    </>
  );
}
