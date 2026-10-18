/**
 * R167 (FE) — the order-detail.tsx decomposition contract (F12).
 *
 * The order detail page was the last storefront page with ZERO
 * page-local extracts (791 lines at the R166 audit): the StatusSteps
 * tracker, the R165/R166 group chip, the ~162-line
 * receipt/credentials block and the ~89-line failed/refunded
 * terminal card all inline in one function. Wave 1 opened the family
 * (components/orders/StatusSteps + OrderGroupChip); wave 2 (R167-A2)
 * landed the headline cuts:
 *
 *   - components/orders/OrderCredentialsCard — the whole
 *     delivery/credentials region verbatim: the receipt card (section
 *     + aria-labelledby + CopyField rows + the dir="auto"
 *     extra-details row + the usage-terms note), the decrypt-failure
 *     alert, the «قيد الإعداد» prep card, the region's
 *     hasDelivery/decryptFailed gates, and RECEIPT_ROW (which had no
 *     consumer outside the region);
 *   - components/orders/OrderTerminalCard — the failed/refunded
 *     terminal card verbatim, returning null on every other status
 *     (the StatusSteps null-branch idiom).
 *
 * WAVE 2 OF 2 — the prerequisite landed first, in the same round: the
 * three source-scan suites that owned that markup at the PAGE
 * address were re-pointed to the page ∪ family surface BEFORE the
 * move (the R146 CopyField precedent — the dir="ltr" credential pins
 * already read that union):
 *
 *   - semantics-depth-r140: the h2 census (exactly 4), the
 *     <section>/aria-labelledby pair, divide-y + the only dir="auto"
 *     — all read the order-detail surface (page ∪ its extracts);
 *   - account-surfaces-visual-r139: the refund vocabulary
 *     ("border-status-info/22", "bg-status-info/8 …", the
 *     «استُرد …» template, «كما خُصمت نقاط الشراء المستردة») reads the
 *     page ∪ family dir;
 *   - contrast-hardening-r140: the /85 refund-points line reads the
 *     page ∪ family dir;
 *   - storefront-r125-sweep: the family joins the B-2 swept list.
 *
 * Rendered DOM machine-verified byte-identical across the move (12
 * pinned render states, old vs new innerHTML) — plus the render
 * suites: order-detail-not-found / order-decrypt-failed /
 * order-refund-receipt / order-detail-group-chip-r165.
 *
 * These are SOURCE-scan pins (the r136/r137 idiom — structural
 * invariants a render test only covers incidentally):
 *
 *   1. size ceiling — the page keeps shrinking per wave (791 at
 *      decomposition, 733 after wave 1, 469 after wave 2);
 *   2. deletion guards — every extract is still imported by the
 *      page, and the moved Arabic copy lives at the extract's new
 *      address (a dropped import = a vanished section);
 *   3. data ownership — the order query, the realtime socket, the
 *      copy-to-clipboard toast and the 404 gate stay IN the page; the
 *      extracts take values only;
 *   4. the RTL icon law — the page's arrows are genuine ArrowRight
 *      back affordances and the page carries ZERO ArrowLeft (the one
 *      forward/view affordance lives in the group chip).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/order-detail.tsx");
const statusSteps = read("src/components/orders/StatusSteps.tsx");
const groupChip = read("src/components/orders/OrderGroupChip.tsx");
const credentials = read("src/components/orders/OrderCredentialsCard.tsx");
const terminal = read("src/components/orders/OrderTerminalCard.tsx");

describe("R167 (FE) — order-detail.tsx decomposition (F12): page stays the data machine", () => {
  it("pages/order-detail.tsx stays under the 500-line ceiling (was 791 at decomposition; 733 after wave 1; 469 after the wave-2 cuts)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(500);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    expect(page).toContain('from "@/components/orders/StatusSteps"');
    expect(page).toContain('from "@/components/orders/OrderGroupChip"');
    expect(page).toContain('from "@/components/orders/OrderCredentialsCard"');
    expect(page).toContain('from "@/components/orders/OrderTerminalCard"');
    // The call sites: the tracker rides the header card; the chip's
    // GATE stays with the order data it reads (R165: checkout mints
    // the token on every confirm — no unit-count gate); the delivery
    // region + terminal card mount unconditionally (they own their
    // own null branches, the StatusSteps idiom).
    expect(page).toContain('<StatusSteps status={order.status ?? ""} />');
    expect(page).toContain("{order.order_group_id && <OrderGroupChip />}");
    expect(page).toContain("<OrderCredentialsCard order={order} />");
    expect(page).toContain("<OrderTerminalCard order={order} />");
  });

  it("the moved markup rides along verbatim (the render suites' DOM pins follow the surface)", () => {
    // StatusSteps — the two-rung tracker (R138's completed ladder).
    expect(statusSteps).toContain("export function StatusSteps({ status }: { status: string }) {");
    expect(statusSteps).toContain('if (status === "failed" || status === "refunded") return null;');
    expect(statusSteps).toContain("استُلم الطلب");
    expect(statusSteps).toContain("تم التسليم");
    // The R165/R166 group chip — order-detail-group-chip-r165 reads
    // this copy + the link role at render; the source pin keeps the
    // verbatim shape at its new address.
    expect(groupChip).toContain("export function OrderGroupChip() {");
    expect(groupChip).toContain('href="/orders"');
    expect(groupChip).toContain("ضمن عملية شراء واحدة");
    expect(groupChip).toContain('<ArrowLeft className="w-2.5 h-2.5 opacity-70" />');
    // The delivery/credentials region — order-refund-receipt +
    // order-decrypt-failed pin these branches at render.
    expect(credentials).toContain('aria-labelledby="order-credentials-heading"');
    expect(credentials).toContain("بيانات الحساب");
    expect(credentials).toContain("انسخ بياناتك بأمان");
    expect(credentials).toContain("البريد الإلكتروني");
    expect(credentials).toContain("كلمة المرور");
    expect(credentials).toContain("divide-y divide-border/20");
    expect(credentials).toContain("تعذّر فك تشفير بيانات التسليم");
    expect(credentials).toContain("قيد الإعداد");
    expect(credentials).toContain("const RECEIPT_ROW =");
    // The failed/refunded terminal card — the §4 refund vocabulary.
    expect(terminal).toContain("تم الاسترداد");
    expect(terminal).toContain("فشل الطلب");
    expect(terminal).toContain("استُرد ${formatCurrency(order.amount ?? 0)}");
    expect(terminal).toContain("كما خُصمت نقاط الشراء المستردة");
    expect(terminal).toContain("تواصل مع الدعم");
  });

  it("the data machine stays IN the page (the query, the socket, the toast, the 404 gate)", () => {
    // The order probe + the realtime watcher (R104 page-scoped
    // socket) + the copy-toast handler.
    expect(page).toContain('useGetOrder(orderCode ?? "", {');
    expect(page).toContain("useSocket(me?.id);");
    expect(page).toContain("const copyOrderCode = async () => {");
    // R94-A1 #4 (P2): the 404 branch reads ApiError.status — the
    // «الطلب غير موجود» view (order-detail-not-found pins render).
    expect(page).toContain(
      "const isNotFoundError = isError && (error as { status?: number } | null)?.status === 404;",
    );
    // The header card's derived amounts stay page-owned (the
    // receipt row chrome itself rode the credentials extract).
    expect(page).toContain(
      "const discountAmount = (order as { discount_amount?: number }).discount_amount;",
    );
    expect(page).not.toContain("const RECEIPT_ROW =");
  });

  it("the RTL icon law holds across the split (forward/view = ArrowLeft in the chip; back = ArrowRight in the page)", () => {
    // R166-A F03: right-pointing is the app's BACK affordance, so the
    // page's remaining arrows (the two error-view returns + the back
    // button) stay ArrowRight — and the page now carries NO ArrowLeft
    // of its own (the one forward affordance moved with the chip in
    // wave 1; the wave-2 extracts carry no arrows at all).
    expect(page).toContain("<ArrowRight className=");
    expect(page).not.toContain("ArrowLeft");
    expect(groupChip).toContain("ArrowLeft");
    expect(groupChip).not.toContain("ArrowRight");
    for (const [name, src] of [
      ["OrderCredentialsCard", credentials],
      ["OrderTerminalCard", terminal],
      ["StatusSteps", statusSteps],
    ] as Array<[string, string]>) {
      expect(src, name).not.toContain("ArrowLeft");
      expect(src, name).not.toContain("ArrowRight");
    }
  });
});

describe("R167 (FE) — the order-detail extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (values in only — no duplicated truth)", () => {
    const files: Array<[string, string]> = [
      ["StatusSteps", statusSteps],
      ["OrderGroupChip", groupChip],
      ["OrderCredentialsCard", credentials],
      ["OrderTerminalCard", terminal],
    ];
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
    // And no extract grows its own data probe.
    for (const src of [statusSteps, groupChip, credentials, terminal]) {
      expect(src).not.toContain("useGetOrder");
      expect(src).not.toMatch(/customFetch|fetch\(/);
    }
  });

  it("the chip is gateless by contract (the page owns order.order_group_id)", () => {
    expect(groupChip).not.toContain("order_group_id");
    expect(groupChip).not.toContain("useParams");
  });

  it("the terminal card's null branch mirrors the tracker's (every non-terminal status renders nothing)", () => {
    expect(terminal).toContain(
      'if (order.status !== "failed" && order.status !== "refunded") return null;',
    );
  });
});
