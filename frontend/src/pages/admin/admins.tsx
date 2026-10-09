import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
// R125-I5 (A3-4b): the bare spinner row adopts the shared TableSkeleton
// (role="status" + sr-only «جارٍ التحميل…» ride along) — the accounts
// list keeps its shape during first load like every other console list.
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// R124-I5 (A6 F13): the shared empty-state card — admins was the only
// list page left with a bare text line (visual weight drifted from
// every other console list: no icon tile, no card, no border).
import { EmptyState } from "@/components/admin/EmptyState";
// 94-C2 (A2 P2-6): the create/edit admin shells migrate from the
// hand-rolled overlay (unguarded backdrop, no ESC/aria/focus-trap) to
// the shared AppDialog — dismissable while busy is false keeps the
// form alive while the POST/PATCH runs.
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
// R123 (E3 item 1): the four raw fetches ride the session-aware
// wrappers — the inline isAdminUnauthorized checks fold into
// adminFetch's AdminSessionExpiredError sentinel, and adminFetchJson
// owns the ok-guard + safe error-body parse the hand-rolled copies
// had. /api/admin/session stays raw-handler-exempt by design (App.tsx
// owns its 401) — the wrapper only acts on it via non-OK errors.
import { AdminSessionExpiredError, adminFetch, adminFetchJson } from "@/lib/admin-session";
// R123 (E3 P3c): the create/edit dialogs' dirty guards (below).
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

interface AdminAccount {
  id: number;
  username: string;
  display_name: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  totp_enabled: boolean;
  created_at?: string;
}

interface ScopeOption {
  id: string;
  label: string;
}

