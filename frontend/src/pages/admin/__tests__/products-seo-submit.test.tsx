/**
 * R123 (E3 item 2) — product editor SEO override fields.
 *
 * The R122 CHANGELOG claimed the product editor carried
 * seo_title/seo_description fields; the form did not exist (the columns
 * were write-orphaned since the schema import). These tests pin the
 * three-way PATCH contract the editor now mirrors
 * (backend/src/routes/admin/products.ts:329-333 — explicit-null-clears):
 *
 *   1. A filled field submits its trimmed value.
 *   2. An UNTOUCHED field is OMITTED (undefined — never in the JSON
 *      body), so opening + saving an editor whose list payload cannot
 *      see the current override never clears it.
 *   3. An edited-then-emptied field submits null — the explicit clear
 *      that falls the row back to the name-based default.
 *
 * Module-boundary mocks follow products-error-bulk.test.tsx; the update
 * mutation rides the REAL generated hook surface (mocked return), so
 * the assertion target is the `mutate({ id, data })` payload itself.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminProductsPage from "@/pages/admin/products";
import {
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
  getListAdminProductsQueryKey: (params?: unknown) => ["/api/admin/products", params ?? null],
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const PRODUCT = (id: number, name: string) => ({
  id,
  name,
  description: null,
  image_url: null,
  price: 20 + id,
  stock_count: 10,
  is_active: true,
  category: "streaming",
  usage_terms: null,
  order_count: 3,
  created_at: "2026-08-01T10:00:00.000Z",
});

const PRODUCTS = [PRODUCT(1, "Netflix 1M"), PRODUCT(2, "Spotify 3M")];

const fetchMock = vi.fn();
// Shared spy for the update mutation (mockReturnValue returns the same
// object on every render — one vi.fn() instance to assert against).
const updateMutate = vi.fn();

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

/** Opens the inline editor for the FIRST product row and returns the
 *  SEO inputs (title input + description textarea). */
async function openEditor() {
  const editButtons = await screen.findAllByRole("button", { name: "تعديل" });
  fireEvent.click(editButtons[0]);
  expect(await screen.findByText("تعديل المنتج")).toBeInTheDocument();
  const seoTitle = screen.getByPlaceholderText(/عنوان مخصص لنتائج البحث/);
  const seoDescription = screen.getByPlaceholderText(/وصف مخصص يظهر تحت عنوان الصفحة/);
  return { seoTitle, seoDescription };
}

describe("AdminProductsPage — product editor SEO override fields (R123 E3 item 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useListAdminProducts as unknown as Mock).mockReturnValue({
      data: PRODUCTS,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    updateMutate.mockReset();
    // The editor's submit button reads ALL THREE mutation hooks' pending
    // flags at render (products.tsx:1029 — createMutation.isPending ||
    // updateMutation.isPending || deleteMutation.isPending), so every
    // mocked hook needs a live return (the products-error-bulk idiom).
    (useCreateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    (useUpdateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: updateMutate,
    });
    (useDeleteProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("renders the Arabic-labeled fields with the column-aligned caps (200/320)", async () => {
    renderPage();
    const { seoTitle, seoDescription } = await openEditor();

    expect(screen.getByText("عنوان SEO (اختياري)")).toBeInTheDocument();
    expect(screen.getByText("وصف SEO (اختياري)")).toBeInTheDocument();
    expect(seoTitle).toHaveAttribute("maxlength", "200");
    expect(seoDescription).toHaveAttribute("maxlength", "320");
    // Both hints say the fields feed the product page meta.
    expect(screen.getAllByText(/محركات البحث/).length).toBeGreaterThanOrEqual(2);
  });

  it("a filled field submits its trimmed value; an untouched one is OMITTED", async () => {
    renderPage();
    const { seoTitle, seoDescription } = await openEditor();

    fireEvent.change(seoTitle, { target: { value: "  اشتراك نتفليكس شهر  " } });
    fireEvent.change(seoDescription, { target: { value: "أفضل سعر لنتفليكس في ليبيا" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const { id, data } = updateMutate.mock.calls[0][0] as {
      id: number;
      data: Record<string, unknown>;
    };
    expect(id).toBe(1);
    // Filled → the trimmed value rides the body.
    expect(data.seo_title).toBe("اشتراك نتفليكس شهر");
    expect(data.seo_description).toBe("أفضل سعر لنتفليكس في ليبيا");
  });

  it("an untouched submit OMITS the SEO keys entirely (undefined never serializes)", async () => {
    renderPage();
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const { data } = updateMutate.mock.calls[0][0] as { data: Record<string, unknown> };
    // The editor's list payload cannot see the current overrides, so
    // "untouched" is the only honest omit signal — an untouched field
    // must NOT appear in the JSON body (JSON.stringify drops undefined).
    expect(data.seo_title).toBeUndefined();
    expect(data.seo_description).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("seo_title");
  });

  it("an edited-then-emptied field submits the explicit null clear", async () => {
    renderPage();
    const { seoTitle } = await openEditor();

    // Type then clear back to empty — the field differs from its
    // pristine baseline by the whitespace edit, and the trimmed-empty
    // value maps to null (the backend's explicit-null-clears pattern:
    // the row falls back to the name-based meta).
    fireEvent.change(seoTitle, { target: { value: "x" } });
    fireEvent.change(seoTitle, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const { data } = updateMutate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.seo_title).toBeNull();
  });

  it("a DELIBERATE full clear (backspace to empty) also submits null — the baseline compare could not see it", async () => {
    // The seeded field is "" and the pristine baseline is "" — a
    // typed-then-fully-backspaced field is byte-identical to an
    // untouched one, so a value-vs-baseline comparison would OMIT and
    // silently ignore the operator's clear. The per-field touched flag
    // is the only signal: an edited-then-emptied field clears the
    // override (exactly what the field's hint promises — «فارغ يعني
    // العنوان الافتراضي»).
    renderPage();
    const { seoTitle } = await openEditor();

    fireEvent.change(seoTitle, { target: { value: "عنوان مؤقت" } });
    fireEvent.change(seoTitle, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const { data } = updateMutate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.seo_title).toBeNull();

    // …while a RE-OPENED editor (startEdit re-seeds + resets the flags)
    // omits the SEO keys on an untouched save again — the clear does not
    // stick to the next edit session.
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(2));
    const second = updateMutate.mock.calls[1][0] as { data: Record<string, unknown> };
    expect(second.data.seo_title).toBeUndefined();
    expect(JSON.stringify(second.data)).not.toContain("seo_title");
  });
});
