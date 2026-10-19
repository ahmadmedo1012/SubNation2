/**
 * R137 (FE) — the admin/admins.tsx decomposition contract.
 *
 * The RBAC directory page was a 777-line single component whose two
 * dialog components (create + edit) each owned their own form atoms,
 * dirty guards and submit POSTs inline in the same file — the R136
 * checkout.tsx precedent (1,665 → 9 extracts) + the r137 users.tsx
 * UserEditDialog idiom applied here: orchestration
 * (pages/admin/admins.tsx) + seven verbatim extracts under
 * components/admin/admins/, with the dialog form atoms + both submit
 * flows HOISTED into the page (the extracts take values + setters +
 * callbacks only, so the invite POST and the permission-save PATCH can
 * never drift into a stale closure).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally; this
 * page has no render suite, so the structure pins carry the whole
 * contract):
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      777 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (directly, or by its consumer extract for the nested shells);
 *   3. mutation ownership — reload / loadScopes, the confirm-gated
 *      enable/disable POST, and BOTH hoisted dialog submits (the
 *      invite POST + the permission-save PATCH with its super-admin
 *      ["all"] invariant) stay IN the page;
 *   4. state ownership — all 15 atoms (the 7 page atoms + the 8
 *      hoisted dialog atoms) stay centralized in the page; the dialogs
 *      re-seed through openCreate/openEdit, exactly the mount-scoped
 *      useState initializers they had; the dirty guards ride the page
 *      and are gated on `creating`/`editing` so their mount-scoped
 *      semantics are preserved;
 *   5. purity — the metadata module is React-free, and no extract
 *      touches the session-aware fetchers, a dirty guard, a toast, or
 *      a page-owned submit handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/admins.tsx");

describe("R137 (FE) — admin/admins.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/admins.tsx stays under the 1,000-line ceiling (was 777 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/admins/admins-meta",
      "@/components/admin/admins/AdminsHeader",
      "@/components/admin/admins/AdminAccountCard",
      "@/components/admin/admins/CreateAdminDialog",
      "@/components/admin/admins/EditAdminDialog",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the nested shells are still imported by their consumers (AdminDialogShell + ScopeCheckboxGrid ride inside both dialogs)", () => {
    // The shared dialog shell + the scope grid render inside the two
    // dialog extracts, not the page — the deletion guard for them
    // lives at the CONSUMER's import (the r136 LedgerEntryRow /
    // r137 MethodBadge precedent).
    for (const name of ["CreateAdminDialog", "EditAdminDialog"]) {
      const src = read(`src/components/admin/admins/${name}.tsx`);
      expect(src, name).toContain('from "@/components/admin/admins/AdminDialogShell"');
      expect(src, name).toContain('from "@/components/admin/admins/ScopeCheckboxGrid"');
    }
  });

  it("the RBAC mutation path stays IN the page (the extracts render; the page owns every POST/PATCH)", () => {
    // The accounts/scopes/session triple fetch + the scopes-only retry.
    // [R169 lint-zero] reload became a useCallback (same page-owned body;
    // the wrapper lets the mount effect key on it without a refetch loop).
    expect(page).toContain("const reload = useCallback(async () => {");
    expect(page).toContain("const loadScopes = async () => {");
    expect(page).toContain('adminFetch("/api/admin/admins", { credentials: "include", headers })');
    // The confirm-gated enable/disable POST.
    expect(page).toContain("const handleToggleActive = async (admin: AdminAccount) => {");
    expect(page).toContain("await adminFetchJson(`/api/admin/admins/${admin.id}/${action}`, {");
    // The invite flow's POST — hoisted verbatim from the create dialog
    // component (its fallbackError contract + the success toast +
    // close-and-reload wiring).
    expect(page).toContain("const handleCreateSubmit = async (e: React.FormEvent) => {");
    expect(page).toContain('{ fallbackError: "فشل الإنشاء" }');
    // The permission-save PATCH — hoisted verbatim from the edit dialog
    // component, keeping the super-admin ["all"] invariant (a super
    // admin's wildcard must never be downgraded to the empty seed).
    expect(page).toContain("const handleEditSubmit = async (e: React.FormEvent) => {");
    expect(page).toContain('{ fallbackError: "فشل التحديث" }');
    expect(page).toContain('permissions: editingIsSuper ? ["all"] : editSelectedScopes,');
    // The 401 sentinel quiet-catches stay with them.
    expect(page).toContain("if (err instanceof AdminSessionExpiredError) return;");
    // And the toggle's confirm gate mounts in the page.
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
  });

  it("the cross-section state atoms stay centralized in the page — including the 8 hoisted dialog atoms (values + setters flow down)", () => {
    // The 7 original page atoms.
    for (const atom of [
      "const [admins, setAdmins] = useState<AdminAccount[]>([]);",
      "const [scopes, setScopes] = useState<ScopeOption[]>([]);",
      "const [loading, setLoading] = useState(true);",
      "const [loadError, setLoadError] = useState<string | null>(null);",
      "const [editing, setEditing] = useState<AdminAccount | null>(null);",
      "const [creating, setCreating] = useState(false);",
      "const [currentAdminId, setCurrentAdminId] = useState<number | null>(null);",
      // The hoisted create-dialog atoms (the users.tsx UserEditDialog
      // idiom — the dialog components were mount-scoped, so the page
      // re-seeds exactly those useState initializers on open).
      'const [createUsername, setCreateUsername] = useState("");',
      'const [createDisplayName, setCreateDisplayName] = useState("");',
      'const [createPassword, setCreatePassword] = useState("");',
      "const [createSelectedScopes, setCreateSelectedScopes] = useState<string[]>([]);",
      "const [createSaving, setCreateSaving] = useState(false);",
      // The hoisted edit-dialog atoms.
      'const [editDisplayName, setEditDisplayName] = useState("");',
      "const [editSelectedScopes, setEditSelectedScopes] = useState<string[]>([]);",
      "const [editSaving, setEditSaving] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The re-seeders: openCreate/openEdit reproduce the mount-scoped
    // initializers (a stale draft from a previous open must never
    // survive — the dialogs' drafts die with their unmounts).
    expect(page).toContain("const openCreate = () => {");
    expect(page).toContain("const openEdit = (admin: AdminAccount) => {");
    expect(page).toContain(
      '(admin.permissions ?? []).includes("all") ? [] : (admin.permissions ?? []),',
    );
    // The dirty guards are page-owned and mount-scope-gated (R123 E3
    // P3c) — live only while the dialog is open, exactly the
    // mount-scoped guards the dialog components had.
    expect(page).toContain("creating &&");
    expect(page).toContain('createUsername.trim() !== "" ||');
    expect(page).toContain("editing !== null &&");
    expect(page).toContain('editDisplayName.trim() !== (editing?.display_name ?? "").trim() ||');
    expect(page.match(/useDirtyGuard\(/g) ?? []).toHaveLength(2);
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The scope grid's checkbox contract (R123 E3 P3b) + the failed
    // catalog retry (R125-I5 A3-9) moved to ScopeCheckboxGrid.tsx.
    const grid = read("src/components/admin/admins/ScopeCheckboxGrid.tsx");
    expect(grid).toContain('role="checkbox"');
    expect(grid).toContain("aria-checked={checked}");
    expect(grid).toContain("تعذّر تحميل قائمة الصلاحيات.");
    // The guarded-dismiss shell (94-C2 A2 P2-6).
    const shell = read("src/components/admin/admins/AdminDialogShell.tsx");
    expect(shell).toContain("dismissable={!busy}");
    // The create dialog's programmatically-associated labels
    // (AUD103-6-F2) + the password helper copy.
    const create = read("src/components/admin/admins/CreateAdminDialog.tsx");
    expect(create).toContain('id="admins-f1-17486"');
    expect(create).toContain('id="admins-f3-15951"');
    expect(create).toContain("8 أحرف على الأقل. سيتمكن المسؤول من تغييرها لاحقاً");
    // The edit dialog's super-admin lock + the credentials note.
    const edit = read("src/components/admin/admins/EditAdminDialog.tsx");
    expect(edit).toContain('<code className="font-mono">all</code>');
    expect(edit).toContain("title={`تعديل: @${admin.username}`}");
    // The account card's identity row + the wildcard chip.
    const card = read("src/components/admin/admins/AdminAccountCard.tsx");
    expect(card).toContain(
      '<div className="text-xs text-muted-foreground">@{admin.username}</div>',
    );
    expect(card).toContain("جميع الصلاحيات (مسؤول رئيسي)");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + setters/callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the hoisted dialog atoms flow DOWN as
    // props (with the page's setters), so no extract may grow its own
    // useState/useRef/useEffect island — a forked scope-selection atom
    // is how the super-admin invariant + the dirty guard silently
    // break.
    const files = [
      "AdminsHeader",
      "AdminAccountCard",
      "AdminDialogShell",
      "ScopeCheckboxGrid",
      "CreateAdminDialog",
      "EditAdminDialog",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/admins/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(
        /const \[(admins|scopes|loading|loadError|editing|creating|currentAdminId|createUsername|createDisplayName|createPassword|createSelectedScopes|createSaving|editDisplayName|editSelectedScopes|editSaving), set/,
      );
    }
  });

  it("no extract touches the RBAC fetch machinery (the page owns every POST/PATCH + the guards)", () => {
    // The session-aware fetchers, the dirty guards, the toast hook and
    // the page-owned submit handlers are page-only surfaces — an
    // extract importing any of them is a mutation path that drifted
    // out of orchestration.
    const files = [
      "AdminsHeader",
      "AdminAccountCard",
      "AdminDialogShell",
      "ScopeCheckboxGrid",
      "CreateAdminDialog",
      "EditAdminDialog",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/admins/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(/useDirtyGuard|useToast/);
      expect(src, name).not.toMatch(
        /\bhandleCreateSubmit\b|\bhandleEditSubmit\b|\bhandleToggleActive\b|\breload\b/,
      );
    }
  });

  it("the metadata module is React-free (pure contracts — importable by any lane)", () => {
    const meta = read("src/components/admin/admins/admins-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The row contract the page + every extract speak.
    expect(meta).toContain("export interface AdminAccount {");
    expect(meta).toContain("totp_enabled: boolean;");
    // The scope-catalog contract the card's chip labels + the grids ride.
    expect(meta).toContain("export interface ScopeOption {");
  });
});