export default function AdminAdminsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);
  // 93-C6 / F-07 (A5 AD-1): the failed load previously toasted and
  // still fell through to the "لا توجد حسابات مسؤولين بعد." empty
  // state — an RBAC/500/401 failure masqueraded as "no accounts".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [currentAdminId, setCurrentAdminId] = useState<number | null>(null);

  // 93-C6 / F-07 (A5 A-3 drift): the hand-built
  // `{ "Content-Type", Authorization: Bearer-or-empty }` map is the
  // exact anti-pattern useAdminHeaders was created to remove (empty
  // Bearer when logged out; cookie-first reads made it harmless but
  // inconsistent). The shared hook also mirrors the session state for
  // the global 401 handler — this page's raw fetches need that.
  const headers = useAdminHeaders({ json: true });

  const reload = async () => {
    try {
      const [listRes, scopesRes, sessionRes] = await Promise.all([
        adminFetch("/api/admin/admins", { credentials: "include", headers }),
        adminFetch("/api/admin/admins/scopes", { credentials: "include", headers }),
        adminFetch("/api/admin/session", { credentials: "include", headers }),
      ]);
      if (!listRes.ok) {
        const body = (await listRes.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        // 93-C6 / F-07: parse the envelope — the raw "فشل في جلب
        // المسؤولين" hid RBAC (صلاحياتك غير كافية) and rate-limit
        // reasons the backend already sends in Arabic.
        throw new Error(getErrorMessage(body) || "فشل في جلب المسؤولين");
      }
      const listJson = (await listRes.json()) as AdminAccount[];
      const scopesJson = scopesRes.ok ? await scopesRes.json() : { scopes: [] };
      const sessionJson = sessionRes.ok ? await sessionRes.json() : null;
      setAdmins(listJson);
      setScopes(scopesJson.scopes ?? []);
      setCurrentAdminId(sessionJson?.id ?? null);
      setLoadError(null);
    } catch (err) {
      // 93-C6 / F-07 (A5 S-3): expired session → the wrapper already
      // toasted + redirected; not a "failed load" card.
      if (err instanceof AdminSessionExpiredError) return;
      const message = getErrorMessage(err);
      setLoadError(message);
      toast({
        title: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // R125-I5 (A3-9): scopes-only refetch for the dialogs' retry affordance
  // — the catalog is a single small GET; re-pulling the accounts list
  // too would blank-then-restore rows for no reason. A failure leaves
  // `scopes` empty, which is exactly the state the grid's error + retry
  // UI renders on.
  const loadScopes = async () => {
    try {
      const res = await adminFetch("/api/admin/admins/scopes", { credentials: "include", headers });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { scopes?: ScopeOption[] };
      setScopes(Array.isArray(json.scopes) ? json.scopes : []);
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // Scope grid stays on its error + retry state (scopes unchanged).
    }
  };

  useEffect(() => {
    // 93-C6 / F-07 (A5 S-8/AD-1): standard guard — a logged-out visit
    // bounced to login instead of rendering an error banner.
    if (!adminToken) {
      navigate("/admin/login");
      return;
    }
    void reload();
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  const handleToggleActive = async (admin: AdminAccount) => {
    const action = admin.is_active ? "disable" : "enable";
    const verb = admin.is_active ? "تعطيل" : "تفعيل";
    const ok = await confirm({
      title: `${verb} المسؤول؟`,
      description: `سيتم ${verb} الحساب @${admin.username}.${
        admin.is_active ? " ستنتهي جلساته الحالية فوراً." : ""
      }`,
      confirmLabel: verb,
      destructive: admin.is_active,
    });
    if (!ok) return;
    try {
      await adminFetchJson(`/api/admin/admins/${admin.id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers,
      });
      // R124-I5 (A6 F1): success variant — completes the console-wide
      // unification (every action-success toast is green).
      toast({ title: `تم ${verb} المسؤول @${admin.username}`, variant: "success" });
      void reload();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل العملية",
        variant: "destructive",
      });
    }
  };

  return (
    <AdminLayout onRefresh={reload}>
      <div className="space-y-5 max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold mb-0.5">إدارة المسؤولين</h1>
            <p className="text-muted-foreground text-sm">
              إنشاء وإدارة حسابات المسؤولين وصلاحياتهم
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-sm hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة مسؤول
          </button>
        </div>

        {loading ? (
          // R125-I5 (A3-4b): shared table skeleton — the bare spinner row
          // was the last unshaped list loader in the console. Cell shapes
          // mirror the account cards (avatar tile / identity / actions /
          // scope chips).
          <TableSkeleton rows={4} cells={["w-10 rounded-lg", "flex-1 w-40", "w-20", "w-16"]} />
        ) : loadError ? (
          /* 93-C6 / F-07 (A5 AD-1): a failed load is NOT "no accounts" —
             referrals.tsx error-card idiom. */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل المسؤولين"
            description={loadError}
            onRetry={() => reload()}
          />
        ) : admins.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="لا توجد حسابات مسؤولين بعد"
            description="أنشئ أول حساب لتفويض عضو فريق آخر بالوصول إلى لوحة الإدارة"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {admins.map((admin) => {
              const isMe = admin.id === currentAdminId;
              return (
                <div
                  key={admin.id}
                  className={`bg-card border rounded-2xl p-4 ${
                    admin.is_active ? "border-border/60" : "border-orange-500/35 opacity-75"
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
                          onClick={() => setEditing(admin)}
                          className="px-2.5 py-1 text-xs font-bold border border-border/60 rounded-lg hover:bg-muted/50"
                        >
                          تعديل
                        </button>
                        <button
                          onClick={() => handleToggleActive(admin)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                            admin.is_active
                              ? "border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                              : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
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
            })}
          </div>
        )}
      </div>

      {creating && (
        <CreateAdminDialog
          scopes={scopes}
          onRetryScopes={() => void loadScopes()}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
          headers={headers}
        />
      )}

      {editing && (
        <EditAdminDialog
          admin={editing}
          scopes={scopes}
          onRetryScopes={() => void loadScopes()}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          headers={headers}
        />
      )}
      <ConfirmDialog />
    </AdminLayout>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateAdminDialog({
  scopes,
  onRetryScopes,
  onClose,
  onCreated,
  headers,
}: {
  scopes: ScopeOption[];
  /** R125-I5 (A3-9): re-fire the scopes fetch from inside the dialog —
   * a failed catalog load used to be a dead end for granting any
   * scope (the page-level error card renders OUTSIDE the dialog). */
  onRetryScopes: () => void;
  onClose: () => void;
  onCreated: () => void;
  headers: Record<string, string>;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // R123 (E3 P3c): a half-filled admin-creation form (password + scopes)
  // is un-submitted work — the same beforeunload guard the other long
  // admin forms ride.
  useDirtyGuard(
    username.trim() !== "" ||
      displayName.trim() !== "" ||
      password !== "" ||
      selectedScopes.length > 0,
  );

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetchJson(
        "/api/admin/admins",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            username: username.trim(),
            password,
            display_name: displayName.trim() || username.trim(),
            permissions: selectedScopes,
          }),
        },
        { fallbackError: "فشل الإنشاء" },
      );
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم إنشاء حساب المسؤول", variant: "success" });
      onCreated();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل الإنشاء",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title="إضافة مسؤول جديد" onClose={onClose} busy={saving}>
      <form onSubmit={submit} className="space-y-3">
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
    </DialogShell>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditAdminDialog({
  admin,
  scopes,
  onRetryScopes,
  onClose,
  onSaved,
  headers,
}: {
  admin: AdminAccount;
  scopes: ScopeOption[];
  /** R125-I5 (A3-9): same retry affordance as the create dialog. */
  onRetryScopes: () => void;
  onClose: () => void;
  onSaved: () => void;
  headers: Record<string, string>;
}) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(admin.display_name);
  // Only operate on the granular scope set when the admin doesn't have
  // the wildcard "all" — preserve the super-admin invariant.
  const isSuper = (admin.permissions ?? []).includes("all");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    isSuper ? [] : (admin.permissions ?? []),
  );
  const [saving, setSaving] = useState(false);

  // R123 (E3 P3c): the edit dialog's dirty guard — compares against the
  // admin's CURRENT persisted values (super-admins have no editable
  // scope set, so display-name is their only dirty axis).
  const initialScopes = isSuper ? [] : (admin.permissions ?? []);
  useDirtyGuard(
    displayName.trim() !== admin.display_name.trim() ||
      (!isSuper &&
        (selectedScopes.length !== initialScopes.length ||
          selectedScopes.some((s) => !initialScopes.includes(s)))),
  );

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuper && selectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetchJson(
        `/api/admin/admins/${admin.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers,
          body: JSON.stringify({
            display_name: displayName.trim(),
            permissions: isSuper ? ["all"] : selectedScopes,
          }),
        },
        { fallbackError: "فشل التحديث" },
      );
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم تحديث الحساب", variant: "success" });
      onSaved();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل التحديث",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title={`تعديل: @${admin.username}`} onClose={onClose} busy={saving}>
      <form onSubmit={submit} className="space-y-3">
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
    </DialogShell>
  );
}

// ── Shared dialog shell + scope grid ──────────────────────────────────────────

function DialogShell({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 94-C2 (A2 P2-6): while a save is in flight the dialog is NOT
   * dismissable (ESC / backdrop / close button all guarded) — the old
   * shell's backdrop closed mid-POST and stranded the request with no
   * visible surface for its result. */
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AppDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      dismissable={!busy}
    >
      <AppDialogBody>{children}</AppDialogBody>
    </AppDialog>
  );
}

function ScopeCheckboxGrid({
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
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-right text-sm border transition-colors ${
              checked
                ? "bg-primary/10 border-primary/40 text-foreground"
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

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
