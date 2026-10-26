/**
 * R188-5 (fix squad, admin Arabic copy — the frozen-count long tail) —
 * the D-F3/D-F4 survivors of the R187 formatCount sweep that only a
 * render-blind source scan can see (JSX text sites, dashboard tiles,
 * dialogs), pinned as source scans (the admin-longtail-count-forms-r187
 * idiom: structural invariants the render suites cover only incidentally).
 *
 * The frozen literals are banned from coming back; every enumerated site
 * rides formatCount / arabicCountWord with its family's forms object.
 * Anchors are deliberately format-independent (single-line fragments that
 * survive prettier wrapping — the R187 CI harness law).
 *
 * D-F5/D-F6/D-F7/D-F14 ride the same file: the verbal-noun restructure
 * («سيتم معالجة N»), the جارٍ kasratan orthography, the رمز canon and
 * the accusative tanween on «30 يوماً».
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R188-5 D-F3 — the admin frozen-count survivors ride formatCount", () => {
  it("dashboard.tsx: both order tiles ride the shared admin ORDER family", () => {
    const page = read("src/pages/admin/dashboard.tsx");
    expect(page).toContain("formatCount(stats.today_orders ?? 0, ORDER_COUNT_FORMS)");
    expect(page).toContain("formatCount(stats.total_orders ?? 0, ORDER_COUNT_FORMS)");
    // The frozen forms stay dead.
    expect(page).not.toContain("} طلب اليوم");
    expect(page).not.toContain("} طلب إجمالاً");
  });

  it("MobileUserCard.tsx: order count (ORDER family) + points (local POINTS table)", () => {
    const card = read("src/components/admin/users/MobileUserCard.tsx");
    expect(card).toContain("formatCount(user.order_count, ORDER_COUNT_FORMS)");
    expect(card).toContain("formatCount(user.loyalty_points, POINTS_COUNT_FORMS)");
    expect(card).not.toContain("{user.order_count} طلب");
    expect(card).not.toContain("{user.loyalty_points} نقطة");
  });

  it("both BulkActionBars: the selection counts ride their compound families", () => {
    const orders = read("src/components/admin/orders/BulkActionBar.tsx");
    expect(orders).toContain("formatCount(selectedCount, ORDER_SELECTED_COUNT_FORMS)");
    expect(orders).not.toContain("{selectedCount} طلب محدد");
    const products = read("src/components/admin/products/BulkActionBar.tsx");
    expect(products).toContain("formatCount(selectedCount, PRODUCT_SELECTED_COUNT_FORMS)");
    expect(products).not.toContain("{selectedCount} منتج محدد");
  });

  it("OrdersStatsPanel.tsx: the coupon-orders sub rides the ORDER family; رمز canon (D-F7)", () => {
    const panel = read("src/components/admin/orders/OrdersStatsPanel.tsx");
    expect(panel).toContain("{formatCount(couponCount, ORDER_COUNT_FORMS)} بكوبون");
    expect(panel).not.toContain("{couponCount} طلب بكوبون");
    expect(panel).toContain("رمز فريد");
    expect(panel).not.toContain("كود فريد");
  });

  it("admin ProductCard.tsx: stock (unit family) + orders (ORDER family)", () => {
    const card = read("src/components/admin/products/ProductCard.tsx");
    expect(card).toContain("formatCount(product.stock_count, UNIT_COUNT_FORMS)");
    expect(card).toContain("formatCount(product.order_count, ORDER_COUNT_FORMS)");
    expect(card).not.toContain("{product.stock_count} وحدة");
    expect(card).not.toContain("{product.order_count} طلب");
  });

  it("CouponsTable.tsx: the footer's two counts ride the coupon + active families", () => {
    const table = read("src/components/admin/coupons/CouponsTable.tsx");
    expect(table).toContain("formatCount(coupons.length, COUPON_COUNT_FORMS)");
    expect(table).toContain("formatCount(activeCount, ACTIVE_COUNT_FORMS)");
    expect(table).not.toContain("{coupons.length} كوبون");
    expect(table).not.toContain("{activeCount} نشط");
  });

  it("products.tsx: the bulk-archive confirm count rides the PRODUCT family", () => {
    const page = read("src/pages/admin/products.tsx");
    expect(page).toContain("formatCount(selectedIds.size, PRODUCT_COUNT_FORMS)");
    expect(page).not.toContain("سيتم أرشفة ${selectedIds.size} منتج");
  });

  it("InventoryUploadDialog.tsx: all six sites ride the element/row/error families", () => {
    const dialog = read("src/components/admin/InventoryUploadDialog.tsx");
    expect(dialog).toContain("formatCount(data?.added ?? 0, ELEMENT_COUNT_FORMS)");
    expect(dialog).toContain("formatCount(displayCount, ELEMENT_AVAILABLE_FORMS)");
    expect(dialog.match(/formatCount\(willInsert, ELEMENT_COUNT_FORMS\)/g)?.length).toBe(2);
    expect(dialog).toContain(
      "formatCount(parsed.entries.length - MAX_PREVIEW_ROWS, ELEMENT_EXTRA_FORMS)",
    );
    expect(dialog).toContain("formatCount(parsed.errors.length - 10, PARSE_ERROR_COUNT_FORMS)");
    expect(dialog).toContain("DUPLICATE_COUNT_FORMS");
    // The frozen forms stay dead.
    expect(dialog).not.toContain("تم إضافة ${data?.added ?? 0} عنصر");
    expect(dialog).not.toContain("{displayCount} عنصر متوفر");
    expect(dialog).not.toContain("} مكرر)`");
    expect(dialog).not.toContain("MAX_PREVIEW_ROWS} عنصر");
    expect(dialog).not.toContain("parsed.errors.length - 10} خطأ");
  });
});

describe("R188-5 D-F4 — the deep-diagnostics counts pluralize (compact numbers keep formatNumber)", () => {
  it("HealthOverviewSection.tsx: connections + 5xx errors; the zero branch stays", () => {
    const section = read("src/components/admin/system/HealthOverviewSection.tsx");
    expect(section).toContain("arabicCountWord(clients, CONNECTION_COUNT_FORMS)");
    expect(section).toContain("arabicCountWord(errCount, ERROR_COUNT_FORMS)");
    expect(section).not.toContain("formatNumber(clients)} اتصال`");
    expect(section).not.toContain("formatNumber(errCount)} خطأ 5xx");
    // The honest zero branch is untouched.
    expect(section).toContain('"بدون أخطاء"');
  });

  it("HttpAnalyticsSection.tsx: the 5xx sub rides the exported ERROR family", () => {
    const section = read("src/components/admin/system/HttpAnalyticsSection.tsx");
    expect(section).toContain("export const ERROR_COUNT_FORMS = {");
    expect(section.match(/arabicCountWord\(/g)?.length).toBeGreaterThan(0);
    expect(section).not.toContain("?? 0)} خطأ`");
  });

  it("StockoutRiskPanel.tsx: the stale-hours count rides the hour family (D-F14 tanween too)", () => {
    const panel = read("src/components/admin/forecast/StockoutRiskPanel.tsx");
    expect(panel).toContain("formatCount(data.data_freshness_hours, STALE_HOUR_COUNT_FORMS)");
    expect(panel).not.toContain("} ساعة منذ آخر تحديث ناجح).`");
    expect(panel).toContain('label="متوقع 30 يوماً"');
    expect(panel).not.toContain('label="متوقع 30 يوم"');
    expect(panel).toContain('label="متوقع 7 أيام"');
  });
});

describe("R188-5 D-F5/D-F6 — the topups modal's agreement + orthography", () => {
  it("BulkConfirmModal.tsx: verbal-noun restructure + جارٍ ×2 + no جاري residue", () => {
    const modal = read("src/components/admin/topups/BulkConfirmModal.tsx");
    expect(modal).toContain("سيتم معالجة ${formatCount(count, TOPUP_COUNT_FORMS)}");
    expect(modal).not.toContain("سيتم معالجته");
    expect(modal.match(/جارٍ \$\{progress\.done\}/g)?.length).toBe(2);
    expect(modal).not.toContain("جاري");
  });

  it("TopupsToolbar.tsx: the approve-all trigger's live counter says جارٍ", () => {
    const toolbar = read("src/components/admin/topups/TopupsToolbar.tsx");
    expect(toolbar).toContain("جارٍ ${approveAllProgress.done}");
    expect(toolbar).not.toContain("جاري ${approveAllProgress.done}");
  });
});

describe("R188-5 D-F14 — orders-meta.ts: the 30-day filter label carries the tanween", () => {
  it("DATE_RANGES: «30 يوماً» (the many form), «7 أيام» beside it unchanged", () => {
    const meta = read("src/components/admin/orders/orders-meta.ts");
    expect(meta).toContain('{ label: "30 يوماً", days: 30 }');
    expect(meta).not.toContain('{ label: "30 يوم", days: 30 }');
    expect(meta).toContain('{ label: "7 أيام", days: 7 }');
  });
});
