/**
 * R147 (P0 recommendations honesty) — the PDP «قد يعجبك أيضاً» rail.
 *
 * Live-production defect: 44/45 products sold out and the rail's ONLY
 * in-stock peer rendered LAST with no نفد mark; the rec card price also
 * rode text-primary-text against the R145/D4 neutral-ink card hierarchy.
 * The backend now ships is_available + stocked-first ordering — these
 * pins hold the FRONTEND half honest:
 *   • sold-out rec cards render the نفد المخزون overlay (ProductCard's
 *     exact bg-black/75 + Lock idiom, visible text = perceivable),
 *   • in-stock rec cards stay the default (no badge),
 *   • the price rides the neutral text-foreground ink + tabular-nums.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationsSection } from "@/components/product/RecommendationsSection";

const recsMock = { current: [] as unknown[] };

vi.mock("@workspace/api-client-react", () => ({
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetProductRecommendations: () => ({
    data: recsMock.current,
    isLoading: false,
    isError: false,
  }),
}));

function renderSection() {
  return render(
    <Router>
      <RecommendationsSection numericId={9} />
    </Router>,
  );
}

beforeEach(() => {
  recsMock.current = [];
});

describe("RecommendationsSection — R147 sold-out honesty", () => {
  it("a sold-out rec renders the نفد المخزون overlay (ProductCard's idiom, perceivable text)", () => {
    recsMock.current = [
      {
        id: 11,
        slug: "rec-sold-out",
        name: "Sold Out Peer",
        image_url: null,
        price: 15,
        is_available: false,
      },
    ];
    renderSection();

    const badge = screen.getByText("نفد المخزون");
    // ProductCard's exact sold-out overlay vocabulary on the image well.
    expect(badge.className).toContain("bg-black/75");
    expect(badge.className).toContain("text-3xs");
    // The card carries no aria-label, so the overlay must NOT be
    // aria-hidden — its visible text IS the نفد carrier.
    expect(badge.getAttribute("aria-hidden")).toBeNull();
  });

  it("an in-stock rec stays the default — no نفد marking", () => {
    recsMock.current = [
      {
        id: 12,
        slug: "rec-stocked",
        name: "Stocked Peer",
        image_url: null,
        price: 25,
        is_available: true,
      },
    ];
    renderSection();

    expect(screen.queryByText(/نفد/)).toBeNull();
  });

  it("the rec price rides the neutral card ink (R145/D4): text-foreground, not primary", () => {
    recsMock.current = [
      {
        id: 12,
        slug: "rec-stocked",
        name: "Stocked Peer",
        image_url: null,
        price: 25,
        is_available: true,
      },
    ];
    renderSection();

    const price = screen.getByText("25.00 د.ل");
    expect(price.className).toContain("text-foreground");
    expect(price.className).toContain("font-bold");
    expect(price.className).toContain("tabular-nums");
    expect(price.className).not.toContain("text-primary-text");
  });

  it("the rail renders the stocked peer's slug link directly (generated type, no widening)", () => {
    recsMock.current = [
      {
        id: 12,
        slug: "rec-stocked",
        name: "Stocked Peer",
        image_url: null,
        price: 25,
        is_available: true,
      },
    ];
    const { container } = renderSection();

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/product/rec-stocked");
  });
});

// ─────────────────────────────────────────────────────────────────────
// R187 (A-F3) — the rail's list→PDP hop is GA4-visible: the card click
// fires select_item with the rail's own item_list_id (the same event
// every other card surface — ProductCard :339, flash-sales :104 —
// fires), alongside the R168 view_item_list impression above.
// ─────────────────────────────────────────────────────────────────────

describe("RecommendationsSection — card click fires select_item (R187 A-F3)", () => {
  /** Arm the R164 loader's own gtag shape (the analytics-events idiom):
   * pushes land on window.dataLayer. */
  beforeEach(() => {
    window.dataLayer = [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args);
    };
    // jsdom's window.scrollTo is a not-implemented no-op — silence it
    // (the route-change-focus idiom).
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.gtag;
    window.dataLayer = [];
    vi.restoreAllMocks();
  });

  it("one select_item with item_list_id pdp-recommendations + items[0].item_id = the card's id", () => {
    recsMock.current = [
      {
        id: 13,
        slug: "rec-ga4",
        name: "GA4 Peer",
        image_url: null,
        price: 25,
        is_available: true,
      },
    ];
    renderSection();

    // The mount impression (view_item_list, R168) — never select_item.
    let selectPushes = layerEntries("select_item");
    expect(selectPushes).toHaveLength(0);
    expect(layerEntries("view_item_list")).toHaveLength(1);

    fireEvent.click(screen.getByText("GA4 Peer"));

    selectPushes = layerEntries("select_item");
    expect(selectPushes).toHaveLength(1);
    const payload = selectPushes[0]![2] as Record<string, unknown>;
    expect(payload.item_list_id).toBe("pdp-recommendations");
    expect((payload.items as Array<{ item_id: string }>)[0]!.item_id).toBe("13");
  });
});

/** The payloads of every pushed occurrence of `eventName` (the
 * analytics-events suite's `fired` idiom, inlined for this file). */
function layerEntries(eventName: string): [string, string, Record<string, unknown>][] {
  return ((window.dataLayer ?? []) as unknown as unknown[][])
    .filter((e) => e[0] === "event" && e[1] === eventName)
    .map((e) => e as [string, string, Record<string, unknown>]);
}
