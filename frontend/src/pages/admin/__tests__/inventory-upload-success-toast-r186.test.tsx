/**
 * R186 (C-F5) — the inventory upload success toast carries the green
 * variant (the R124-I5 sweep miss).
 *
 * Every sibling inventory write success rides `variant: "success"`
 * (InlineStockEdit «تم تحديث المخزون», products create/update/archive
 * toasts) — this dialog's «تم الرفع» was the one surface left in the
 * default info/blue register, landing a successful money-adjacent bulk
 * write without the success color register the round standardized.
 *
 * Rendered through the REAL dialog with the session-aware fetchers
 * stubbed at the module boundary (the settings-provider-card idiom — the
 * real AdminSessionExpiredError survives via importActual) and the toast
 * hook spied: a successful POST must toast `variant: "success"`.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { InventoryUploadDialog } from "@/components/admin/InventoryUploadDialog";
import { adminFetch, adminFetchJson } from "@/lib/admin-session";

vi.mock("@/lib/admin-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-session")>();
  return { ...actual, adminFetch: vi.fn(), adminFetchJson: vi.fn() };
});

vi.mock("@workspace/api-client-react", () => ({
  // useAdminHeaders registers the global 401 observer through this
  // export — the mock must carry the module surface the hook imports.
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    setAdminToken: vi.fn(),
    hasAdminPermission: () => true,
  }),
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function renderDialog(onUploaded = vi.fn()) {
  render(
    <InventoryUploadDialog
      productId={1}
      productName="Netflix 1M"
      onClose={vi.fn()}
      onUploaded={onUploaded}
    />,
  );
  return { onUploaded };
}

describe("InventoryUploadDialog — the success toast rides the green variant (R186 C-F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The mount GET (existing-inventory probe) answers an empty store.
    (adminFetch as unknown as Mock).mockResolvedValue(resLike({ body: { total: 0, items: [] } }));
  });

  it('a successful upload toasts { title: «تم الرفع», variant: "success" } and fires onUploaded', async () => {
    (adminFetchJson as unknown as Mock).mockResolvedValue({
      message: "أُضيفت 3 عناصر",
      added: 3,
    });
    const { onUploaded } = renderDialog();

    // Paste three valid email|password rows into the textarea.
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "a@x.com|pw1\nb@x.com|pw2\nc@x.com|pw3" },
    });

    // R188-5 (D-F3): the button label pluralizes — 3 rides the few form.
    fireEvent.click(await screen.findByRole("button", { name: "رفع 3 عناصر" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تم الرفع");
    expect(toastArg.description).toBe("أُضيفت 3 عناصر");
    // THE C-F5 pin: the green success register (was: no variant — the
    // R124-I5 sweep miss left this toast in the default info/blue one).
    expect(toastArg.variant).toBe("success");
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it("the failure toast keeps its destructive register (the variant swap touched ONLY the success path)", async () => {
    (adminFetchJson as unknown as Mock).mockRejectedValue(new Error("HTTP 400 Bad Request"));
    renderDialog();

    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "a@x.com|pw1" } });
    fireEvent.click(await screen.findByRole("button", { name: "رفع 1 عنصر" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشل الرفع");
    expect(toastArg.variant).toBe("destructive");
  });
});
