/**
 * B5-05 + B5-30 + B6 (round-92 audit) — WhatsApp session page tests.
 *
 *   1. B5-05: session delete previously used a raw `window.confirm`;
 *      it now goes through the shared `useConfirm` AlertDialog with the
 *      ORIGINAL message text — cancelling performs no request.
 *   2. B6 + B5-30 + R158: the pair-code copy was a fire-and-forget
 *      `navigator.clipboard?.writeText` — it bypassed the shared
 *      `copyToClipboard` helper (no secure-context fallback, no boolean
 *      result), gave zero copied feedback, and swallowed failures.
 *      It now rides the shared CopyButton (md) rendered by the
 *      sessions-list extract: the button owns the whole lifecycle —
 *      success swaps to "تم النسخ", failure swaps to "تعذّر النسخ"
 *      (aria-live + destructive ink) with a tracked reset timer.
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminWhatsAppPage from "@/pages/admin/whatsapp";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const SESSIONS = [{ id: "sess-1", name: "subnation-otp", status: "ready" }];

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <Router>
      <AdminWhatsAppPage />
    </Router>,
  );
}

describe("AdminWhatsAppPage — delete confirm + pair-code copy feedback (B5-05 + B6/B5-30)", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "DELETE") return resLike({ body: { success: true } });
      if (url.includes("/pair-code")) {
        return resLike({ body: { session: SESSIONS[0], code: "ABCD-1234" } });
      }
      return resLike({ body: { sessions: SESSIONS } });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { clipboard?: unknown }).clipboard;
    delete (window as { isSecureContext?: unknown }).isSecureContext;
  });

  it("delete routes through the styled confirm dialog; cancel performs no DELETE", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));

    const title = await screen.findByText("حذف الجلسة؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("confirm dialog not rendered");
    // The original message text was kept.
    expect(
      within(dialog as HTMLElement).getByText(/سيتم حذف جلسة subnation-otp ومسح بيانات اقترانها/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "إلغاء" }));

    // Only the initial sessions GET happened — no DELETE, no native confirm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("confirming the dialog fires the DELETE and toasts success", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));
    const title = await screen.findByText("حذف الجلسة؟");
    const dialog = title.closest('[role="alertdialog"]')!;

    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "حذف" }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/sessions/sess-1") && (init as RequestInit)?.method === "DELETE",
      );
      expect(deleteCall).toBeTruthy();
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "تم حذف الجلسة", variant: "success" }),
    );
  });

  it("pair-code copy rides the shared CopyButton: failure surfaces تعذّر النسخ on the button, success swaps to تم النسخ (B6 + B5-30 + R158)", async () => {
    renderPage();

    // Open the pair form and issue a code.
    fireEvent.click(await screen.findByRole("button", { name: "ربط برمز الهاتف" }));
    fireEvent.change(screen.getByPlaceholderText("21891XXXXXXX"), {
      target: { value: "218911234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إصدار رمز الاقتران" }));
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();

    // Failure: the clipboard API DENIES the write. R158: the copy rides
    // the shared CopyButton — the old page-owned handler toasted a
    // destructive «تعذّر نسخ الرمز» while the button sat silent; the
    // shared button now announces the failure ITSELF (aria-live label
    // swap to «تعذّر النسخ», destructive ink) and no toast fires.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "نسخ" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD-1234"));
    expect(await screen.findByRole("button", { name: "تعذّر النسخ" })).toBeInTheDocument();
    // No failure toast — the button is the feedback channel now (the
    // pair-issue success toast above is unrelated and stays).
    expect(toastMock.mock.calls.map((c) => c[0]?.title)).not.toContain("تعذّر نسخ الرمز");
    // No false success feedback.
    expect(screen.queryByRole("button", { name: "تم النسخ" })).not.toBeInTheDocument();

    // Success: the helper resolves true → the check-icon swap label.
    writeText.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "تعذّر النسخ" }));
    expect(await screen.findByRole("button", { name: "تم النسخ" })).toBeInTheDocument();
  });
});

/**
 * 110-M (109-b P3) — gateway docs deep-link degradation.
 *
 * The header docs link used to fall back to a baked onrender.com URL
 * when VITE_OPENWA_DOCS_URL was unset at build time — a link that dies
 * with the Render decommission. It now renders a muted plain-text hint
 * instead. The URL is read at module scope, so the test asserts both
 * branches of the ambient env: unset (the CI default — no .env file is
 * tracked) → no anchor at all; set → the anchor points exactly at the
 * configured URL. The retired onrender.com default must never resurface.
 */
describe("AdminWhatsAppPage — gateway docs deep-link degradation (110-M / 109-b)", () => {
  const docsUrl = (import.meta.env.VITE_OPENWA_DOCS_URL as string | undefined)?.trim() || "";

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => resLike({ body: { sessions: [] } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a plain hint (no anchor) when the docs URL is unset — never the onrender default", async () => {
    renderPage();
    // R134 (A3-F5e): the h1 joins the nav's exact label («جلسة واتساب»).
    expect(await screen.findByText("جلسة واتساب")).toBeInTheDocument();

    const link = screen.queryByRole("link", { name: /وثائق البوابة/ });
    if (docsUrl) {
      expect(link).toHaveAttribute("href", docsUrl);
    } else {
      expect(link).not.toBeInTheDocument();
      // The label survives as a muted plain-text hint — no dead-domain link.
      expect(screen.getByText("وثائق البوابة")).toBeInTheDocument();
    }
  });
});

/**
 * R148 (3-errcopy) — the session-action toasts speak Arabic only.
 *
 * Every action catch on this page used to render
 * `err instanceof Error ? err.message : …` verbatim — a network-level
 * failure (the browser's TypeError("Failed to fetch"), the 20 s timeout
 * DOMException) landed raw inside the Arabic toast title. The catches
 * now route through getErrorMessage: the wrapper's Arabic body messages
 * pass through untouched (whatsapp-error-state pins that half) and
 * technical English collapses to the shared Arabic network copy.
 */
describe("AdminWhatsAppPage — error toasts speak Arabic only (R148 3-errcopy)", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a network-level create failure toasts the shared Arabic copy, never the raw English", async () => {
    // The initial sessions GET succeeds (rows render); the create POST
    // rejects with the browser's network-failure shape.
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
      (init?.method ?? "GET") === "POST"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(resLike({ body: { sessions: SESSIONS } })),
    );

    renderPage();
    expect(await screen.findByText("subnation-otp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
    // The raw English never lands in the toast.
    expect(String(toastArg.title)).not.toContain("Failed to fetch");
    expect(toastArg.variant).toBe("destructive");
  });
});
