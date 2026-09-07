/**
 * 93-C7 / C-UX4 (A5 C-2, A12 §11.2) — coupons expires_at TZ roundtrip.
 *
 * The create form previously sent the NAIVE `datetime-local` string
 * ("2026-09-07T23:59") straight to the API; the UTC server (Render)
 * read the operator's local wall-clock as UTC, so a coupon meant to
 * die at 23:59 Libya time stayed redeemable until 01:59/02:59 the next
 * day. The form now converts via the shared `localDateTimeToUtcIso`
 * helper (C6) — the same pattern promotions.tsx always did correctly.
 *
 * This pins the wire format: what the operator picks (local naive) is
 * the SAME instant the backend receives (UTC ISO with Z).
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminCouponsPage from "@/pages/admin/coupons";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

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
      <AdminCouponsPage />
    </Router>,
  );
}

describe("AdminCouponsPage — expires_at TZ roundtrip (A5 C-2)", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // URL/method-aware mock: the list GET always returns an array; the
    // create POST returns the created coupon (the refetch after create
    // hits the GET again — it must stay an array or coupons.filter dies).
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return resLike({ body: { id: 1, code: "SUMMER20" } });
      return resLike({ body: [] });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the picked local datetime as a UTC ISO string (ends with Z)", async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Open the create dialog (AppDialog) and fill the form.
    fireEvent.click(await screen.findByRole("button", { name: "كوبون جديد" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("SUMMER20"), {
      target: { value: "SUMMER20" },
    });
    fireEvent.change(screen.getByPlaceholderText("20"), { target: { value: "20" } });

    const expiresInput = dialog.querySelector('input[type="datetime-local"]')!;
    expect(expiresInput).toBeTruthy();
    const pickedLocal = "2026-09-07T23:59";
    fireEvent.change(expiresInput, { target: { value: pickedLocal } });

    fireEvent.click(screen.getByRole("button", { name: "إنشاء الكوبون" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
    });

    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    )!;
    const body = JSON.parse((post[1] as RequestInit).body as string) as {
      expires_at: string | null;
    };

    // The exact same instant the operator picked, expressed in UTC.
    expect(body.expires_at).toBe(new Date(pickedLocal).toISOString());
    expect(body.expires_at).toMatch(/Z$/);
  });

  it('sends null when no expiry is set (backend stores "no expiry")', async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "كوبون جديد" }));

    fireEvent.change(screen.getByPlaceholderText("SUMMER20"), {
      target: { value: "RAMADAN25" },
    });
    fireEvent.change(screen.getByPlaceholderText("20"), { target: { value: "25" } });

    fireEvent.click(screen.getByRole("button", { name: "إنشاء الكوبون" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
    });
    const body = JSON.parse(
      (
        fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === "POST",
        )![1] as RequestInit
      ).body as string,
    ) as { expires_at: string | null };
    expect(body.expires_at).toBeNull();
  });

  it("dismissing the dialog preserves the draft (no reset-on-dismiss, A12 H5)", async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "كوبون جديد" }));
    fireEvent.change(screen.getByPlaceholderText("SUMMER20"), {
      target: { value: "DRAFT99" },
    });

    // Close via the X button — the half-filled draft must survive…
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // …and reappear when the dialog is reopened.
    fireEvent.click(screen.getByRole("button", { name: "كوبون جديد" }));
    expect(await screen.findByDisplayValue("DRAFT99")).toBeInTheDocument();
  });
});
