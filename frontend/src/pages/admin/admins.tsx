import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
// R125-I5 (A3-4b): the bare spinner row adopts the shared TableSkeleton
// (role="status" + sr-only «جارٍ التحميل…» ride along) — the accounts
// list keeps its shape during first load like every other console list.
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// R124-I5 (A6 F13): the shared empty-state card — admins was the only
// list page left with a bare text line (visual weight drifted from
// every other console list: no icon tile, no card, no border).
import { EmptyState } from "@/components/admin/EmptyState";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
// R123 (E3 item 1): the four raw fetches ride the session-aware
// wrappers — the inline isAdminUnauthorized checks fold into
// adminFetch's AdminSessionExpiredError sentinel, and adminFetchJson
// owns the ok-guard + safe error-body parse the hand-rolled copies
// had. /api/admin/session stays raw-handler-exempt by design (App.tsx
// owns its 401) — the wrapper only acts on it via non-OK errors.
import { AdminSessionExpiredError, adminFetch, adminFetchJson } from "@/lib/admin-session";
// R123 (E3 P3c): the create/edit dialogs' dirty guards (below).
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the RBAC page's presentational sections moved
// to @/components/admin/admins/* (verbatim moves — the mutation path
// stays HERE: the accounts/scopes/session triple fetch, loadScopes, the
// confirm-gated enable/disable POST, and BOTH dialog submit flows now
// that their form atoms are hoisted into the page; the extracts render
// the byte-identical DOM they rendered inline yesterday). Import surface:
//   • admins-meta — the pure module (the AdminAccount/ScopeOption
//     contracts the page + every extract speak)
//   • AdminsHeader — h1 + «إضافة مسؤول» (opens openCreate below)
//   • AdminAccountCard — one account card (toggle/edit callbacks down)
//   • CreateAdminDialog / EditAdminDialog — the two form shells (the
//     page's create*/edit* atoms + setters flow down; the invite POST
//     and the permission-save PATCH fire through page-owned handlers)
//   • AdminDialogShell + ScopeCheckboxGrid ride inside the dialogs
import { type AdminAccount, type ScopeOption } from "@/components/admin/admins/admins-meta";
import { AdminsHeader } from "@/components/admin/admins/AdminsHeader";
import { AdminAccountCard } from "@/components/admin/admins/AdminAccountCard";
import { CreateAdminDialog } from "@/components/admin/admins/CreateAdminDialog";
import { EditAdminDialog } from "@/components/admin/admins/EditAdminDialog";

