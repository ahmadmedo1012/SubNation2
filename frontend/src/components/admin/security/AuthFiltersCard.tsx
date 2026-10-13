import type { AuthTimelineFilters } from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the auth timeline's filter bar (action / success selects). The page
// owns the `filters` atom and its queryKey; the extract takes the value
// + the setFilters callback (the inline `setFilters({ ...filters, ... })`
// closures became the onFiltersChange prop — same event, same payload).
// The 94-C2 (A2 P3-18) label/action lockstep rides ACTION_LABELS via
// the literal <option> copy below (byte-identical).

export function AuthFiltersCard({
  filters,
  onFiltersChange,
}: {
  filters: AuthTimelineFilters;
  onFiltersChange: (next: AuthTimelineFilters) => void;
}) {
  return (
    /* R139 (precision): the resting edge joins the family value (/55 →
       /60). The two raw <select>s stay byte-identical on purpose — the
       admin console has NO shared select family yet (pricing rides a
       /55 muted inset, the product editor a full-border secondary fill),
       so unifying them here would invent one; a dedicated select sweep
       owns that. The labels/id/value/onChange lockstep is untouched. */
    <div className="bg-card border border-border/60 rounded-xl p-4 flex gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="security-f1-11119" className="text-sm font-semibold">
          الإجراء:
        </label>
        <select
          id="security-f1-11119"
          value={filters.action}
          onChange={(e) => onFiltersChange({ ...filters, action: e.target.value })}
          className="px-3 py-1.5 border rounded text-sm"
        >
          <option value="all">الكل</option>
          <option value="login">تسجيل دخول</option>
          <option value="register">تسجيل</option>
          <option value="logout">تسجيل خروج</option>
          <option value="change_password">تغيير كلمة المرور</option>
          <option value="unlink_provider">فصل مزود</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="security-f2-9574" className="text-sm font-semibold">
          الحالة:
        </label>
        <select
          id="security-f2-9574"
          value={filters.success}
          onChange={(e) => onFiltersChange({ ...filters, success: e.target.value })}
          className="px-3 py-1.5 border rounded text-sm"
        >
          <option value="all">الكل</option>
          <option value="true">ناجح</option>
          <option value="false">فاشل</option>
        </select>
      </div>
    </div>
  );
}
