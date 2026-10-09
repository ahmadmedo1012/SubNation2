/**
 * R125 (A6 B-8) — live-region semantics on the shared list states.
 *
 * Loading, full-page-error and empty transitions were silent to screen
 * readers: TableSkeleton, EmptyState and FetchErrorCard (consumed by
 * 8+ admin pages AND the storefront) carried no role at all — only the
 * hand-rolled stale-refresh banners announced (WCAG 4.1.3 Status
 * Messages). The three shared components now expose:
 *
 *   - TableSkeleton → role="status" + sr-only «جارٍ التحميل…»
 *     (the storefront skeleton pair, applied to the admin one);
 *   - EmptyState → role="status" (the loaded→empty swap announces);
 *   - FetchErrorCard → role="alert" (assertive — error branches only).
 *
 * One component-level file nets every consumer page (A6 #6's
 * extraction pays off here). Pure additions, no visual change.
 */

import { render, screen } from "@testing-library/react";
import { Bell, WifiOff } from "lucide-react";
import { describe, expect, it } from "vitest";
import { TableSkeleton } from "@/components/admin/TableSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";

describe("TableSkeleton — loading is announced (R125 A6 B-8)", () => {
  it("exposes role=status with an sr-only «جارٍ التحميل…» label", () => {
    render(<TableSkeleton cells={["w-28", "flex-1 w-24", "rounded-full w-14"]} />);

    const status = screen.getByRole("status");
    // The sr-only label is INSIDE the live region, so the swap into the
    // skeleton state is what a screen reader reads.
    expect(status).toHaveTextContent("جارٍ التحميل…");
    expect(status.querySelector(".sr-only")).not.toBeNull();
    // The shimmer cells still render — pure addition, no visual change
    // (6 default rows × 3 cells).
    expect(status.querySelectorAll(".skeleton-shimmer")).toHaveLength(18);
  });
});

describe("EmptyState — the loaded→empty swap is announced (R125 A6 B-8)", () => {
  it("exposes role=status with its title", () => {
    render(
      <EmptyState icon={Bell} title="لا توجد تنبيهات" description="ستظهر هنا التنبيهات تلقائياً" />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("لا توجد تنبيهات");
    expect(status).toHaveTextContent("ستظهر هنا التنبيهات تلقائياً");
  });
});

describe("FetchErrorCard — a failed load is announced assertively (R125 A6 B-8)", () => {
  it("exposes role=alert with its headline and retry action", () => {
    render(
      <FetchErrorCard
        size="page"
        icon={WifiOff}
        title="تعذّر تحميل التنبيهات"
        description="تحقّق من شبكتك ثم أعد المحاولة"
        onRetry={() => {}}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("تعذّر تحميل التنبيهات");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("keeps the role on every size variant (page/section/compact)", () => {
    for (const size of ["page", "section", "compact"] as const) {
      const { unmount } = render(
        <FetchErrorCard size={size} title="تعذّر التحميل" onRetry={() => {}} />,
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
      unmount();
    }
  });
});
