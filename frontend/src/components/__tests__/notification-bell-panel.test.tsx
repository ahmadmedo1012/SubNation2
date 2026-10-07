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