export default function AdminAdminsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("admins");
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
  // R147 (2-c D3): per-row busy guard for the confirm-gated
  // enable/disable POST (it kills live sessions) — a double-click fired
  // two POSTs; the coupons.tsx `toggling` idiom, armed only AFTER the
  // confirm accepts.
  const [toggling, setToggling] = useState<number | null>(null);

  // R137 (FE decomposition): the create/edit dialog form atoms hoisted
  // from the dialog components (the users.tsx UserEditDialog idiom) —
  // the dialogs were mount-scoped (fresh useState per open), so
  // openCreate/openEdit below re-seed exactly those initializers and
  // the extracts take values + setters down. The invite POST and the
  // permission-save PATCH fire only through the page-owned
  // handleCreateSubmit/handleEditSubmit below.
  const [createUsername, setCreateUsername] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createSelectedScopes, setCreateSelectedScopes] = useState<string[]>([]);
  const [createSaving, setCreateSaving] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editSelectedScopes, setEditSelectedScopes] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // 93-C6 / F-07 (A5 A-3 drift): the hand-built
  // `{ "Content-Type", Authorization: Bearer-or-empty }` map is the
  // exact anti-pattern useAdminHeaders was created to remove (empty
  // Bearer when logged out; cookie-first reads made it harmless but
  // inconsistent). The shared hook also mirrors the session state for
  // the global 401 handler — this page's raw fetches need that.
  const headers = useAdminHeaders({ json: true });

  // R123 (E3 P3c): a half-filled admin-creation form (password + scopes)
  // is un-submitted work — the same beforeunload guard the other long
  // admin forms ride. (The guard was mount-scoped inside the dialog
  // component; the `creating` gate reproduces that exactly — live only
  // while the dialog is open.)
  useDirtyGuard(
    creating &&
      (createUsername.trim() !== "" ||
        createDisplayName.trim() !== "" ||
        createPassword !== "" ||
        createSelectedScopes.length > 0),
  );

  // R123 (E3 P3c): the edit dialog's dirty guard — compares against the
  // admin's CURRENT persisted values (super-admins have no editable
  // scope set, so display-name is their only dirty axis). (Same
  // mount-scope gating via `editing`.)
  const editingIsSuper = (editing?.permissions ?? []).includes("all");
  const editingInitialScopes = editingIsSuper ? [] : (editing?.permissions ?? []);
  useDirtyGuard(
    editing !== null &&
      (editDisplayName.trim() !== (editing?.display_name ?? "").trim() ||
        (!editingIsSuper &&
          (editSelectedScopes.length !== editingInitialScopes.length ||
            editSelectedScopes.some((s) => !editingInitialScopes.includes(s))))),
  );

  // R169 (lint-zero): reload wrapped in useCallback so the mount effect
  // below can key on it honestly (headers/toast are both stable — the
  // useAdminHeaders useMemo + the useToast module-level fn) — identity
  // only changes when the token does, exactly the old refetch behavior.
  const reload = useCallback(async () => {
    // R134 (A3-F1): fetch-free for a scope-less deep-link mount.
    if (!canView) return;
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
  }, [canView, headers, toast]);

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
  }, [adminToken, navigate, reload]);

  if (!adminToken) return null;

  // R137 (FE decomposition): the dialog openers re-seed the hoisted form
  // atoms — exactly the mount-scoped useState initializers the dialog
  // components had (fresh draft on every open).
  const openCreate = () => {
    setCreateUsername("");
    setCreateDisplayName("");
    setCreatePassword("");
    setCreateSelectedScopes([]);
    setCreateSaving(false);
    setCreating(true);
  };

  const openEdit = (admin: AdminAccount) => {
    setEditing(admin);
    // Only operate on the granular scope set when the admin doesn't have
    // the wildcard "all" — preserve the super-admin invariant.
    setEditDisplayName(admin.display_name);
    setEditSelectedScopes(
      (admin.permissions ?? []).includes("all") ? [] : (admin.permissions ?? []),
    );
    setEditSaving(false);
  };

  const toggleCreateScope = (id: string) => {
    setCreateSelectedScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const toggleEditScope = (id: string) => {
    setEditSelectedScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

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
    setToggling(admin.id);
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
      // R148 (3-errcopy): getErrorMessage passes the wrapper's Arabic
      // body messages through and collapses network-level English —
      // the raw extractor leaked it into the toast title.
      toast({
        title: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      // R147 (2-c D3): reset on EVERY exit path (the session-expiry
      // return included) — a stranded busy id would freeze the row.
      setToggling(null);
    }
  };

  // ── Create dialog submit (hoisted verbatim from the dialog component —
  // the invite flow's POST stays page-owned) ──────────────────────────
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // B-F4 (R188-6): in-flight re-entry guard — the dialog form is
    // Enter-submittable past the disabled submit button, and the invite
    // POST carries no Idempotency-Key: two submits during one POST
    // mint TWO admin accounts. preventDefault stays FIRST (no native
    // form GET).
    if (createSaving) return;
    if (createSelectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setCreateSaving(true);
    try {
      await adminFetchJson(
        "/api/admin/admins",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            username: createUsername.trim(),
            password: createPassword,
            display_name: createDisplayName.trim() || createUsername.trim(),
            permissions: createSelectedScopes,
          }),
        },
        { fallbackError: "فشل الإنشاء" },
      );
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم إنشاء حساب المسؤول", variant: "success" });
      // onCreated: close + reload (the page's own wiring).
      setCreating(false);
      void reload();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R148 (3-errcopy): route through getErrorMessage (see toggle).
      toast({
        title: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCreateSaving(false);
    }
  };

  // ── Edit dialog submit (hoisted verbatim — the permission-save PATCH
  // stays page-owned) ─────────────────────────────────────────────────
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // B-F4 (R188-6): the create twin's guard on the permission-save
    // PATCH (same Enter-past-the-disabled-button window).
    if (editSaving) return;
    if (!editing) return;
    if (!editingIsSuper && editSelectedScopes.length === 0) {
      toast({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" });
      return;
    }
    setEditSaving(true);
    try {
      await adminFetchJson(
        `/api/admin/admins/${editing.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers,
          body: JSON.stringify({
            display_name: editDisplayName.trim(),
            permissions: editingIsSuper ? ["all"] : editSelectedScopes,
          }),
        },
        { fallbackError: "فشل التحديث" },
      );
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم تحديث الحساب", variant: "success" });
      // onSaved: close + reload (the page's own wiring).
      setEditing(null);
      void reload();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R148 (3-errcopy): route through getErrorMessage (see toggle).
      toast({
        title: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  };

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="admins" />;
  }

  return (
    <AdminLayout onRefresh={reload}>
      <div className="space-y-5 max-w-5xl">
        <AdminsHeader onAdd={openCreate} />

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
                <AdminAccountCard
                  key={admin.id}
                  admin={admin}
                  isMe={isMe}
                  scopes={scopes}
                  toggling={toggling === admin.id}
                  onEdit={openEdit}
                  onToggleActive={handleToggleActive}
                />
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <CreateAdminDialog
          scopes={scopes}
          username={createUsername}
          setUsername={setCreateUsername}
          displayName={createDisplayName}
          setDisplayName={setCreateDisplayName}
          password={createPassword}
          setPassword={setCreatePassword}
          selectedScopes={createSelectedScopes}
          toggleScope={toggleCreateScope}
          saving={createSaving}
          onRetryScopes={() => void loadScopes()}
          onClose={() => setCreating(false)}
          onSubmit={handleCreateSubmit}
        />
      )}

      {editing && (
        <EditAdminDialog
          admin={editing}
          scopes={scopes}
          isSuper={editingIsSuper}
          displayName={editDisplayName}
          setDisplayName={setEditDisplayName}
          selectedScopes={editSelectedScopes}
          toggleScope={toggleEditScope}
          saving={editSaving}
          onRetryScopes={() => void loadScopes()}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
        />
      )}
      <ConfirmDialog />
    </AdminLayout>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
