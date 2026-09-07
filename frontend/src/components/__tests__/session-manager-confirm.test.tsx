/**
 * SessionManager destructive-confirm conversion (B6-P1-3).
 *
 * "تسجيل الخروج من جميع الأجهزة" (logout all devices) is the most
 * destructive storefront action, yet its confirmation was a hand-rolled
 * overlay with NO role="dialog", NO aria-modal, NO Escape, NO
 * outside-click — a keyboard user couldn't cancel it at all. Meanwhile
 * hooks/use-confirm.tsx (Radix AlertDialog, full a11y) already existed.
 *
 * The conversion keeps the exact message text and only changes the
 * dialog mechanics. These tests pin: the AlertDialog opens with
 * role=alertdialog, Escape cancels (no logout request fired), and
 * explicit confirmation fires the logout-all endpoint.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "@/components/SessionManager";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const fetchMock = vi.fn();

function mockFetchResponses(responses: Array<{ ok: boolean; body: unknown }>) {
  const queue = [...responses];
  fetchMock.mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    return {
      ok: next.ok,
      json: async () => next.body,
    };
  });
}

function renderPanel() {
  return render(<SessionManager />);
}

async function openConfirmDialog() {
  // Loading state resolves after the sessions fetch — the logout button
  // is disabled until then.
  const trigger = await screen.findByRole("button", {
    name: /تسجيل الخروج من جميع الأجهزة/,
  });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return screen.findByRole("alertdialog");
}

describe("SessionManager — destructive confirm via useConfirm (B6-P1-3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mockFetchResponses([
      {
        ok: true,
        body: {
          sessions: [
            {
              id: "s1",
              device: "Chrome · Windows",
              lastActive: new Date().toISOString(),
              current: true,
            },
          ],
        },
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the shared AlertDialog (role=alertdialog) with the same message text", async () => {
    renderPanel();

    await openConfirmDialog();

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("تأكيد تسجيل الخروج")).toBeInTheDocument();
    expect(
      screen.getByText(
        "هل أنت متأكد من رغبتك في تسجيل الخروج من جميع الأجهزة؟ ستحتاج لتسجيل الدخول مجدداً على كل جهاز.",
      ),
    ).toBeInTheDocument();
    // Both affordances exist — the old overlay had no keyboard path.
    expect(screen.getByRole("button", { name: "تأكيد" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("Escape closes the dialog and does NOT fire the logout-all request", async () => {
    renderPanel();

    await openConfirmDialog();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // Radix DismissableLayer handles Escape on the document.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Only the sessions list request — no logout-all POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/sessions");
  });

  it("explicit confirmation fires the logout-all-devices endpoint", async () => {
    // ok:false so the handler skips window.location navigation (jsdom
    // doesn't implement it) — the fetch contract is what's under test.
    mockFetchResponses([
      { ok: true, body: { sessions: [] } },
      { ok: false, body: {} },
    ]);

    renderPanel();
    await openConfirmDialog();

    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/auth/logout-all-devices");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("cancel button closes the dialog without firing the request", async () => {
    renderPanel();

    await openConfirmDialog();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
