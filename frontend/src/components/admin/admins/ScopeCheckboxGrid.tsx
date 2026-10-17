import { CheckCircle, XCircle } from "lucide-react";
import { type ScopeOption } from "@/components/admin/admins/admins-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the RBAC scope checkbox grid both dialogs render (real buttons with
// role="checkbox"/aria-checked — the R123 E3 P3b contract). The selected
// set is a page-owned atom that flows down; taps report through
// onToggle, and the failed-catalog branch re-fires the page's scopes
// fetch through onRetry (R125-I5 A3-9). The move only changes its
// address; DOM, classes, roles and Arabic copy are byte-identical.

export function ScopeCheckboxGrid({
  scopes,
  selected,
  onToggle,
  onRetry,
}: {
  scopes: ScopeOption[];
  selected: string[];
  onToggle: (id: string) => void;
  /** R125-I5 (A3-9): retry affordance for a failed catalog load — the
   * bare error line had no way forward, so
   * granting any scope dead-ended inside the dialog. */
  onRetry?: () => void;
}) {
  if (scopes.length === 0) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/20 rounded-lg border border-border/50"
      >
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        {/* R125-I5 (A3-9): تعذّر (with shadda) — the A2-F21 standard the
            rest of the console copy uses. */}
        <span>تعذّر تحميل قائمة الصلاحيات.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-bold text-primary-text underline underline-offset-2 hover:opacity-80"
          >
            إعادة المحاولة
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {scopes.map((scope) => {
        const checked = selected.includes(scope.id);
        return (
          <button
            type="button"
            key={scope.id}
            onClick={() => onToggle(scope.id)}
            // R123 (E3 P3b): the visual checkbox is a real button —
            // role/aria-checked expose the checked state to screen
            // readers (the checkbox role's Space activation rides the
            // button's native keyboard handling).
            role="checkbox"
            aria-checked={checked}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-start text-sm border transition-colors ${
              /* R139 (precision): the checked tile joins the calm selected
                 tint (the pill trio — bg-primary/15 + border-primary/30;
                 the old /10 fill + /40 edge was the louder pre-r138 pair).
                 role="checkbox"/aria-checked + the label weight ride
                 byte-identical; the inner checkbox square is untouched. */
              checked
                ? "bg-primary/15 border-primary/30 text-foreground"
                : "bg-background border-border/60 text-muted-foreground hover:border-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                checked ? "bg-primary border-primary" : "border-border"
              }`}
            >
              {checked && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
            </div>
            <span className="font-bold">{scope.label}</span>
          </button>
        );
      })}
    </div>
  );
}
