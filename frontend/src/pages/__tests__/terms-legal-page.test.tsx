/**
 * R125-I7 — the terms/privacy page's honesty pins.
 *
 *  A7 B-3 (breadcrumb direction): the separator used to carry a stray
 *  rotate-180 — the storefront's lone BACKWARDS chevron after R124
 *  unified the idiom ("the separator denotes traversal FORWARD
 *  parent → current, so in RTL it points LEFT" — product.tsx's
 *  breadcrumb documents the rule). Pinned: no rotate-180 on the
 *  breadcrumb separator.
 *
 *  A7 B-13 (freshness + measure): the «آخر تحديث» stamp claimed May
 *  2026 while the copy was demonstrably edited in the October-2026
 *  rounds (LyPay label R120-B5, passwordless rewrite + PS-Plus scrub
 *  R123-E4b, R124 craft sweep — git history 5d2de5b → 76a4547). A
 *  legal page whose stamp contradicts its own history erodes the
 *  trust the stamp exists to build. Pinned: the stamp names the true
 *  last-revision month on BOTH tabs, and the prose column carries the
 *  long-form measure cap (~65ch, craft-floor's 65–75ch band).
 *
 * The page renders fully client-side with no API surface — only the
 * SEO hook is stubbed out of jsdom.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TermsPage from "@/pages/terms";

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

beforeEach(() => {
  window.history.pushState({}, "", "/terms");
});

function breadcrumbSeparator(container: HTMLElement): SVGElement {
  // terms' breadcrumb is a plain <div> (category/product use <nav>);
  // the separator is the page's only chevron-left glyph.
  const svg = container.querySelector<SVGElement>("svg.lucide-chevron-left");
  expect(svg).not.toBeNull();
  return svg!;
}

describe("TermsPage — breadcrumb separator points FORWARD (R125-I7 / A7 B-3)", () => {
  it("the separator is an unrotated left chevron (RTL forward=left), not the lone rotate-180 exception", () => {
    const { container } = render(<TermsPage />);

    const sep = breadcrumbSeparator(container);
    // The unified rule: traversal FORWARD renders as ChevronLeft with
    // NO rotation (parent → current, RTL). The old stray rotate-180
    // made it point backwards. (SVG className is an SVGAnimatedString
    // in the DOM — read the attribute, not the property.)
    expect(sep.getAttribute("class")).toContain("lucide-chevron-left");
    expect(sep.getAttribute("class")).not.toContain("rotate-180");
  });
});

describe("TermsPage — the freshness stamp matches git history (R125-I7 / A7 B-13)", () => {
  it("the terms tab stamps the true last-revision month — October 2026, not May", () => {
    render(<TermsPage />);

    expect(screen.getByText("آخر تحديث: أكتوبر 2026")).toBeInTheDocument();
    expect(screen.queryByText(/مايو 2026/)).not.toBeInTheDocument();
  });

  it("the privacy tab carries the same honest stamp after the tab switch", () => {
    render(<TermsPage />);

    fireEvent.click(screen.getByRole("button", { name: /سياسة الخصوصية/ }));

    expect(screen.getByText("آخر تحديث: أكتوبر 2026")).toBeInTheDocument();
    expect(screen.queryByText(/مايو 2026/)).not.toBeInTheDocument();
  });
});

describe("TermsPage — long-form reading measure (R125-I7 / A7 B-13)", () => {
  it("the prose column is capped at ~65ch inside the full-width card", () => {
    const { container } = render(<TermsPage />);

    // The card keeps its width; only the reading measure narrows
    // (the full-width column measured ~90 Arabic chars/line at 14px).
    const measureCap = container.querySelector('[class*="max-w-[65ch]"]');
    expect(measureCap).not.toBeNull();
    // …and the cap actually wraps the legal prose (the stamp lives
    // inside it).
    expect(measureCap!.textContent).toContain("آخر تحديث");
  });
});
