/**
 * R137 (FE) — the admin/coupons.tsx decomposition contract.
 *
 * The money-discount page was an 807-line single component (9 useState
 * atoms, the session-aware list fetch, the create POST with its 110-M
 * parity guards + the localDateTimeToUtcIso TZ conversion, the toggle
 * PATCH, the confirm-gated soft-archive DELETE, and every presentational
 * section inline in one function) — the R136 checkout.tsx precedent
 * (1,665 → 9 extracts) applied here: orchestration
 * (pages/admin/coupons.tsx) + five verbatim extracts under
 * components/admin/coupons/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the TZ roundtrip wire format, the
 * draft-preserving dismiss, the value parity guards, the aria-pressed
 * type chips) is already pinned by the coupons-tz-roundtrip render
 * suite; this file guards the STRUCTURE so the decomposition cannot
 * silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      807 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleCreate (the create POST + the
 *      110-M parity guards + the success-only form reset), handleToggle
 *      (the activate/deactivate PATCH) and handleDelete (the
 *      confirm-gated soft-archive DELETE) stay IN the page: a stale
 *      closure in a presentational extract could archive the wrong
 *      coupon or resurrect a discount the operator believed ended;
 *   4. state ownership — all 9 atoms (the form + valueError guard +
 *      the per-row busy ids) stay centralized in the page; the extracts
 *      take values + setters/callbacks only;
 *   5. purity — the coupons metadata module is React-free, and no
 *      extract touches the session-aware fetcher (adminFetchJson) or
 *      re-declares a handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/coupons.tsx");

describe("R137 (FE) — admin/coupons.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/coupons.tsx stays under the 1,000-line ceiling (was 807 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/coupons/coupons-meta",
      "@/components/admin/coupons/CouponsHeader",
      "@/components/admin/coupons/CreateCouponDialog",
      "@/components/admin/coupons/CouponsTable",
      "@/components/admin/coupons/CouponsTableSkeleton",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the money-discount writes)", () => {
    // handleCreate carries the create POST — the 110-M parity guards
    // (percentage < 100, value ≤ 10,000 LYD, the server's exact Arabic
    // wording), the 93-C7/C-UX4 localDateTimeToUtcIso TZ conversion
    // (the money leak the render suite pins) and the success-only form
    // reset. It must never drift into a presentational extract where a
    // stale closure could mint a wrong discount.
    expect(page).toContain("const handleCreate = async () => {");
    expect(page).toContain('if (form.type === "percentage" && value >= 100) {');
    expect(page).toContain("if (value > MAX_FIXED_COUPON_VALUE) {");
    expect(page).toContain(
      'setValueError("نسبة الخصم يجب أن تكون أقل من 100% (السعر لا يمكن أن يصل إلى صفر)");',
    );
    expect(page).toContain("expires_at: localDateTimeToUtcIso(form.expires_at),");
    expect(page).toContain('await adminFetchJson<{ code: string }>("/api/coupons/admin", {');
    expect(page).toContain("setForm(EMPTY_FORM);");
    // handleToggle: the activate/deactivate PATCH.
    expect(page).toContain("const handleToggle = async (coupon: Coupon) => {");
    expect(page).toContain("JSON.stringify({ is_active: !coupon.is_active })");
    // handleDelete: the confirm-gated soft-archive DELETE (R125-I3
    // A2-16 — the honest «أرشفة» copy).
    expect(page).toContain("const handleDelete = async (coupon: Coupon) => {");
    expect(page).toContain('title: "أرشفة الكوبون؟",');
    expect(page).toContain('confirmLabel: "أرشفة",');
    expect(page).toContain('{ method: "DELETE", headers }');
    // The session-aware list query + the 401 sentinel handling.
    // [R186 C-F8] the hand-rolled fetchCoupons useCallback became the
    // page-owned useQuery on the documented base key — same fetch, now
    // with the enabled/poll contract every sibling rides (the C-F8
    // source-pin suite pins the key + gate).
    expect(page).toContain("useQuery<Coupon[]>({");
    expect(page).toContain("queryKey: COUPONS_ADMIN_QUERY_KEY,");
    expect(page).toContain('adminFetchJson<Coupon[]>("/api/coupons/admin", { headers })');
    expect(page).toContain("if (err instanceof AdminSessionExpiredError) return;");
    // The confirm gate + the per-row busy atoms are page-owned too.
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
  });

  it("the cross-section state atoms stay centralized in the page (values + setters flow down)", () => {
    // One source: the dialog's draft (useDirtyGuard identity-compares
    // it against EMPTY_FORM), the parity-guard error and the per-row busy
    // ids all key off these atoms; the list window + its failure state
    // moved to the C-F8 useQuery (data/isError/error — pinned in the
    // money-path test above).
    for (const atom of [
      "const [showCreate, setShowCreate] = useState(false);",
      "const [form, setForm] = useState<CreateForm>(EMPTY_FORM);",
      "const [creating, setCreating] = useState(false);",
      "const [valueError, setValueError] = useState<string | null>(null);",
      // R187 (D-F5): the per-row busy atoms are Sets now (the topups
      // processingIds idiom) — overlapping rows no longer clear each
      // other's busy state.
      "const [togglingIds, setTogglingIds] = useState<Set<number>>(() => new Set());",
      "const [archivingIds, setArchivingIds] = useState<Set<number>>(() => new Set());",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // 98-F7 (R98-05): the dirty guard rides the page-owned form atom.
    expect(page).toContain("useDirtyGuard(form !== EMPTY_FORM);");
    // The stat-strip derivations the header consumes as props.
    expect(page).toContain("const activeCount = coupons.filter((c) => c.is_active).length;");
    expect(page).toContain("const totalUsed = coupons.reduce((a, c) => a + c.used_count, 0);");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-adjacent markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The create dialog's field ids + the R126-L3 aria-pressed type
    // chips moved to CreateCouponDialog.tsx — coupons-tz-roundtrip
    // asserts this DOM through the page; these spot-pins keep the
    // verbatim shapes at their new address.
    const dialog = read("src/components/admin/coupons/CreateCouponDialog.tsx");
    expect(dialog).toContain('id="coupons-f1-15956"');
    expect(dialog).toContain('placeholder="SUMMER20"');
    expect(dialog).toContain("aria-pressed={form.type === t}");
    expect(dialog).toContain("يُحوَّل تلقائياً إلى التوقيت العالمي (UTC) عند الحفظ");
    // The table's archive/toggle affordances + the mobile field labels.
    const table = read("src/components/admin/coupons/CouponsTable.tsx");
    expect(table).toContain("aria-label={`أرشفة الكوبون ${coupon.code}`}");
    expect(table).toContain("aria-pressed={coupon.is_active}");
    expect(table).toContain("{coupons.length} كوبون · {activeCount} نشط");
    // The header's honest R120-B4 wording (200-row cap).
    const header = read("src/components/admin/coupons/CouponsHeader.tsx");
    expect(header).toContain("عرض ${couponsCount} (الأحدث أولاً)");
    expect(header).toContain("إجمالي الكوبونات");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + setters/callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the form draft, the guard error and the
    // busy ids are passed DOWN as props (the page's setters ride along
    // verbatim), so no extract may grow its own useState/useRef/
    // useEffect/useMemo island — a forked form atom is how the
    // draft-preserving dismiss + dirty guard silently break.
    const files = ["CouponsHeader", "CreateCouponDialog", "CouponsTable", "CouponsTableSkeleton"];
    for (const name of files) {
      const src = read(`src/components/admin/coupons/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(
        /const \[(coupons|loading|loadError|showCreate|form|creating|valueError|toggling|archiving), set/,
      );
    }
  });

  it("no extract touches the session-aware fetcher (the page owns every coupon POST/PATCH/DELETE)", () => {
    // adminFetchJson + the AdminSessionExpiredError sentinel are
    // page-only surfaces — an extract importing them is a money path
    // that drifted out of orchestration. The create dialog submits
    // through the page-owned onSubmit callback and nothing else.
    const files = ["CouponsHeader", "CreateCouponDialog", "CouponsTable", "CouponsTableSkeleton"];
    for (const name of files) {
      const src = read(`src/components/admin/coupons/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(/handleCreate|handleToggle|handleDelete/);
    }
  });

  it("the coupons metadata module is React-free (pure contracts + the backend-bound mirror)", () => {
    const meta = read("src/components/admin/coupons/coupons-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The row contract the page + both consumer extracts speak.
    expect(meta).toContain("export interface Coupon {");
    // The create-form contract + the seed the dirty guard identity-
    // compares against (98-F7).
    expect(meta).toContain("export interface CreateForm {");
    expect(meta).toContain("export const EMPTY_FORM: CreateForm = {");
    // 110-M (109-m P3): the backend create route's bound, mirrored
    // client-side so the form blocks submit BEFORE the round-trip.
    expect(meta).toContain("export const MAX_FIXED_COUPON_VALUE = 10_000;");
  });
});
