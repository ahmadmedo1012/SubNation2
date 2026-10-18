/**
 * R168 (L2, sub-task B) — the variant dialog surfaces the additive R167-D
 * tier-price `warnings` the create/update mutations used to DROP.
 *
 * The backend contract (routes/admin/product-variants.ts, R167): a
 * successful POST/PATCH carries `warnings: [{kind, message}]` IFF the
 * write left the product's ACTIVE variant matrix inconsistent — never a
 * rejection. This suite pins the UI half:
 *
 *   1. a write WITH warnings → success toast FIRST, then ONE warning
 *      toast per finding (variant "warning", the message verbatim);
 *   2. a clean write (no warnings field) → success toast only;
 *   3. DELETE carries no warnings surface (proven unwirable in R167) —
 *      pinned structurally by the R137 decomposition suite, not here.
 *
 * Module-boundary mocks follow products-seo-submit.test.tsx — the
 * generated hooks are mocked WITH their configs captured, so the
 * assertion target is the real onSuccess handler the component installs.
 */

import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ProductVariantsDialog } from "@/components/admin/ProductVariantsDialog";
import {
  useCreateProductVariant,
  useDeleteProductVariant,
  useGetAdminPricingConfig,
  useListAdminProductVariants,
  useUpdateProductVariant,
} from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminProductVariants: vi.fn(),
  useCreateProductVariant: vi.fn(),
  useUpdateProductVariant: vi.fn(),
  useDeleteProductVariant: vi.fn(),
  useGetAdminPricingConfig: vi.fn(),
  getListAdminProductVariantsQueryKey: (id?: unknown) => ["/api/admin/products", id, "variants"],
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** The mutation configs the dialog installs — captured by the hook mocks. */
let createConfig: { mutation: { onSuccess: (data: unknown) => void } };
let updateConfig: { mutation: { onSuccess: (data: unknown) => void } };

beforeEach(() => {
  vi.clearAllMocks();
  (useListAdminProductVariants as unknown as Mock).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  (useGetAdminPricingConfig as unknown as Mock).mockReturnValue({ data: undefined });
  (useCreateProductVariant as unknown as Mock).mockImplementation((cfg: typeof createConfig) => {
    createConfig = cfg;
    return { isPending: false, mutate: vi.fn() };
  });
  (useUpdateProductVariant as unknown as Mock).mockImplementation((cfg: typeof updateConfig) => {
    updateConfig = cfg;
    return { isPending: false, mutate: vi.fn() };
  });
  (useDeleteProductVariant as unknown as Mock).mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProductVariantsDialog
        productId={1}
        productName="Ahrefs"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
});

/** A write result carrying the additive warnings (R167 shape). */
const WRITE_RESULT = (warnings?: Array<{ kind: string; message: string }>) =>
  ({
    id: 42,
    product_id: 1,
    plan_label: "أساسي",
    duration_label: "سنة كاملة",
    duration_days: 365,
    cost_price: 10,
    price_lyd: 15980,
    computed_price_lyd: 200,
    sku: null,
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...(warnings ? { warnings } : {}),
  }) as never;

const EQUALIZED_MESSAGE =
  "تحذير: سعر الباقتين «قياسي» و«متقدم» متساوٍ (15,980.00 د.ل) عند مدة «سنوي» رغم اختلاف ترتيب سعرهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

describe("ProductVariantsDialog — R167-D tier-price warnings surface as non-blocking toasts (R168 L2)", () => {
  it("a create WITH warnings → success toast first, then one warning toast per finding (message verbatim)", () => {
    act(() => {
      createConfig.mutation.onSuccess(
        WRITE_RESULT([
          { kind: "equalized", message: EQUALIZED_MESSAGE },
          { kind: "inverted", message: "تحذير: ترتيب آخر" },
        ]),
      );
    });

    expect(toastMock).toHaveBeenCalledTimes(3);
    // The write succeeded — its confirmation toast fires first.
    expect(toastMock.mock.calls[0][0]).toEqual({ title: "تمت إضافة الباقة", variant: "success" });
    // Then the pricing cautions — never blocking, 8s auto-dismiss by the
    // toast shim's warning severity default.
    expect(toastMock.mock.calls[1][0]).toEqual({
      title: "تنبيه تسعير",
      description: EQUALIZED_MESSAGE,
      variant: "warning",
    });
    expect(toastMock.mock.calls[2][0]).toEqual({
      title: "تنبيه تسعير",
      description: "تحذير: ترتيب آخر",
      variant: "warning",
    });
  });

  it("an update WITH warnings → same contract on the PATCH path («تم تحديث الباقة» first)", () => {
    act(() => {
      updateConfig.mutation.onSuccess(
        WRITE_RESULT([{ kind: "equalized", message: EQUALIZED_MESSAGE }]),
      );
    });

    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock.mock.calls[0][0]).toEqual({ title: "تم تحديث الباقة", variant: "success" });
    expect(toastMock.mock.calls[1][0]).toEqual({
      title: "تنبيه تسعير",
      description: EQUALIZED_MESSAGE,
      variant: "warning",
    });
  });

  it("a clean write (no warnings field) → success toast ONLY — the additive contract", () => {
    act(() => {
      createConfig.mutation.onSuccess(WRITE_RESULT());
      updateConfig.mutation.onSuccess(WRITE_RESULT());
    });

    expect(toastMock).toHaveBeenCalledTimes(2);
    for (const call of toastMock.mock.calls) {
      expect(call[0].variant).toBe("success");
      expect(call[0].title).not.toBe("تنبيه تسعير");
    }
  });
});
