import type { AuditFilterDraft } from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the audit tab's filter bar (B15-1: action / actor / date range). The
// page owns the `auditFilters` draft, the 300 ms action debounce and
// the setAuditFilter pager-reset wrapper; the extract takes the value +
// the onFilterChange patch callback (the inline setAuditFilter({...})
// closures became the prop — same event, same patch, same reset).

export function AuditFiltersCard({
  auditFilters,
  onFilterChange,
}: {
  auditFilters: AuditFilterDraft;
  onFilterChange: (patch: Partial<AuditFilterDraft>) => void;
}) {
  return (
    <div className="bg-card border border-border/55 rounded-xl p-4 flex gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="audit-action-filter" className="text-sm font-semibold">
          الإجراء:
        </label>
        <input
          id="audit-action-filter"
          type="text"
          value={auditFilters.action}
          onChange={(e) => onFilterChange({ action: e.target.value })}
          placeholder="topup.approve"
          dir="ltr"
          className="px-3 py-1.5 border rounded text-sm w-48"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="audit-actor-filter" className="text-sm font-semibold">
          معرّف المسؤول:
        </label>
        <input
          id="audit-actor-filter"
          type="number"
          min={1}
          value={auditFilters.actor}
          onChange={(e) => onFilterChange({ actor: e.target.value })}
          placeholder="مثال: 1"
          dir="ltr"
          className="px-3 py-1.5 border rounded text-sm w-28"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="audit-start-date" className="text-sm font-semibold">
          من تاريخ:
        </label>
        <input
          id="audit-start-date"
          type="date"
          value={auditFilters.startDate}
          onChange={(e) => onFilterChange({ startDate: e.target.value })}
          className="px-3 py-1.5 border rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="audit-end-date" className="text-sm font-semibold">
          إلى تاريخ:
        </label>
        <input
          id="audit-end-date"
          type="date"
          value={auditFilters.endDate}
          onChange={(e) => onFilterChange({ endDate: e.target.value })}
          className="px-3 py-1.5 border rounded text-sm"
        />
      </div>
    </div>
  );
}
