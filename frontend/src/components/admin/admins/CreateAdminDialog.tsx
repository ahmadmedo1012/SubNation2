import type { Dispatch, SetStateAction } from "react";
import { Loader2, Plus } from "lucide-react";
import { AdminDialogShell } from "@/components/admin/admins/AdminDialogShell";
import { ScopeCheckboxGrid } from "@/components/admin/admins/ScopeCheckboxGrid";
import { type ScopeOption } from "@/components/admin/admins/admins-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the create-admin dialog shell (username / display name / password /
// scope grid / submit). EVERYTHING that mutates stays in the page — the
// four create-form atoms + the busy flag live there (the users.tsx
// UserEditDialog idiom: the dialog component was mount-scoped, so the
// page's openCreate re-seeds exactly the useState initializers it had);
// the invite POST fires only through the page-owned onSubmit callback.
// The inputs call the page's setters down here; scope taps report
// through toggleScope. The move only changes its
// address; DOM, classes, ids and Arabic copy are byte-identical.

export function CreateAdminDialog({
  scopes,
  username,
  setUsername,
  displayName,
  setDisplayName,
  password,
  setPassword,
  selectedScopes,
  toggleScope,
  saving,
  onRetryScopes,
  onClose,
  onSubmit,
}: {
  scopes: ScopeOption[];
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  displayName: string;
  setDisplayName: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  selectedScopes: string[];
  toggleScope: (id: string) => void;
  saving: boolean;
  /** R125-I5 (A3-9): re-fire the scopes fetch from inside the dialog —
   * a failed catalog load used to be a dead end for granting any
   * scope (the page-level error card renders OUTSIDE the dialog). */
  onRetryScopes: () => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <AdminDialogShell title="إضافة مسؤول جديد" onClose={onClose} busy={saving}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="admins-f1-17486" className="text-xs font-bold mb-1 block">
            اسم المستخدم
          </label>
          <input
            id="admins-f1-17486"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            minLength={3}
            maxLength={100}
            required
          />
        </div>
        <div>
          <label htmlFor="admins-f2-17484" className="text-xs font-bold mb-1 block">
            الاسم الظاهر
          </label>
          <input
            id="admins-f2-17484"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            placeholder="افتراضياً: نفس اسم المستخدم"
          />
        </div>
        <div>
          <label htmlFor="admins-f3-15951" className="text-xs font-bold mb-1 block">
            كلمة المرور
          </label>
          <input
            id="admins-f3-15951"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            minLength={8}
            required
            autoComplete="new-password"
          />
          <p className="text-3xs text-muted-foreground mt-1">
            8 أحرف على الأقل. سيتمكن المسؤول من تغييرها لاحقاً وتفعيل المصادقة الثنائية.
          </p>
        </div>
        <div>
          <label className="text-xs font-bold mb-1 block">الصلاحيات</label>
          <ScopeCheckboxGrid
            scopes={scopes}
            selected={selectedScopes}
            onToggle={toggleScope}
            onRetry={onRetryScopes}
          />
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
              <Plus className="w-3.5 h-3.5" />
            )}
            إنشاء
          </button>
        </div>
      </form>
    </AdminDialogShell>
  );
}
