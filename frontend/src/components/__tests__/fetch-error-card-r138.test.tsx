/**
 * R138 (visual) — the calm-error chrome contract on the shared
 * FetchErrorCard (the deep-visual round's re-tune of the outage card).
 *
 * The card must read "we know, here's the way out", not a red wall:
 *   • the CARD frame rests at the round's calm border-border/60 (the
 *     EmptyState/ProductCard card family) — the error tone concentrates
 *     in the icon stage (bg-status-error/8 + /22 border + full-ink
 *     glyph), the single red accent on the card;
 *   • the default retries ride the canonical Button default recipe
 *     (R116-S1: no hand-rolled bg-primary/shadow overrides) at the
 *     44px tap floor — the convergence orders/category/home had
 *     already forced via retryClassName, now the default for every
 *     site that never passed one (admin lists, loyalty, profile,
 *     wallet);
 *   • the outage≠empty silhouette stays obvious (§3): a w-16
 *     error-tinted tile + full-red icon + role="alert" can never read
 *     as EmptyState's w-12 muted ghost tile.
 *
 * Class-level pins on purpose: the R124 extraction contract ("pure
 * extraction") was superseded for these strings by the R138 re-tune —
 * this file is what keeps the re-tune from silently reverting.
 */

import { render, screen } from "@testing-library/react";
import { WifiOff } from "lucide-react";
import { describe, expect, it } from "vitest";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";

describe("FetchErrorCard — R138 calm-error chrome", () => {
  it("page: the frame rests at border-border/60 while the icon stage keeps the error tints", () => {
    const { container } = render(
      <FetchErrorCard size="page" icon={WifiOff} title="تعذّر التحميل" onRetry={() => {}} />,
    );

    const alert = screen.getByRole("alert");
    // The calm resting edge — the same family value EmptyState and
    // ProductCard rest at; the red frame around the whole card is gone.
    expect(alert.className).toContain("border-border/60");
    expect(alert.className).not.toContain("border-status-error/22");
    // The state signal concentrates in the icon stage: the /8 fill +
    // /22 border tile with the full-ink w-8 glyph — one red accent.
    const tile = alert.querySelector('[class*="bg-status-error/8"]');
    expect(tile).not.toBeNull();
    expect(tile?.className).toContain("border-status-error/22");
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("text-status-error");
  });

  it("page: the default retry rides the canonical Button recipe at the 44px floor", () => {
    render(<FetchErrorCard size="page" title="تعذّر التحميل" onRetry={() => {}} />);

    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    // The R116-S1 convergence: gradient fill, shadow-md elevation,
    // press-spring and the focus ring all ride buttonVariants — the
    // flat bg-primary hand-roll and the active:scale override stay dead.
    expect(retry.className).not.toContain("bg-primary");
    expect(retry.className).not.toContain("active:scale");
    expect(retry.className).toContain("shadow-md");
    expect(retry.className).toContain("min-h-11");
    // Focus presence: the ONE global focus-visible system — the retry
    // is the recovery path; keyboard users must never lose it.
    expect(retry.className).toContain("focus-visible:ring-2");
  });

  it("section: same calm frame; the retry picks up min-h-11 net-new", () => {
    render(<FetchErrorCard size="section" title="تعذّر التحميل" onRetry={() => {}} />);

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("border-border/60");
    expect(alert.className).not.toContain("border-status-error/22");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" }).className).toContain("min-h-11");
  });

  it("compact: stays a chrome-free widget-in-card; the retry keeps rounded-xl at min-h-11", () => {
    render(<FetchErrorCard size="compact" title="تعذّر التحميل" onRetry={() => {}} />);

    const alert = screen.getByRole("alert");
    // No card chrome at all (nesting inside a live parent panel would
    // double-border) — the error tile alone carries the state.
    expect(alert.className).not.toContain("bg-card");
    expect(alert.className).not.toContain("border-border/60");
    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    // The sm scale keeps its text-xs density; rounded-xl rides the
    // append over the sm size's rounded-lg (twMerge) so the widget
    // retry keeps the family's shape at the 44px floor.
    expect(retry.className).toContain("text-xs");
    expect(retry.className).toContain("rounded-xl");
    expect(retry.className).toContain("min-h-11");
  });

  it("retryClassName still REPLACES the default (the flash-sales lg recipe rides through verbatim)", () => {
    render(
      <FetchErrorCard
        size="page"
        title="تعذّر التحميل"
        retrySize="lg"
        retryClassName="w-full sm:w-auto"
        onRetry={() => {}}
      />,
    );

    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry.className).toContain("w-full");
    // The lg size's canonical height survives the append.
    expect(retry.className).toContain("h-12");
  });
});
