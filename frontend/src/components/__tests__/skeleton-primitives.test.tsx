/**
 * R136 (UX-1) — the shared skeleton primitives' render contract + the
 * sweep's adoption floor.
 *
 * Render pins (the primitives only — every swept page's existing tests
 * stay untouched):
 *   • the a11y pair is structural: role="status" + sr-only
 *     «جارٍ التحميل…» (the exact TableSkeleton string, U+2026 ellipsis)
 *     on every primitive, with NO nested live region inside the
 *     composites (the announcing-wrapper rule the R125-I5 sites
 *     converged on — nested regions double-announce and break
 *     getByRole("status") pins);
 *   • className passthrough — the swept sites' geometry rides the
 *     props verbatim over the primitives' defaults (twMerge resolves
 *     conflicts: h-4→h-20, rounded→rounded-2xl, w-full stays);
 *   • count renders that many rows/cards; the last row shortens to
 *     w-4/5 by default (the text-stack idiom) and stays full-width
 *     with lastShorter={false} (the uniform card-row / grid families);
 *   • EmptyHero: the py-20 first-run hero family (orders/
 *     notifications/cart) — role="status" net-new at adoption, the
 *     w-20 glow tile, the bare action slot.
 *
 * The adoption-floor guard follows the no-native-confirm.test.ts
 * pattern (readFileSync source scan): every swept file must import
 * @/components/ui/Skeleton, and the repo-wide adopter count is pinned
 * ≥ 16 so the sweep cannot silently regress — later rounds (the FE
 * wallet/checkout/home/product sweeps) may only grow it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Package } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyHero } from "@/components/EmptyState";
import { Skeleton, SkeletonCard, SkeletonText } from "@/components/ui/Skeleton";

describe("Skeleton — single block (R136 UX-1)", () => {
  it("exposes role=status with the sr-only «جارٍ التحميل…» label (the TableSkeleton pair)", () => {
    render(<Skeleton className="h-36 rounded-2xl border border-border/45" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("جارٍ التحميل…");
    // The label lives in an sr-only span INSIDE the live region, so the
    // loading→loaded swap announces (admin-list-live-regions idiom).
    const label = status.querySelector(".sr-only");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("جارٍ التحميل…");
  });

  it("passes geometry through className and hardcodes the shimmer utility", () => {
    const { container } = render(<Skeleton className="h-7 w-40 bg-muted rounded-lg mb-6" />);

    const block = container.firstElementChild as HTMLElement;
    expect(block.getAttribute("role")).toBe("status");
    expect(block.className).toContain("skeleton-shimmer");
    for (const cls of ["h-7", "w-40", "bg-muted", "rounded-lg", "mb-6"]) {
      expect(block.className).toContain(cls);
    }
  });
});

describe("SkeletonText — the lines stack (R136 UX-1)", () => {
  it("renders count rows with the last one shorter by default (the text-stack idiom)", () => {
    const { container } = render(<SkeletonText count={4} wrapperClassName="space-y-2.5" />);

    const rows = Array.from(container.querySelectorAll(".skeleton-shimmer")) as HTMLElement[];
    expect(rows).toHaveLength(4);
    expect(rows[0].className).toContain("w-full");
    expect(rows[2].className).toContain("w-full");
    expect(rows[3].className).toContain("w-4/5");
  });

  it("lastShorter={false} renders uniform full-width rows (the card-row / grid families)", () => {
    const { container } = render(
      <SkeletonText
        count={3}
        wrapperClassName="space-y-3"
        className="h-20 rounded-2xl border border-border/35"
        lastShorter={false}
      />,
    );

    const rows = Array.from(container.querySelectorAll(".skeleton-shimmer")) as HTMLElement[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Geometry override beats the h-4/rounded defaults (twMerge,
      // last-wins); the width stays a full line.
      expect(row.className).toContain("h-20");
      expect(row.className).toContain("rounded-2xl");
      expect(row.className).toContain("border-border/35");
      expect(row.className).toContain("w-full");
      expect(row.className).not.toContain("w-4/5");
    }
  });

  it("carries ONE live region — the announcing wrapper — with the sr-only label as its LAST child", () => {
    const { container } = render(<SkeletonText count={2} wrapperClassName="space-y-2" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("جارٍ التحميل…");
    // Rows + label: the label rides LAST so a space-y wrapper's sibling
    // chain (`~` counts any earlier element) never pushes the first
    // row down — the reason the span trails instead of leading.
    const children = Array.from(status.children) as HTMLElement[];
    expect(children).toHaveLength(3);
    expect(children[children.length - 1].className).toContain("sr-only");
    // No nested live region (rows are plain blocks).
    expect(status.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("lands wrapperClassName verbatim on the root — grid wrappers included", () => {
    const { container } = render(
      <SkeletonText
        count={7}
        wrapperClassName="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2"
        className="h-[56px] rounded-xl"
        lastShorter={false}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.className).toContain("grid");
    expect(root.className).toContain("xl:grid-cols-7");
    expect(root.className).toContain("gap-2");
    // All 7 tiles are DIRECT grid children (the system.tsx health grid
    // conversion — one announcing wrapper, N plain tiles).
    expect(root.querySelectorAll(":scope > .skeleton-shimmer")).toHaveLength(7);
  });
});

describe("SkeletonCard — the orders card-row shell (R136 UX-1)", () => {
  it("renders count cards with the orders geometry under one announcing root", () => {
    const { container } = render(<SkeletonCard count={4} wrapperClassName="space-y-2.5" />);

    const status = screen.getByRole("status");
    expect(status.className).toContain("space-y-2.5");
    expect(status).toHaveTextContent("جارٍ التحميل…");
    // The card-row geometry moved VERBATIM from orders' OrderCardSkeleton.
    const cards = Array.from(container.querySelectorAll(".bg-card")) as HTMLElement[];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.className).toContain("border");
      expect(card.className).toContain("rounded-xl");
      expect(card.className).toContain("p-4");
      // The composite row: w-12 tile, h-4 title line, chip pair.
      expect(card.querySelector(".w-12")).not.toBeNull();
      expect(card.querySelector(".h-4")).not.toBeNull();
      expect(card.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThanOrEqual(5);
    }
    // ONE live region — the cards themselves stay plain (no nesting).
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

describe("EmptyHero — the first-run hero empty (R136 UX-1)", () => {
  it("renders the py-20 hero shell with the w-20 glow tile and announces role=status", () => {
    const { container } = render(
      <EmptyHero icon={Package} title="لا توجد طلبات بعد" description="ابدأ بتصفح الكتالوج" />,
    );

    const status = screen.getByRole("status");
    expect(status.className).toContain("py-20");
    expect(status.className).toContain("reveal-up");
    expect(status.className).toContain("bg-card");
    expect(status.className).toContain("rounded-2xl");
    expect(status).toHaveTextContent("لا توجد طلبات بعد");
    // The hero tile family: w-20 shell + blur-xl glow, w-9 decorative
    // icon (aria-hidden — the title carries the live region's meaning).
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("w-9");
    expect(svg?.getAttribute("class")).toContain("opacity-25");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".blur-xl")).not.toBeNull();
    expect(container.querySelector(".w-20")).not.toBeNull();
  });

  it("renders the action slot bare and omits the tile when no icon is passed", () => {
    const { container } = render(<EmptyHero title="سلتك فارغة" action={<a href="/">متابعة التسوق</a>} />);

    // The action slot renders verbatim — a Link CTA keeps its href,
    // and no wrapper div sits between the card and the CTA (the bare
    // slot the adopted hero family's flush-under-description rhythm
    // requires).
    const cta = screen.getByRole("link", { name: "متابعة التسوق" });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta.parentElement?.getAttribute("role")).toBe("status");
    // No icon → no tile; the title stays the live region's content.
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("سلتك فارغة");
  });
});

/** The R136 UX-1 sweep ledger — every file that traded its hand-rolled
 *  skeleton blocks for the primitives. The FE wave's forbidden pages
 *  (wallet/checkout/home/product) are NOT here: their sweeps are a
 *  later round's ownership. */
