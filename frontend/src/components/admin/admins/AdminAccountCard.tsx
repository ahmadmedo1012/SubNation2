import { ShieldCheck } from "lucide-react";
import { type AdminAccount, type ScopeOption } from "@/components/admin/admins/admins-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// one RBAC account card: the shield avatar tile, the identity row with
// its أنت/معطّل/2FA chips, the enable/disable + edit actions, and the
// granted-scope chip footer (with the super-admin wildcard branch). The
// toggle POST + the edit-dialog opener stay in the page — this shell
// takes the row, the isMe flag, the scope catalog down and reports taps
// through onToggleActive/onEdit (page-owned callbacks; the disable/
// enable is confirm-gated in the page). The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

export function AdminAccountCard({
  admin,
  isMe,
  scopes,
  onEdit,
  onToggleActive,
}: {
  admin: AdminAccount;
  /** admin.id === currentAdminId — the page's session identity. */
  isMe: boolean;
  scopes: ScopeOption[];
  onEdit: (admin: AdminAccount) => void;
  onToggleActive: (admin: AdminAccount) => void;
}) {
  return (
    <div
      className={`bg-card border rounded-2xl p-4 ${
        admin.is_active ? "border-border/60" : "border-status-low-stock/35 opacity-75"
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              admin.is_active ? "bg-primary/10" : "bg-muted"
            }`}
          >
            <ShieldCheck
              className={`w-5 h-5 ${admin.is_active ? "text-primary" : "text-muted-foreground"}`}
            />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-base flex items-center gap-2 flex-wrap">
              {admin.display_name}
              {isMe && (
                /* 94-C2 (A2 P2-10): uppercase dropped on the
                    Arabic badges (A11 §8). */
                /* R126-L5 (A3-4): the «أنت» chip joins the
                    totp/معطّل badge family on text-safe
                    tokens — raw text-primary on the /10
                    tint is 3.56:1 dark (A6-B6). */
                <span className="text-3xs font-bold bg-primary/10 text-primary-text px-1.5 py-0.5 rounded">
                  أنت
                </span>
              )}
              {!admin.is_active && (
                <span className="text-3xs font-bold bg-status-warning/12 text-status-warning border border-status-warning/30 px-1.5 py-0.5 rounded">
                  معطّل
                </span>
              )}
              {admin.totp_enabled && (
                <span className="text-3xs font-bold uppercase bg-status-success/10 text-status-success border border-status-success/25 px-1.5 py-0.5 rounded">
                  2FA
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">@{admin.username}</div>
          </div>
        </div>
        {!isMe && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onEdit(admin)}
              className="px-2.5 py-1 text-xs font-bold border border-border/60 rounded-lg hover:bg-muted/50"
            >
              تعديل
            </button>
            <button
              onClick={() => onToggleActive(admin)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                admin.is_active
                  ? "border-status-low-stock/40 text-status-low-stock hover:bg-status-low-stock/10"
                  : "border-status-success/40 text-status-success hover:bg-status-success/10"
              }`}
            >
              {admin.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-border/40 flex flex-wrap gap-1.5">
        {(admin.permissions ?? []).length === 0 ? (
          <span className="text-xs text-muted-foreground">لا توجد صلاحيات ممنوحة</span>
        ) : (admin.permissions ?? []).includes("all") ? (
          /* R126-L5 (A3-4): same token swap as the «أنت» chip
              above (raw text-primary on the /10 tint is
              3.56:1 dark — A6-B6's figure). */
          <span className="text-3xs font-bold bg-primary/10 text-primary-text border border-primary/20 px-1.5 py-0.5 rounded">
            جميع الصلاحيات (مسؤول رئيسي)
          </span>
        ) : (
          admin.permissions.map((scope) => {
            const label = scopes.find((s) => s.id === scope)?.label ?? scope;
            return (
              <span
                key={scope}
                className="text-3xs font-bold bg-muted/40 text-foreground/75 border border-border/50 px-1.5 py-0.5 rounded"
              >
                {label}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
