/**
 * R168 (L2, sub-task B) — the admin products page's tier-price audit
 * panel («فحص تسعير الباقات»).
 *
 * A read-only surface over GET /api/admin/products/tier-price-sweep (the
 * whole-catalog twin of the R167 write-path warnings), following the
 * StockoutRiskPanel conventions: self-hides while loading/on error, an
 * honest empty state on a clean catalog, and per-finding rows that carry
 * the product (with the «الباقات» affordance that opens the SAME variants
 * dialog the cards use), the Arabic message, a kind badge and the
 * expandable variant evidence (aria-expanded, the orders-row idiom).
 *
 * Module-boundary mocks follow products-error-bulk.test.tsx.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminProductsPage from "@/pages/admin/products";
import {
  useAdminProductsTierPriceSweep,
  useCreateProduct,
  useDeleteProduct,
  useListAdminProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminProducts: vi.fn(),
  useCreateProduct: vi.fn(),
  useUpdateProduct: vi.fn(),
  useDeleteProduct: vi.fn(),
  useAdminProductsTierPriceSweep: vi.fn(),
  getListAdminProductsQueryKey: (params?: unknown) => ["/api/admin/products", params ?? null],
  getAdminProductsTierPriceSweepQueryKey: () => ["/api/admin/products/tier-price-sweep"],
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/admin/forecast/StockoutRiskPanel", () => ({
  StockoutRiskPanel: () => null,
}));
vi.mock("@/components/admin/InventoryUploadDialog", () => ({
  InventoryUploadDialog: () => null,
}));
// Marker mock: the affordance under test is that the page OPENS this
// dialog with the finding's product identity (variantsDialogProduct).
vi.mock("@/components/admin/ProductVariantsDialog", () => ({
  ProductVariantsDialog: ({ productId }: { productId: number }) => (
    <div data-testid="variants-dialog-opened">dialog:{productId}</div>
  ),
}));

const FINDING = {
  product_id: 7,
  product_name: "Ahrefs",
  product_slug: "ahrefs",
  kind: "equalized" as const,
  plan_a: "قياسي",
  plan_b: "متقدم",
  duration: "سنوي",
  price: 15980,
  message: "تحذير: سعر الباقتين «قياسي» و«متقدم» متساوٍ (15,980.00 د.ل) عند مدة «سنوي»",
  variants: [
    { id: 71, plan_label: "قياسي", duration_label: "سنوي", price: 15980 },
    { id: 72, plan_label: "متقدم", duration_label: "سنوي", price: 15980 },
  ],
};

const sweepResult = {
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  data: {
    checked_at: "2026-10-12T10:00:00.000Z",
    products_scanned: 45,
    variants_scanned: 120,
    scan_cap: 1000,
    products_with_findings: 1,
    findings: [FINDING],
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminProductsPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (useListAdminProducts as unknown as Mock).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  (useCreateProduct as unknown as Mock).mockReturnValue({ isPending: false, mutate: vi.fn() });
  (useUpdateProduct as unknown as Mock).mockReturnValue({ isPending: false, mutate: vi.fn() });
  (useDeleteProduct as unknown as Mock).mockReturnValue({ isPending: false, mutate: vi.fn() });
  (useAdminProductsTierPriceSweep as unknown as Mock).mockReturnValue(sweepResult);
  window.history.replaceState({}, "", "/");
});

describe("AdminProductsPage — the tier-price audit panel (R168 L2)", () => {
  it("renders the summary line + each finding row (name, message, kind badge)", () => {
    renderPage();

    expect(screen.getByText("فحص تسعير الباقات")).toBeInTheDocument();
    expect(screen.getByText(/آخر فحص/)).toBeInTheDocument();
    // The scan-counts summary line.
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    // The finding row's identity + copy + kind badge.
    expect(screen.getByText("Ahrefs")).toBeInTheDocument();
    expect(screen.getByText(FINDING.message)).toBeInTheDocument();
    expect(screen.getByText("تساوٍ")).toBeInTheDocument();
  });

  it("the «الباقات» affordance opens the variants dialog for the finding's product", () => {
    renderPage();

    expect(screen.queryByTestId("variants-dialog-opened")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "الباقات" }));
    expect(screen.getByTestId("variants-dialog-opened")).toHaveTextContent("dialog:7");
  });

  it("the variant evidence expands on the aria-expanded toggle (orders-row idiom)", () => {
    renderPage();

    const toggle = screen.getByRole("button", { name: "أدلة الباقات" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed: the evidence rows are absent.
    expect(screen.queryByText("15,980.00 د.ل")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The evidence list shows the product's variant rows (prices
    // formatted by the repo's money idiom).
    expect(screen.getAllByText("15,980.00 د.ل").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("قياسي")).toBeInTheDocument();
    expect(screen.getByText("متقدم")).toBeInTheDocument();
  });

  it("the empty state on a clean catalog — the honest-empty copy + the scan counts", () => {
    (useAdminProductsTierPriceSweep as unknown as Mock).mockReturnValue({
      ...sweepResult,
      data: {
        checked_at: "2026-10-12T10:00:00.000Z",
        products_scanned: 45,
        variants_scanned: 120,
        scan_cap: 1000,
        products_with_findings: 0,
        findings: [],
      },
    });
    renderPage();

    expect(screen.getByText("فحص تسعير الباقات")).toBeInTheDocument();
    expect(screen.getByText("لا توجد ملاحظات تسعير على الكتالوج الحالي")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.queryByText("تساوٍ")).not.toBeInTheDocument();
  });

  it("self-hides while loading (the StockoutRiskPanel convention)", () => {
    (useAdminProductsTierPriceSweep as unknown as Mock).mockReturnValue({
      ...sweepResult,
      isLoading: true,
      data: undefined,
    });
    renderPage();

    expect(screen.queryByText("فحص تسعير الباقات")).not.toBeInTheDocument();
    // The page itself still renders (the catalog list owns it).
    expect(screen.getByText("لا توجد منتجات")).toBeInTheDocument();
  });
});