const SWEPT_FILES = [
  "pages/notifications.tsx",
  "pages/orders.tsx",
  "pages/cart.tsx",
  "pages/profile.tsx",
  "pages/support.tsx",
  "pages/referrals.tsx",
  "pages/status.tsx",
  "pages/loyalty.tsx",
  "pages/order-detail.tsx",
  "pages/admin/system.tsx",
  "pages/admin/security.tsx",
  "pages/admin/dashboard.tsx",
  "pages/admin/whatsapp.tsx",
  "pages/admin/alerts.tsx",
  "pages/admin/settings.tsx",
  "pages/admin/settings/account-tab.tsx",
];

/** The three first-run hero sites the EmptyHero adoption converted. */
const EMPTY_HERO_SITES = ["pages/orders.tsx", "pages/notifications.tsx", "pages/cart.tsx"];

const PRIMITIVE_IMPORT = /from "@\/components\/ui\/Skeleton"/;
const EMPTY_HERO_IMPORT = /from "@\/components\/EmptyState"/;

/** Every non-test .tsx under src/ (the a4-f1-nesting-sweep walker). */
function collectSourceTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectSourceTsx(p));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

describe("R136 UX-1 adoption floor — the swept pages keep using the primitives", () => {
  it.each(SWEPT_FILES)("%s imports the shared skeleton primitives", (rel) => {
    const text = readFileSync(resolve(process.cwd(), "src", rel), "utf8");
    expect(text, `${rel} must import @/components/ui/Skeleton`).toMatch(PRIMITIVE_IMPORT);
  });

  it("the adoption floor: ≥ 16 source files import the primitives (regressions fail, later rounds only grow it)", () => {
    const adopters = collectSourceTsx(resolve(process.cwd(), "src")).filter((f) =>
      readFileSync(f, "utf8").match(PRIMITIVE_IMPORT),
    );
    // Floor, not equality — the FE wallet/checkout/home/product sweeps
    // come in a later round and may only raise this number.
    expect(adopters.length).toBeGreaterThanOrEqual(16);
  });

  it.each(EMPTY_HERO_SITES)("%s renders its first-run hero through EmptyHero", (rel) => {
    const text = readFileSync(resolve(process.cwd(), "src", rel), "utf8");
    expect(text, `${rel} must import EmptyHero from @/components/EmptyState`).toMatch(
      EMPTY_HERO_IMPORT,
    );
    expect(text).toMatch(/EmptyHero/);
  });
});
