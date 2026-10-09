/**
 * Account tab — the settings page's self-service account surface
 * (R126-L9 split, A3 plan D).
 *
 * Extracted verbatim from pages/admin/settings.tsx: the identity card
 * (role label mapping), the re-auth-gated profile form, and the
 * password-change form with the honest A8-01 session-revocation
 * semantics (all sessions end → deliberate /admin/login landing).
 * Byte-move: no behavior, prop, or copy change; see A3's split plan D.
 */
import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { AdminSessionExpiredError, adminFetch, adminFetchJson } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { Eye, EyeOff, Key, Loader2, Save, UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/** R125-I5 (A3-9): `role` is a free varchar (default "admin"; the admin
 * create dialog stores exactly "admin" | "super_admin", admins.ts:168).
 * The identity card used to render the raw English token uppercased in
 * an Arabic card — map the two known-good values onto the console's
 * Arabic vocabulary («مسؤول رئيسي» = the «جميع الصلاحيات» wording the
 * admins page already uses), unknown values fall back to the raw token. */
const ROLE_LABELS: Record<string, string> = {
  admin: "مسؤول",
  super_admin: "مسؤول رئيسي",
  superadmin: "مسؤول رئيسي",
};

// R127-B2 (§B.3): the R126-L9 split left `export` on module-private
// symbols (the split plan's "export surface" was never actually needed
// by the shell) — keyword dropped; zero behavior change.
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

// ── Account Tab ───────────────────────────────────────────────────────────────
//
// Self-contained account-management surface. Fetches the current admin's
// session metadata on mount and exposes two re-auth-gated forms:
//   1. profile update (username + display name)
//   2. password change (current + new + confirm)
// Both re-require the CURRENT password before any change goes through —
// even though the request itself is already cookie-authenticated. This is
// the standard "sudo" pattern for high-leverage credential changes.

/**
 * R126-L2 (A3-1): the success copy for a password change — mirrors the
 * backend's own message (auth.ts /change-password: «تم تغيير كلمة
 * المرور بنجاح — سيتم تسجيل خروجك من كل الجلسات»). Only used when the
 * 200 body somehow lacks its `message`; the backend's wording is the
 * source of truth.
 */
const PASSWORD_CHANGED_LOGOUT_MESSAGE =
  "تم تغيير كلمة المرور بنجاح — سيتم تسجيل خروجك من كل الجلسات";

interface AdminSession {
  id: number;
  username: string;
  display_name: string;
  role: string;
  totp_enabled: boolean;
  created_at?: string;
}

export function AccountTab({ adminToken: _adminToken }: { adminToken: string }) {
  const { toast } = useToast();
  // R126-L2 (A3-1 P1): the password-change success path clears the
  // dead session + lands on /admin/login (the backend revoked this
  // session server-side) — the same hooks the main page carries,
  // scoped to the tab that performs the change.
  const { setAdminToken } = useAuth();
  const [, navigate] = useLocation();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const headers = useAdminHeaders({ json: true });

  useEffect(() => {
    // R123 (E3 item 1): adminFetch for uniformity — the session endpoint
    // is response-exempt in the global 401 handler, so behavior is
    // byte-identical to the raw fetch (reject-on-!ok → null session).
    adminFetch("/api/admin/session", { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [headers]);

  // ── Profile (username + display name) form state ──
  const [profileUsername, setProfileUsername] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    if (session) {
      setProfileUsername(session.username);
      setProfileDisplayName(session.display_name);
    }
  }, [session]);

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profilePassword) {
      toast({ title: "كلمة المرور الحالية مطلوبة لتأكيد التغيير", variant: "destructive" });
      return;
    }
    setProfileSaving(true);
    try {
      const body = await adminFetchJson<Partial<AdminSession>>(
        "/api/admin/profile",
        {
          method: "PATCH",
          credentials: "include",
          headers,
          body: JSON.stringify({
            username: profileUsername.trim(),
            display_name: profileDisplayName.trim(),
            current_password: profilePassword,
          }),
        },
        { fallbackError: "فشل التحديث" },
      );
      setSession((s) => (s ? { ...s, ...body } : s));
      setProfilePassword("");
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم تحديث بيانات الحساب", variant: "success" });
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل التحديث",
        variant: "destructive",
      });
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Password form state ──
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwShowNew, setPwShowNew] = useState(false);

  // 98-F7 (R98-05): dirty-state guard — the account tab hosts two long
  // forms (profile + password). Any un-submitted edit now arms the
  // browser beforeunload prompt, so a refresh / tab close mid-edit asks
  // before discarding (SPA route-leave interception stays a documented
  // residual — see use-dirty-guard.ts). Manual field compare vs the
  // loaded session (cheap — three strings + three password fields).
  const accountDirty =
    (!!session &&
      (profileUsername !== session.username ||
        profileDisplayName !== session.display_name ||
        profilePassword !== "")) ||
    pwCurrent !== "" ||
    pwNew !== "" ||
    pwConfirm !== "";
  useDirtyGuard(accountDirty);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwNew !== pwConfirm) {
      toast({ title: "كلمتا المرور الجديدتان غير متطابقتان", variant: "destructive" });
      return;
    }
    if (pwNew.length < 8) {
      toast({ title: "كلمة المرور يجب أن تكون 8 أحرف على الأقل", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      const res = await adminFetchJson<{ message?: string }>(
        "/api/admin/change-password",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
        },
        { fallbackError: "فشل تغيير كلمة المرور" },
      );
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      // R126-L2 (A3-1 P1): the backend revokes EVERY session on success
      // — including THIS one (auth.ts /change-password). Surface its
      // honest message (the sessions-end consequence), clear the dead
      // in-memory session, and land on the admin login deliberately
      // instead of waiting for the next 401 to bounce the operator.
      // R124-I5 (A6 F1): success variant.
      toast({
        title: res?.message ?? PASSWORD_CHANGED_LOGOUT_MESSAGE,
        variant: "success",
      });
      setAdminToken(null);
      navigate("/admin/login");
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل تغيير كلمة المرور",
        variant: "destructive",
      });
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        <div className="h-5 w-40 skeleton-shimmer rounded-lg" />
        <div className="h-4 w-64 skeleton-shimmer rounded" />
        <div className="h-10 skeleton-shimmer rounded-xl mt-2" />
        <div className="h-10 skeleton-shimmer rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-sm text-muted-foreground py-8">
        {/* R120-B4 (A2-F21): typo fix — تعذّر (with shadda), the
            spelling used everywhere else in the admin copy. */}
        تعذّر تحميل بيانات الحساب. حاول إعادة تسجيل الدخول.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Identity card */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-3 float-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-lg">{session.display_name}</div>
            <div className="text-xs text-muted-foreground">@{session.username}</div>
          </div>
          {/* R125-I5 (A3-9): the raw English role token (uppercase, no
              less) rendered in an Arabic card — now mapped through
              ROLE_LABELS («مسؤول» / «مسؤول رئيسي»); unknown tokens fall
              back to the raw value. Uppercase dropped (the 94-C2 A2
              P2-10 Arabic-badge precedent) and text-primary-text per
              A6-B6 (raw text-primary on the /10 tint is 3.56:1 on
              dark). */}
          <div className="text-3xs font-bold bg-primary/10 text-primary-text border border-primary/20 px-2 py-1 rounded-full">
            {roleLabel(session.role)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t border-border/40">
          <div>
            <span className="block text-foreground/50">المصادقة الثنائية</span>
            <span className="font-bold text-foreground">
              {session.totp_enabled ? "✓ مفعّلة" : "غير مفعّلة"}
            </span>
          </div>
          {session.created_at && (
            <div>
              <span className="block text-foreground/50">تاريخ الإنشاء</span>
              <span className="font-bold text-foreground">
                {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                    engines without ar-LY data fall back to the "ar" root
                    and emit Arabic-Indic numerals otherwise. */}
                {new Date(session.created_at).toLocaleDateString("ar-LY-u-nu-latn", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Profile form */}
      <form
        onSubmit={submitProfile}
        className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 float-in"
      >
        <div>
          <h3 className="font-bold text-base mb-1">بيانات الحساب</h3>
          <p className="text-xs text-muted-foreground">
            تحديث اسم المستخدم والاسم الظاهر. يُطلب تأكيد كلمة المرور الحالية.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-f1-17486" className="text-xs font-bold mb-1 block">
              اسم المستخدم
            </label>
            <input
              id="settings-f1-17486"
              type="text"
              value={profileUsername}
              onChange={(e) => setProfileUsername(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              minLength={3}
              maxLength={100}
              required
            />
          </div>
          <div>
            <label htmlFor="settings-f2-17484" className="text-xs font-bold mb-1 block">
              الاسم الظاهر
            </label>
            <input
              id="settings-f2-17484"
              type="text"
              value={profileDisplayName}
              onChange={(e) => setProfileDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              maxLength={100}
            />
          </div>
        </div>
        <div>
          <label htmlFor="settings-f3-38230" className="text-xs font-bold mb-1 block">
            كلمة المرور الحالية للتأكيد
          </label>
          <input
            id="settings-f3-38230"
            type="password"
            value={profilePassword}
            onChange={(e) => setProfilePassword(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={profileSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {profileSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ الحفظ…
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" /> حفظ التغييرات
            </>
          )}
        </button>
      </form>

      {/* Password form */}
      <form
        onSubmit={submitPassword}
        className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 float-in"
      >
        <div>
          <h3 className="font-bold text-base mb-1">تغيير كلمة المرور</h3>
          {/* R126-L2 (A3-1 P1): the old hint promised «لن يتم إنهاء
              الجلسات الحالية الأخرى» while the backend revokes EVERY
              session (auth.ts A8-01) — the promise was inverted. State
              the truth: all sessions end + re-login required. */}
          <p className="text-xs text-muted-foreground">
            8 أحرف على الأقل. سيتم إنهاء جميع الجلسات عند التغيير — بما فيها الجلسة الحالية —
            وستحتاج إلى تسجيل الدخول مجدداً.
          </p>
        </div>
        <div>
          <label htmlFor="settings-f4-27077" className="text-xs font-bold mb-1 block">
            كلمة المرور الحالية
          </label>
          <input
            id="settings-f4-27077"
            type="password"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-f5-27063" className="text-xs font-bold mb-1 block">
              كلمة المرور الجديدة
            </label>
            <div className="relative">
              <input
                id="settings-f5-27063"
                type={pwShowNew ? "text" : "password"}
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                className="w-full px-3 py-2 pr-9 bg-background border border-border/60 rounded-lg text-sm"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setPwShowNew((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={pwShowNew ? "إخفاء" : "إظهار"}
              >
                {pwShowNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="settings-f6-35008" className="text-xs font-bold mb-1 block">
              تأكيد كلمة المرور الجديدة
            </label>
            <input
              id="settings-f6-35008"
              type={pwShowNew ? "text" : "password"}
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={pwSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {pwSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ التحديث…
            </>
          ) : (
            <>
              <Key className="w-3.5 h-3.5" /> تحديث كلمة المرور
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
