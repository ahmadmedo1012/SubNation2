/**
 * R125-I7 (A7 B-5) — the public status page's refresh control.
 *
 * The refresh button is the page's ONLY interactive control and it
 * shipped as an icon-only p-2 box ≈32px — under the app-wide 44px tap
 * floor (WCAG 2.5.8's 24px minimum would pass; the repo's own bar
 * doesn't). Pinned: a fixed h-11 w-11 hit box.
 *
 * The 30s `tick` re-render loop is justified in-source (label
 * freshness — «آخر تحديث: HH:MM» is computed at render time), so it
 * is not pinned here; only the control's geometry is the contract.
 *
 * The healthz module is mocked at the boundary (the page's only data
 * source); the query itself rides a real QueryClient.
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatusPage from "@/pages/status";
import { fetchHealthzSummary } from "@/lib/healthz";

vi.mock("@/lib/healthz", () => ({
  fetchHealthzSummary: vi.fn(),
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <StatusPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchHealthzSummary).mockReset();
  window.history.pushState({}, "", "/status");
});

describe("StatusPage — the refresh control rides the 44px floor (R125-I7 / A7 B-5)", () => {
  it("the icon-only refresh button renders a fixed 44×44 hit box", async () => {
    vi.mocked(fetchHealthzSummary).mockResolvedValue({ status: "ok" } as Awaited<
      ReturnType<typeof fetchHealthzSummary>
    >);
    renderPage();

    const refresh = await screen.findByRole("button", { name: "تحديث" });
    // Was p-2 + a w-4 icon ≈32px — under the repo's 44px bar. The
    // fixed h-11 w-11 box (icon centered by flex) clears it without
    // growing the banner (banner-less page — no negative margins).
    expect(refresh.className).toContain("h-11");
    expect(refresh.className).toContain("w-11");
  });

  it("a healthy probe drives the aggregate banner (the button rides a rendered page, not a stub)", async () => {
    vi.mocked(fetchHealthzSummary).mockResolvedValue({ status: "ok" } as Awaited<
      ReturnType<typeof fetchHealthzSummary>
    >);
    renderPage();

    expect(await screen.findByText("جميع الخدمات تعمل بشكل طبيعي")).toBeInTheDocument();
  });
});
