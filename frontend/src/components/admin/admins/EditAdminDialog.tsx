import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, CheckCircle, Loader2, Lock } from "lucide-react";
import { AdminDialogShell } from "@/components/admin/admins/AdminDialogShell";
import { ScopeCheckboxGrid } from "@/components/admin/admins/ScopeCheckboxGrid";
import { type AdminAccount, type ScopeOption } from "@/components/admin/admins/admins-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the edit-admin dialog shell (display name / the super-admin lock
// branch vs the scope grid / the credentials note / submit). EVERYTHING
// that mutates stays in the page — the display-name + selected-scopes
// atoms + the busy flag live there (openEdit re-seeds exactly the
// mount-scoped useState initializers the dialog component had); the
// permission-save PATCH fires only through the page-owned onSubmit
// callback — the page's submit keeps the super-admin ["all"] invariant.
// The move only changes its address; DOM, classes, ids and Arabic copy
// are byte-identical.

export function EditAdminDialog({
  admin,
  scopes,
  isSuper,
  displayName,
  setDisplayName,
  selectedScopes,
  toggleScope,
  saving,
  onRetryScopes,
  onClose,
  onSubmit,
}: {
  admin: AdminAccount;
  scopes: ScopeOption[];
  /** (admin.permissions ?? []).includes("all") — derived in the page
   *  (the submit's ["all"] preservation + the dirty guard share it). */
  isSuper: boolean;
  displayName: string;
  setDisplayName: Dispatch<SetStateAction<string>>;
  selectedScopes: string[];
  toggleScope: (id: string) => void;
  saving: boolean;
  /** R125-I5 (A3-9): same retry affordance as the create dialog. */
  onRetryScopes: () => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <AdminDialogShell title={`تعديل: @${admin.username}`} onClose={onClose} busy={saving}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="admins-f5-17484" className="text-xs font-bold mb-1 block">
            الاسم الظاهر
          </label>
          <input
            id="admins-f5-17484"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label className="text-xs font-bold mb-1 block">الصلاحيات</label>
          {isSuper ? (
            <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs">
              <Lock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                هذا الحساب يملك جميع الصلاحيات (مسؤول رئيسي). لتعديلها، أزل صلاحية{" "}
                <code className="font-mono">all</code> أولاً عبر قاعدة البيانات.
              </div>
            </div>
          ) : (
            <ScopeCheckboxGrid
              scopes={scopes}
              selected={selectedScopes}
              onToggle={toggleScope}
              onRetry={onRetryScopes}
            />
          )}
        </div>
        <div className="flex items-start gap-2 p-2.5 bg-muted/20 border border-border/50 rounded-lg text-2xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          لتغيير اسم المستخدم أو كلمة المرور لهذا الحساب، يجب أن يقوم المسؤول نفسه بذلك من صفحة
          "حسابي".
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle className="w-3.5 h-3.5" />
            )}
            حفظ
          </button>
        </div>
      </form>
    </AdminDialogShell>
  );
}
