/**
 * 96-F5 (R96-M02 + M08) — NotificationPanel mobile geometry.
 *
 * The mobile branch (< 480px) used a hard-coded top: 56 with NO
 * maxHeight: long lists ran past the viewport with the bottom rows
 * unreachable (position: fixed ignores page scroll), and in the
 * installed PWA the Navbar header now grows by env(safe-area-inset-top)
 * — a fixed 56 was wrong by exactly that inset.
 *
 * These tests pin the new contract: the panel's top derives from the
 * REAL header bottom (via the data-navbar-header marker Navbar sets)
 * and the panel is capped with a dvh-based maxHeight so the body's
 * overflow-y-auto actually engages.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/layout/NotificationBell";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

beforeEach(() => {
  // Mobile branch: vw state initializes from window.innerWidth at mount.
  window.innerWidth = 375;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.innerWidth = 1024;
});

/** Stand-in for the Navbar's <header data-navbar-header="1"> with a
 *  mocked rect — lets the panel derive its offset without rendering
 *  the whole Navbar (whose bell is a separate lazy chunk). */
function mountFakeHeader(bottom: number): HTMLElement {
  const header = document.createElement("header");
  header.setAttribute("data-navbar-header", "1");
  header.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  document.body.appendChild(header);
  return header;
}

async function openPanel(): Promise<HTMLElement> {
  render(
    <Router>
      <NotificationBell />
    </Router>,
  );
  // R120-B1 (A4-F7): the bell's accessible name carries the unread count
  // when one exists — regex keeps this helper valid in either state.
  fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
  return (await screen.findByRole("dialog", { name: "الإشعارات" })) as HTMLElement;
}

describe("NotificationPanel mobile — 96-F5 (R96-M08 + M02)", () => {
  it("derives top from the real header bottom and caps height (safe-area aware)", async () => {
    const header = mountFakeHeader(76); // e.g. 56 + 20px notch inset
    try {
      const panel = await openPanel();
      // top = headerBottom + 8 breathing gap.
      expect(panel.style.top).toBe("84px");
      // maxHeight = 100dvh − headerBottom − 16 (8 top + 8 bottom margins).
      expect(panel.style.maxHeight).toBe("calc(100dvh - 92px)");
    } finally {
      header.remove();
    }
  });

  it("falls back to the legacy 56px header height when no marker is present", async () => {
    const panel = await openPanel();
    expect(panel.style.top).toBe("64px");
    expect(panel.style.maxHeight).toBe("calc(100dvh - 72px)");
  });

  it("the panel is a real dialog and the empty state renders (wiring sanity)", async () => {
    const panel = await openPanel();
    expect(panel).toHaveAttribute("role", "dialog");
    expect(screen.getByText("لا توجد إشعارات")).toBeInTheDocument();
  });
});

/** A row shaped like GET /api/notifications (NotificationBell's Notif). */
const notifRow = (i: number) => ({
  id: i,
  type: "order",
  title: `إشعار ${i}`,
  message: null,
  link: null,
  is_read: true,
  created_at: new Date(Date.now() - 60_000 * i).toISOString(),
});

describe("NotificationPanel footer — honest count at the 40-row cap (A9-2, R126-L6)", () => {
  afterEach(() => {
    // Restore the file-level default stub ([]) for the sibling describes.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as Response),
    );
  });

  it("at the backend's 40-row cap the footer reads «آخر 40 …» — the loaded slice, not a lifetime total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => Array.from({ length: 40 }, (_, i) => notifRow(i + 1)),
      } as Response),
    );
    await openPanel();

    // The endpoint caps history at 40 (routes/notifications.ts .limit(40),
    // no pagination) — the old label read «40 إشعاراً» like a total.
    expect(await screen.findByText(/^آخر 40 إشعاراً$/)).toBeInTheDocument();
  });

  it("below the cap the plain count stays (it IS the total — every row the user has is loaded)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => Array.from({ length: 3 }, (_, i) => notifRow(i + 1)),
      } as Response),
    );
    await openPanel();

    expect(await screen.findByText(/^3 إشعارات$/)).toBeInTheDocument();
    expect(screen.queryByText(/آخر/)).not.toBeInTheDocument();
  });
});
