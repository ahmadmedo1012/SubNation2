import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [currentAdminId, setCurrentAdminId] = useState<number | null>(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken ?? ""}`,
    }),
    [adminToken],
  );

  const reload = async () => {
    try {
      const [listRes, scopesRes, sessionRes] = await Promise.all([
        fetch("/api/admin/admins", { credentials: "include", headers }),
        fetch("/api/admin/admins/scopes", { credentials: "include", headers }),
        fetch("/api/admin/session", { credentials: "include", headers }),
      ]);
      if (!listRes.ok) throw new Error("فشل في جلب المسؤولين");
      const listJson = (await listRes.json()) as AdminAccount[];
      const scopesJson = scopesRes.ok ? await scopesRes.json() : { scopes: [] };
      const sessionJson = sessionRes.ok ? await sessionRes.json() : null;
      setAdmins(listJson);
      setScopes(scopesJson.scopes ?? []);
      setCurrentAdminId(sessionJson?.id ?? null);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "فشل التحميل",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [adminToken]);

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
      const res = await fetch(`/api/admin/admins/${admin.id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `فشل ${verb} الحساب`);
      toast({ title: `تم ${verb} المسؤول @${admin.username}` });
      void reload();
    } catch (err) {
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
            <h1 className="text-2xl font-black mb-0.5">إدارة المسؤولين</h1>
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
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري التحميل…
          </div>
        ) : admins.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 text-sm">
            لا توجد حسابات مسؤولين بعد.
          </div>
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
                        <div className="font-black text-base flex items-center gap-2 flex-wrap">
                          {admin.display_name}
                          {isMe && (
                            <span className="text-[9px] font-bold uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              أنت
                            </span>
                          )}
                          {!admin.is_active && (
                            <span className="text-[9px] font-bold uppercase bg-orange-500/15 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded">
                              معطّل
                            </span>
                          )}
                          {admin.totp_enabled && (
                            <span className="text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">
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
                      <span className="text-xs text-muted-foreground">
                        لا توجد صلاحيات ممنوحة
                      </span>
                    ) : (admin.permissions ?? []).includes("all") ? (
                      <span className="text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded">
                        جميع الصلاحيات (مسؤول رئيسي)
                      </span>
                    ) : (
                      admin.permissions.map((scope) => {
                        const label = scopes.find((s) => s.id === scope)?.label ?? scope;
                        return (
                          <span
                            key={scope}
                            className="text-[10px] font-bold bg-muted/40 text-foreground/75 border border-border/50 px-1.5 py-0.5 rounded"
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
  onClose,
  onCreated,
  headers,
}: {
  scopes: ScopeOption[];
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

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          username: username.trim(),
          password,
          display_name: displayName.trim() || username.trim(),
          permissions: selectedScopes,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "فشل الإنشاء");
      toast({ title: "تم إنشاء حساب المسؤول" });
      onCreated();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "فشل الإنشاء",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title="إضافة مسؤول جديد" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-bold mb-1 block">اسم المستخدم</label>
          <input
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
          <label className="text-xs font-bold mb-1 block">الاسم الظاهر</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            placeholder="افتراضياً: نفس اسم المستخدم"
          />
        </div>
        <div>
          <label className="text-xs font-bold mb-1 block">كلمة المرور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            minLength={8}
            required
            autoComplete="new-password"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            8 أحرف على الأقل. سيتمكن المسؤول من تغييرها لاحقاً وتفعيل المصادقة الثنائية.
          </p>
        </div>
        <div>
          <label className="text-xs font-bold mb-1 block">الصلاحيات</label>
          <ScopeCheckboxGrid
            scopes={scopes}
            selected={selectedScopes}
            onToggle={toggleScope}
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
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
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
  onClose,
  onSaved,
  headers,
}: {
  admin: AdminAccount;
  scopes: ScopeOption[];
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
    isSuper ? [] : admin.permissions ?? [],
  );
  const [saving, setSaving] = useState(false);

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuper && selectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({
          display_name: displayName.trim(),
          permissions: isSuper ? ["all"] : selectedScopes,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "فشل التحديث");
      toast({ title: "تم تحديث الحساب" });
      onSaved();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "فشل التحديث",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell title={`تعديل: @${admin.username}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-bold mb-1 block">الاسم الظاهر</label>
          <input
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
            />
          )}
        </div>
        <div className="flex items-start gap-2 p-2.5 bg-muted/20 border border-border/50 rounded-lg text-[11px] text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          لتغيير اسم المستخدم أو كلمة المرور لهذا الحساب، يجب أن يقوم المسؤول نفسه بذلك من
          صفحة "حسابي".
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
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-2xl p-5 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted/40 flex items-center justify-center"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScopeCheckboxGrid({
  scopes,
  selected,
  onToggle,
}: {
  scopes: ScopeOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (scopes.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/20 rounded-lg">
        <XCircle className="w-3.5 h-3.5" />
        تعذر تحميل قائمة الصلاحيات.
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
