/**
 * R135 (FE-2) — the canonical STOREFRONT EmptyState.
 *
 * The admin console's variant (A6 #6) has its own pins
 * (admin-list-live-regions); this file pins the customer-side twin's
 * contract — the shape every adopted hand-rolled block converges on:
 *
 *   • icon tile + title + description + action all render, and the
 *     action slot is CALLER-OWNED (a Link CTA keeps its exact href and
 *     Arabic label — adoption must never rewrite either);
 *   • role="status" — the loading→empty swap announces (the R125 A6 B-8
 *     decision the admin variant made; the storefront twin inherits it,
 *     and every adopted site gains it for free);
 *   • the outer card shell survives a className merge (entrance
 *     animations ride the append, they never replace the shell);
 *   • the icon is decorative (aria-hidden) — the title is what the live
 *     region should read, not an unnamed svg.
 */

import { render, screen } from "@testing-library/react";
import { Package, Sparkles } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/EmptyState";

describe("EmptyState — canonical storefront empty-state (R135 FE-2)", () => {
  it("renders the icon tile, title and description inside the card shell", () => {
    const { container } = render(
      <EmptyState icon={Package} title="لا توجد طلبات في هذه الفئة" description="عرض كل الطلبات" />,
    );

    const status = screen.getByRole("status");
    // The storefront card idiom the ~92 blocks converge on.
    expect(status.className).toContain("bg-card");
    expect(status.className).toContain("rounded-2xl");
    expect(status).toHaveTextContent("لا توجد طلبات في هذه الفئة");
    expect(status).toHaveTextContent("عرض كل الطلبات");
    // The compact tile: w-12 shell, w-5 icon at opacity-35 — the sizes
    // the drifted per-page blocks (w-14/w-6/w-7…) collapse to. (SVG
    // className is an SVGAnimatedString in jsdom — read the attribute.)
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("w-5");
    expect(svg?.getAttribute("class")).toContain("opacity-35");
    expect(svg?.parentElement?.className).toContain("w-12");
    expect(svg?.parentElement?.className).toContain("bg-muted/60");
    // Decorative icon: the title carries the meaning inside the live
    // region, the unnamed svg must not.
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the action slot verbatim — a Link CTA keeps its label and href", () => {
    render(
      <EmptyState
        icon={Package}
        title="لا توجد طلبات بعد"
        action={
          <a href="/">
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            تصفح الكتالوج
          </a>
        }
      />,
    );

    const cta = screen.getByRole("link", { name: /تصفح الكتالوج/ });
    expect(cta).toHaveAttribute("href", "/");
    // R138 (visual): the exit CTA's own act of breathing room — mt-5
    // (was mt-4; a caption-tight gap read as a continuation of the
    // hint line, not the way forward).
    expect(cta.parentElement?.className).toContain("mt-5");
  });

  it("merges className onto the outer card without losing the shell", () => {
    render(<EmptyState icon={Package} title="لا توجد" className="reveal-up" />);

    const status = screen.getByRole("status");
    expect(status.className).toContain("reveal-up");
    expect(status.className).toContain("bg-card");
    expect(status.className).toContain("border-border/60");
  });

  it("omits the description and action wrappers entirely when not passed", () => {
    const { container } = render(<EmptyState icon={Package} title="لا توجد" />);

    expect(screen.getByRole("status")).toHaveTextContent("لا توجد");
    // Exactly one <p> (the title) — no empty hint line, no empty CTA
    // wrapper left behind by a conditional render.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("a, button")).toHaveLength(0);
  });

  it("accepts a ReactNode description (inline-LTR fragments ride along)", () => {
    render(
      <EmptyState
        icon={Package}
        title="لا توجد"
        description={
          <>
            قد تكون النتائج غير مكتملة — <code dir="ltr">page=2</code> لم يُحمَّل بعد
          </>
        }
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("قد تكون النتائج غير مكتملة");
    expect(screen.getByRole("status").querySelector("code")).toHaveAttribute("dir", "ltr");
  });
});
