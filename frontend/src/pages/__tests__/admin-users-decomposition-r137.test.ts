/**
 * R137 (FE) — the admin/users.tsx decomposition contract.
 *
 * The users directory was a 1,515-line single component (8 useState
 * atoms + the 99-M3 save-intent ref, 4 effects, a 205-line money PATCH
 * handler and every presentational section inline in one function) —
 * the R136 checkout.tsx precedent (1,665 → 9 extracts) applied here:
 * orchestration (pages/admin/users.tsx) + ten verbatim extracts under
 * components/admin/users/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the wallet-adjust confirm flow,
 * the ?filters=/?tier=/?sort= URL sync, the CSV export quoting and the
 * tier partial-empty honesty) is already pinned by the five users-*
 * render suites in pages/admin/__tests__ (users-wallet-confirm /
 * users-csv-export / users-loyalty-derived-tier / users-tier-partial-
 * empty / users-filters-url); this file guards the STRUCTURE so the
 * decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,515 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleSave (the wallet/points money
 *      PATCH) and its 99-M3 save-intent Idempotency-Key lifecycle stay
 *      IN the page: a stale closure in a presentational extract could
 *      double-apply a wallet delta (AdjustmentService has no
 *      per-record guard);
 *   4. state ownership — all cross-section atoms stay centralized in
 *      the page (the dialog submit gate spans editingUser/saving/form/
 *      canEditMoney); the extracts take values + callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/users.tsx");

describe("R137 (FE) — admin/users.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/users.tsx stays under the 1,000-line ceiling (was 1,515 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/users/user-directory-meta",
      "@/components/admin/users/UsersTableSkeleton",
      "@/components/admin/users/UsersToolbar",
      "@/components/admin/users/UsersFilterPanel",
      "@/components/admin/users/UsersStatsStrip",
      "@/components/admin/users/UserEditDialog",
      "@/components/admin/users/UsersDesktopTable",
      "@/components/admin/users/MobileUserCard",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // Second-level ride-alongs: the desktop row + the provider pill
    // row are consumed by the TABLE extracts, not the page — pin those
    // edges too (a dropped import is a vanished column).
    const desktop = read("src/components/admin/users/UsersDesktopTable.tsx");
    expect(desktop).toContain('from "@/components/admin/users/DesktopUserRow"');
    const row = read("src/components/admin/users/DesktopUserRow.tsx");
    expect(row).toContain('from "@/components/admin/users/ProviderBadges"');
    expect(row).toContain('from "@/components/admin/users/user-directory-meta"');
  });

  it("the money-path handler + its 99-M3 save-intent key lifecycle stay IN the page (the extracts render; the page owns the PATCH)", () => {
    // handleSave carries the wallet/points money PATCH — the numeric
    // guards, the confirm-with-balance-preview gate, the note
    // contract, the body assembly and the query co-invalidation. It
    // must never drift into a presentational extract where a stale
    // closure could double-apply a wallet delta (AdjustmentService
    // has no per-record status guard).
    expect(page).toContain("async function handleSave(e: React.FormEvent) {");
    // 99-M3: ONE Idempotency-Key per SAVE INTENT — minted on the
    // first attempt, reused across retries, cleared only on a
    // definitive resolution (success or a non-IN_FLIGHT rejection;
    // 409 IDEMPOTENCY_IN_FLIGHT keeps it so the retry replays).
    expect(page).toContain("const saveIntentKeyRef = useRef<string | null>(null);");
    expect(page).toContain(
      "const intentKey = saveIntentKeyRef.current ?? generateIdempotencyKey();",
    );
    expect(page).toContain("headers: withIdempotencyKey(jsonHeaders, intentKey),");
    expect(page).toContain(
      'if (data?.code !== "IDEMPOTENCY_IN_FLIGHT") saveIntentKeyRef.current = null;',
    );
    // openEdit resets the intent key for a NEW edit intent — a stale
    // key from a previous save of the same user would replay THAT
    // adjustment's cached response instead of applying this edit.
    expect(page).toContain("const openEdit = useCallback((user: AdminUser) => {");
    expect(page).toContain("saveIntentKeyRef.current = null;");
    // The success path co-invalidates the accumulating users query AND
    // /admin/stats (total_wallet_balance) on the ACTING tab.
    expect(page).toContain(
      "queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });",
    );
    expect(page).toContain('queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });');
    // And the backend-Arabic describer the money path toasts with
    // lives in the pure module the page imports by name (never
    // duplicated inline).
    expect(page).toContain("describeSaveError(data) || ");
    expect(page).toContain("describeSaveError(err) || ");
    const meta = read("src/components/admin/users/user-directory-meta.ts");
    expect(meta).toContain("export function describeSaveError(");
    expect(meta).toContain("const ARABIC_SCRIPT_RE = /[\\u0600-\\u06FF]/;");
    // The CSV money export stays page-owned (it reads `sorted` — the
    // R126-L3 quoting rides the shared csvCell).
    expect(page).toContain("const exportUsersCSV = () => {");
    expect(page).toContain('.map(csvCell).join(",")');
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the toolbar's search box, the debounced query key,
    // the URL-synced tier/sort/panel state, the stats strip and the
    // edit dialog's submit gate all key off the same atoms — the
    // dialog gate alone spans editingUser/saving/form/canEditMoney/
    // noteRequired/noteValid.
    for (const atom of [
      "const [search, setSearch] = useState(",
      "const [debouncedSearch, setDebouncedSearch] = useState(search);",
      "const [tierFilter, setTierFilter] = useState(() => {",
      "const [sortBy, setSortBy] = useState(() => {",
      "const [showFilters, setShowFilters] = useState(",
      "const [editingUser, setEditingUser] = useState<AdminUser | null>(null);",
      "const [saving, setSaving] = useState(false);",
      "const [form, setForm] = useState<EditUserForm>({",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The derived memo chain, the URL sync and the dirty guard stay
    // with them (rules-of-hooks order preserved).
    expect(page).toContain(
      "const users: AdminUser[] = useMemo(() => (usersPages?.pages ?? []).flat(), [usersPages]);",
    );
    expect(page).toContain("const sorted = useMemo(() => {");
    expect(page).toContain("useDirtyGuard(");
    expect(page).toContain(
      "const syncFilterParams = (tier: string, sort: string, filtersOpen: boolean) => {",
    );
    // And the page is typed — no `any` state sneaks back in (the form
    // rides the exported EditUserForm contract).
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-path markup rides along verbatim (the users-* render suites' pins follow the surface)", () => {
    // The wallet/points edit dialog moved to UserEditDialog.tsx —
    // users-wallet-confirm + users-loyalty-derived-tier assert this
    // DOM through the page; these spot-pins keep the verbatim shapes
    // at their new address so the union pins stay meaningful.
    const dialog = read("src/components/admin/users/UserEditDialog.tsx");
    expect(dialog).toContain('title="تعديل المستخدم"');
    expect(dialog).toContain('form="user-edit-form"');
    expect(dialog).toContain("aria-pressed={form.wallet_mode === opt.value}");
    expect(dialog).toContain("سبب تعديل المحفظة / النقاط");
    expect(dialog).toContain("disabled={saving || !canEditMoney || (noteRequired && !noteValid)}");
    // The desktop tier pill's tone map rides the pure module the row
    // imports (the R125-I4 StatusBadge migration).
    const row = read("src/components/admin/users/DesktopUserRow.tsx");
    expect(row).toContain('TIER_TONE[user.loyalty_tier] ?? "neutral"');
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a section needs is passed
    // DOWN, so no extract may grow its own useState/useRef/useEffect
    // island — duplicated truth on the money-edit surface is how the
    // 99-M3-class double-apply bugs happen.
    const files = [
      "ProviderBadges",
      "UsersTableSkeleton",
      "DesktopUserRow",
      "MobileUserCard",
      "UsersToolbar",
      "UsersFilterPanel",
      "UsersStatsStrip",
      "UserEditDialog",
      "UsersDesktopTable",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/users/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the directory meta module is React-free (pure option lists / tone map / describer — importable by any lane)", () => {
    const src = read("src/components/admin/users/user-directory-meta.ts");
    expect(src).not.toMatch(/from "react"|from "lucide-react"/);
    // The frozen load-more page size (94-C2) + the honest-count
    // plural forms (A2 P3-4) — the pagination contract's constants.
    expect(src).toContain("export const USERS_PAGE_SIZE = 100;");
    expect(src).toContain("export const USER_COUNT_FORMS = {");
    expect(src).toContain("export const TIER_FILTERS = [");
    expect(src).toContain("export const SORT_OPTIONS = [");
    expect(src).toContain("export const TIER_TONE: Record<string, StatusBadgeVariant> = {");
  });
});
