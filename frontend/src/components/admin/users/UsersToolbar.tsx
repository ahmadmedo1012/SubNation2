import { Download, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount, tierLabel } from "@/lib/utils";
import { USER_COUNT_FORMS } from "@/components/admin/users/user-directory-meta";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the directory header: the honest-count title block, the ?search=
// deep-link box, the URL-synced filter toggle and the CSV export button.
// The search/filter atoms stay centralized in the page — values flow
// down, and every control calls a page-owned callback (onSearchChange /
// onToggleFilters / onExport — the toggle and the export run the page's
// handlers that write the ?filters= param and build the CSV). The move
// only changes its address; DOM, classes and aria are byte-identical.

export function UsersToolbar({
  usersCount,
  knownTotal,
  tierFilter,
  search,
  showFilters,
  hasFilters,
  showExport,
  onSearchChange,
  onToggleFilters,
  onExport,
}: {
  usersCount: number;
  knownTotal: boolean;
  tierFilter: string;
  search: string;
  showFilters: boolean;
  hasFilters: boolean;
  showExport: boolean;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold mb-0.5">المستخدمون</h1>
        {/* 94-C2 (A2 P1-1): honest count — the directory no longer
            claims a grand total it can't know once pages are capped. */}
        <p className="text-xs text-muted-foreground">
          {usersCount > 0
            ? `${knownTotal ? "" : "عرض "}${formatCount(usersCount, USER_COUNT_FORMS)}${knownTotal ? "" : " (الأحدث أولاً)"}`
            : "إدارة حسابات المستخدمين"}
          {tierFilter && ` · فلتر: ${tierLabel(tierFilter)}`}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
        <div className="relative flex-1 sm:flex-none">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="بحث برقم الهاتف..."
            aria-label="بحث برقم الهاتف"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-9 h-9 w-full sm:w-56 text-sm"
            dir="ltr"
          />
        </div>
        <button
          onClick={onToggleFilters}
          aria-expanded={showFilters}
          /* R139 (precision): the filter toggle joins the r138 calm-pill
             dialect — active bg-primary/15 + text-primary-text +
             border-primary/30 + font-bold (the /15 tint, not the older
             /10), resting a bg-muted/30 box with the /30 border BOTH
             states carry (kills the 1px toggle jitter the borderless
             secondary wash caused). The ProductsToolbar chip row shape:
             a standalone pill owns its border box. aria-expanded is
             byte-identical. */
          className={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-semibold transition-all ${
            hasFilters || showFilters
              ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
              : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          فلترة
          {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>
        {/* R139 (precision): verified canonical — the CSV export already
            rides the shared Button (size="sm" variant="outline", h-9 ≥ the
            24px admin edge floor); no hand-rolled shadow/fill to retire.
            The search box rides the shared Input family. */}
        {showExport && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onExport}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">تصدير CSV</span>
          </Button>
        )}
      </div>
    </div>
  );
}
