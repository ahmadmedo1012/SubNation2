import { Bell } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «الإشعارات» tab pane (the R120-B4 A2-F5 descriptive info panel: the
// fixed server-side notification set — no per-event switches). Zero props:
// the pane is fully static; the tab visibility gate (activeTab) stays in
// the page's pane conditional. The move only changes its address; DOM,
// roles, classes and Arabic copy are byte-identical.

export function NotificationsTabPanel() {
  return (
    <div
      role="tabpanel"
      aria-labelledby="settings-tab-notifications"
      className="bg-card border border-border/60 rounded-2xl p-6 float-in"
    >
      <h2 className="font-bold mb-1 text-sm">الأحداث التي يتم إشعارك بها</h2>
      {/* R120-B4 (A2-F5): descriptive info panel — the old rows
          rendered a green CheckCircle per event, which read as a
          CONFIGURABLE per-event switch that never was (the
          notification set is fixed server-side). No check icons,
          no per-row status semantics. */}
      <p className="text-xs text-muted-foreground mb-4">
        قائمة إعلامية ثابتة — تُرسل إشعارات تيليجرام للمشرفين عند كل حدث مما يلي
      </p>
      <div className="space-y-2">
        {[
          "تسجيل مستخدم جديد",
          "طلب شحن محفظة جديد",
          "موافقة على طلب شحن",
          "رفض طلب شحن",
          "إتمام طلب شراء جديد",
        ].map((event) => (
          /* R139 (precision): VERIFIED, no change — the fixed-event rows
             keep the R120-B4 descriptive register (no per-row status
             semantics) on the quiet bg-muted/20 + border-border/50
             inset-box family this lane's info rows share. */
          <div
            key={event}
            className="flex items-center gap-3 px-4 py-3 bg-muted/20 border border-border/50 rounded-2xl"
          >
            <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm">{event}</span>
            <span className="mr-auto text-xs text-muted-foreground">عبر تيليجرام</span>
          </div>
        ))}
      </div>
    </div>
  );
}
