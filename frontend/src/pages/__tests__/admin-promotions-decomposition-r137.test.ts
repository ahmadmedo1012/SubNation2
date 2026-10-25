/**
 * R137 (FE) — the admin/promotions.tsx decomposition contract.
 *
 * The flash-sale page was a 624-line single component (6 useState atoms,
 * the session-aware list fetch, the create POST with its 0–95% +
 * 5-minute + 30-day guards, the money-gated activation confirm + PATCH,
 * the confirm-gated permanent DELETE, and every presentational section
 * inline in one function) — the R136 checkout.tsx precedent (1,665 → 9
 * extracts) applied here: orchestration (pages/admin/promotions.tsx) +
 * four verbatim extracts under components/admin/promotions/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the activation confirm preview
 * with the discount %, the 409 single-active-sale error, cancel firing
 * no PATCH) is already pinned by the promotions-activate-confirm render
 * suite; this file guards the STRUCTURE so the decomposition cannot
 * silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      624 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleCreate (the store-wide-discount
 *      POST), toggleActive (the money-gated activation confirm + the
 *      activate/deactivate PATCH that reprices the WHOLE store) and
 *      handleDelete (the confirm-gated permanent DELETE) stay IN the
 *      page: a stale closure in a presentational extract could reprice
 *      the catalog or destroy a sale the operator meant to pause;
 *   4. state ownership — all 6 atoms (the form the dirty guard
 *      identity-compares + the list/busy flags) stay centralized in the
 *      page; the extracts take values + setters/callbacks only;
 *   5. purity — the promotions metadata module is React-free, and no
 *      extract touches the session-aware fetcher or re-declares a
 *      handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/promotions.tsx");

describe("R137 (FE) — admin/promotions.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/promotions.tsx stays under the 1,000-line ceiling (was 624 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/promotions/promotions-meta",
      "@/components/admin/promotions/PromotionsHeader",
      "@/components/admin/promotions/CreatePromotionForm",
      "@/components/admin/promotions/PromotionsList",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the store-wide price writes)", () => {
    // handleCreate carries the create POST — the 0–95% discount cap
    // (the "free goods" guard when a fixed coupon stacks), the
    // 5-minute floor, the R125-I3 30-day ceiling mirror and the
    // 409 single-active-sale error mapping. It must never drift into
    // a presentational extract where a stale closure could mint a
    // second active sale.
    expect(page).toContain("async function handleCreate(e: React.FormEvent) {");
    expect(page).toContain("if (!Number.isFinite(discount) || discount <= 0 || discount > 95) {");
    expect(page).toContain("if (endsAt.getTime() > Date.now() + MAX_DURATION_MS) {");
    expect(page).toContain('await adminFetch("/api/admin/flash-sales", {');
    expect(page).toContain('r.status === 409 ? "يوجد عرض نشط بالفعل" : "تعذّر الإنشاء"');
    // toggleActive: the money-gated activation confirm (94-C2 A2 P2-9 —
    // ACTIVATING repriced the whole store on one unconfirmed tap) + the
    // activate/deactivate PATCH with its R122 401 shape.
    expect(page).toContain("async function toggleActive(sale: FlashSale, next: boolean) {");
    expect(page).toContain('title: "تفعيل العرض على كامل المتجر؟",');
    expect(page).toContain(
      "if (isAdminUnauthorized(r, `/api/admin/flash-sales/${sale.id}`)) return;",
    );
    expect(page).toContain('r.status === 409 ? "يوجد عرض نشط آخر" : "تعذّر التحديث"');
    // handleDelete: the confirm-gated soft-deactivate archive (R187
    // D-F2 — the honest «إيقاف وأرشفة» verb; the backend keeps the row
    // and التفعيل restores it, so the old «حذف نهائي» copy lied).
    expect(page).toContain("async function handleDelete(sale: FlashSale) {");
    expect(page).toContain('title: "إيقاف وأرشفة العرض؟",');
    expect(page).toContain('confirmLabel: "إيقاف وأرشفة",');
    expect(page).toContain(
      'await adminFetchJson(`/api/admin/flash-sales/${sale.id}`, { method: "DELETE", headers });',
    );
    // The session-aware list query + the confirm gate are page-owned too.
    // [R169 lint-zero] load became a useCallback (same page-owned body;
    // the wrapper lets the mount effect key on it without a refetch loop).
    // [R186 C-F8] the hand-rolled load useCallback became the page-owned
    // useQuery on the documented base key — same fetch, same envelope
    // guard, now with the enabled/poll contract every sibling rides (the
    // coupons twin + the C-F8 source-pin suite pin the key + gate).
    expect(page).toContain("useQuery<{ flash_sales?: FlashSale[] }>({");
    expect(page).toContain("queryKey: FLASH_SALES_QUERY_KEY,");
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
    expect(page).toContain("if (err instanceof AdminSessionExpiredError) return;");
  });

  it("the cross-section state atoms stay centralized in the page (values + setters flow down)", () => {
    // One source: the form draft (useDirtyGuard identity-compares it
    // against EMPTY_FORM) and the submitting flag all key off these
    // atoms; the list window + its failure state moved to the C-F8
    // useQuery (data/isError/error — pinned in the money-path test).
    for (const atom of [
      "const [showForm, setShowForm] = useState(false);",
      "const [form, setForm] = useState(EMPTY_FORM);",
      "const [submitting, setSubmitting] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // 98-F7 (R98-05): the dirty guard rides the page-owned form atom
    // (identity compare vs the module-level seed in promotions-meta).
    expect(page).toContain("useDirtyGuard(form !== EMPTY_FORM);");
    // The one-active-sale gate the header + CTA consume as props.
    expect(page).toContain("const hasActive = sales.some((s) => s.is_currently_active);");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-adjacent markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The create form's field ids + the 96-F7 live preview moved to
    // CreatePromotionForm.tsx — promotions-activate-confirm asserts the
    // activate DOM through the page; these spot-pins keep the verbatim
    // shapes at their new address.
    const form = read("src/components/admin/promotions/CreatePromotionForm.tsx");
    expect(form).toContain('id="promotion-form-title"');
    expect(form).toContain('id="promotion-form-discount"');
    expect(form).toContain('id="promotion-form-ends-at"');
    expect(form).toContain("معاينة سريعة");
    expect(form).toContain("{formatCurrency(10 * (1 - d / 100))}");
    expect(form).toContain('"جارٍ الإنشاء…" : "إنشاء وتفعيل"');
    // The list's row affordances + the 94-C2 honest failure surfaces.
    const list = read("src/components/admin/promotions/PromotionsList.tsx");
    expect(list).toContain("aria-label={`إيقاف وأرشفة العرض «${s.title}»`}");
    expect(list).toContain("منتهٍ — في انتظار التنظيف التلقائي");
    expect(list).toContain("لا توجد عروض بعد");
    expect(list).toContain("إعادة المحاولة");
    // The header's one-active-sale CTA gate + warning copy.
    const header = read("src/components/admin/promotions/PromotionsHeader.tsx");
    expect(header).toContain("disabled={hasActive && !showForm}");
    expect(header).toContain('{showForm ? "إغلاق النموذج" : "إنشاء عرض"}');
    expect(header).toContain("عرض واحد نشط في كل وقت — يطبَّق على المتجر بأكمله");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + setters/callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the form draft, the list window and the
    // busy flags are passed DOWN (the page's setForm setter rides
    // along verbatim), so no extract may grow its own useState/useRef/
    // useEffect/useMemo island — a forked form atom is how the dirty
    // guard + the success-only reset silently break.
    const files = ["PromotionsHeader", "CreatePromotionForm", "PromotionsList"];
    for (const name of files) {
      const src = read(`src/components/admin/promotions/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(
        /const \[(sales|loading|loadError|showForm|form|submitting), set/,
      );
    }
  });

  it("no extract touches the session-aware fetcher (the page owns every flash-sale POST/PATCH/DELETE)", () => {
    // adminFetch/adminFetchJson + the AdminSessionExpiredError sentinel
    // are page-only surfaces — an extract importing them is a money path
    // that drifted out of orchestration. The create form submits through
    // the page-owned onSubmit callback and the rows report through
    // onToggleActive/onDelete (confirm-gated in the page).
    const files = ["PromotionsHeader", "CreatePromotionForm", "PromotionsList"];
    for (const name of files) {
      const src = read(`src/components/admin/promotions/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(/handleCreate|toggleActive|handleDelete/);
    }
  });

  it("the promotions metadata module is React-free (pure contracts + the backend-bound mirror)", () => {
    const meta = read("src/components/admin/promotions/promotions-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The row contract the page + the list extract speak.
    expect(meta).toContain("export interface FlashSale {");
    // The create-form contract + the seed the dirty guard identity-
    // compares against (98-F7) — one module-level instance, shared by
    // the useState seed and the success/cancel resets.
    expect(meta).toContain("export const EMPTY_FORM = {");
    expect(meta).toContain("export type PromotionForm = typeof EMPTY_FORM;");
    // R125-I3 (A2-21): the backend create route's 30-day bound,
    // mirrored client-side so the form blocks submit BEFORE the
    // round-trip (the same bound the page's guard consumes by name).
    expect(meta).toContain("export const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days");
  });
});
