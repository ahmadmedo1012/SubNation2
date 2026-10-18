/**
 * R140-d (runtime perf) — MAIN-THREAD HYGIENE pin suite.
 *
 * Source-scan pins in the r128-sweep / account-surfaces-visual-r139 idiom,
 * guarding the runtime-performance lane's contracts so a future round
 * cannot silently regress them:
 *
 *   1. BLOB-PAUSE FLEET (design contract §2 motion): every decorative
 *      blob-drift site pauses off-screen via use-on-screen — the fleet
 *      is censused LIVE from source (a new blob-drift site that ships
 *      without pause wiring fails the census pin and must be added here
 *      WITH its wiring). Static blobs (AuthedHero's animation-free
 *      accent, referrals' corner blob) are deliberately NOT in the
 *      fleet — nothing animates, nothing to pause;
 *   2. HOME render-path hygiene: the ItemList LD construction + the
 *      orders slice are memoized, the pure hero/grid sections ride
 *      React.memo, and the typing stream is deferred
 *      (useDeferredValue) while committed searches ride
 *      startTransition — pure scheduling, zero visual change;
 *   3. GUESTHERO above-fold cost: transform-only drift keyframes (no
 *      layout-thrashing properties) + the pause wiring intact;
 *   4. CHARTSLOADER lazy boundary: recharts enters the bundle ONLY
 *      through the dynamic import() bridges — zero static imports
 *      anywhere in the admin path.
 *
 * REPORT-ONLY context this suite deliberately does NOT pin (owned by
 * other lanes, recorded in the r140-d worklog FLAGS): ProductCard's
 * React.memo (verified present at ProductCard.tsx:796), category.tsx
 * deferral (no filter state exists — nothing to defer), the AuthedHero /
 * RecentOrdersStrip / ProductsGrid own-file memo idiom (the usage-site
 * wrappers in home.tsx cover it this round).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const PAGE = read("src/pages/home.tsx");
const GUEST_HERO = read("src/components/home/GuestHero.tsx");
const CHARTS_LOADER = read("src/components/admin/dashboard/ChartsLoader.tsx");
const HOOK = read("src/hooks/useOnScreen.ts");
const CSS = read("src/index.css");

/* ── The blob-pause fleet (R140-d census of every blob-drift render site) ──
 * Each entry pins the RENDER SITE (what the live census compares
 * against) plus the WIRING files that must keep the observer +
 * animation-play-state contract. The wallet pair is split by design
 * (the R136 FE-1 decomposition): the blob renders in the extract, the
 * use-on-screen observer stays page-owned and flows down as
 * ref + style props. */
const BLOB_PAUSE_FLEET: ReadonlyArray<{
  renderSite: string;
  label: string;
  wiring: ReadonlyArray<{ file: string; pins: string[] }>;
}> = [
  {
    renderSite: "src/components/home/GuestHero.tsx",
    label: "storefront guest hero (the above-fold pair)",
    wiring: [
      {
        file: "src/components/home/GuestHero.tsx",
        pins: [
          "useOnScreen<HTMLDivElement>()",
          'animationPlayState: heroOnScreen ? "running" : "paused"',
          "blob-drift",
          "blob-drift-slow",
        ],
      },
    ],
  },
  {
    renderSite: "src/pages/login.tsx",
    label: "login card",
    wiring: [
      {
        file: "src/pages/login.tsx",
        pins: [
          'import { useOnScreen } from "@/hooks/useOnScreen";',
          "ref={glow.ref}",
          "style={glow.style}",
        ],
      },
    ],
  },
  {
    renderSite: "src/pages/register.tsx",
    label: "register card",
    wiring: [
      {
        file: "src/pages/register.tsx",
        pins: [
          'import { useOnScreen } from "@/hooks/useOnScreen";',
          "ref={glow.ref}",
          "style={glow.style}",
        ],
      },
    ],
  },
  {
    renderSite: "src/pages/onboarding.tsx",
    label: "onboarding card",
    wiring: [
      {
        file: "src/pages/onboarding.tsx",
        pins: [
          'import { useOnScreen } from "@/hooks/useOnScreen";',
          "ref={glow.ref}",
          "style={glow.style}",
        ],
      },
    ],
  },
  {
    renderSite: "src/pages/profile.tsx",
    label: "profile identity card (enabled-gated on /me)",
    wiring: [
      {
        file: "src/pages/profile.tsx",
        pins: [
          "useOnScreen<HTMLDivElement>(!!user)",
          "ref={tierGlow.ref}",
          "style={tierGlow.style}",
        ],
      },
    ],
  },
  {
    renderSite: "src/components/wallet/BalanceCard.tsx",
    label: "wallet balance hero (page-owned observer, style flows down as props)",
    wiring: [
      {
        file: "src/pages/wallet.tsx",
        pins: [
          "useOnScreen<HTMLDivElement>(!!wallet)",
          "glowRef={balanceGlow.ref}",
          "glowStyle={balanceGlow.style}",
        ],
      },
      {
        file: "src/components/wallet/BalanceCard.tsx",
        pins: ["ref={glowRef}", "style={glowStyle}", "blob-drift"],
      },
    ],
  },
];

/** Recursive source census helper: every non-test .ts/.tsx under dir. */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files legitimately NAME blob-drift in pins/mocks — the
      // census guards RENDER sites only.
      if (entry.name === "__tests__") continue;
      listSourceFiles(full, acc);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every non-test source file that references blob-drift. Excludes the
 * hook itself (its doc-comment DEFINES the contract) and index.css
 * (keyframes definition, not a render site — .css is filtered by the
 * file extension walk). */
const blobDriftSites = listSourceFiles(resolve(process.cwd(), "src")).filter(
  (f) =>
    f !== resolve(process.cwd(), "src/hooks/useOnScreen.ts") &&
    readFileSync(f, "utf8").includes("blob-drift"),
);

describe("R140-d (a) — blob-pause fleet: every blob-drift site pauses off-screen", () => {
  it("the live census matches the pinned fleet one-to-one (a NEW blob-drift site must land here WITH pause wiring)", () => {
    const census = new Set(blobDriftSites);
    const fleet = new Set(BLOB_PAUSE_FLEET.map((site) => resolve(process.cwd(), site.renderSite)));
    for (const site of census) {
      expect(
        fleet.has(site),
        `blob-drift site with no fleet entry (add pause wiring + a fleet pin): ${site}`,
      ).toBe(true);
    }
    for (const file of fleet) {
      expect(census.has(file), `fleet entry no longer renders blob-drift: ${file}`).toBe(true);
    }
  });

  it("every fleet site keeps its use-on-screen observer + animation-play-state wiring", () => {
    for (const site of BLOB_PAUSE_FLEET) {
      for (const group of site.wiring) {
        const src = read(group.file);
        for (const pin of group.pins) {
          expect(src, `${group.file} (${site.label}): ${pin}`).toContain(pin);
        }
      }
    }
  });

  it("the shared hook initializes RUNNING (no flash-paused first frame) and observes with a 64px margin", () => {
    expect(HOOK).toContain("useState(true)");
    expect(HOOK).toContain('rootMargin: "64px"');
    expect(HOOK).toContain('animationPlayState: (onScreen ? "running" : "paused")');
  });
});

describe("R140-d (b/e) — home.tsx render-path hygiene + deferred/transition scheduling", () => {
  it("the typing stream is DEFERRED for the results grid while the filter bar's input stays URGENT", () => {
    expect(PAGE).toContain("useDeferredValue(searchInput)");
    // The grid consumes the deferred mirror…
    expect(PAGE).toContain("searchInput={deferredSearchInput}");
    // …and ONLY the grid: CatalogFiltersBar (which renders the input
    // itself) keeps the urgent value — the user's typing must never lag.
    expect(PAGE).toContain("searchInput={searchInput}");
  });

  it("both committed-search paths ride startTransition (pure scheduling — the input already shows the text)", () => {
    expect(PAGE).toContain("startTransition(() => {");
    expect(PAGE).toContain("setSearch(val.trim());");
    expect(PAGE).toContain("setSearch(query);");
  });

  it("the per-render ItemList LD construction is memoized (the category.tsx idiom — was rebuilt per keystroke)", () => {
    expect(PAGE).toContain("const itemListLd = useMemo(");
    expect(PAGE).toContain("...(itemListLd ? [itemListLd] : [])");
  });

  it("the orders slice is referentially stable (feeds the memoized strip instead of re-allocating per render)", () => {
    expect(PAGE).toContain(
      "const latestOrders = useMemo(() => recentOrders.slice(0, 4), [recentOrders]);",
    );
  });

  it("the pure hero/grid sections ride React.memo at the orchestration site", () => {
    expect(PAGE).toContain("memo(AuthedHero)");
    expect(PAGE).toContain("memo(RecentOrdersStrip)");
    expect(PAGE).toContain("const gridPropsEqual = (");
    expect(PAGE).toContain("memo(ProductsGrid, gridPropsEqual)");
    // GuestHero got the own-file idiom (it IS in this round's lane):
    expect(GUEST_HERO).toContain("export const GuestHero = memo(function GuestHero({");
  });
});

describe("R140-d (c) — GuestHero above-fold animation cost", () => {
  it("the drift keyframes animate TRANSFORM ONLY (no layout-thrashing properties in the loop)", () => {
    const drift = CSS.match(/@keyframes blob-drift \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(drift, "the blob-drift keyframes block must exist in index.css").not.toBe("");
    expect(drift).toMatch(/transform:/);
    expect(drift).not.toMatch(/\b(filter|top|left|right|bottom|width|height|margin|padding)\s*:/);
  });

  it("the above-fold blobs stay blob-drift/blob-drift-slow with the pause inline style", () => {
    expect(GUEST_HERO).toContain("blob-drift");
    expect(GUEST_HERO).toContain("blob-drift-slow");
    expect(GUEST_HERO).toContain('animationPlayState: heroOnScreen ? "running" : "paused"');
  });
});

describe("R140-d (d) — ChartsLoader: the recharts lazy boundary is real", () => {
  it("the dashboard bridge is a retry-wrapped DYNAMIC import (vendor-charts stays out of the route chunk)", () => {
    expect(CHARTS_LOADER).toContain("lazyWithRetry");
    expect(CHARTS_LOADER).toContain('import("recharts")');
    expect(CHARTS_LOADER).not.toMatch(/from ["']recharts["']/);
  });

  it("no static recharts import anywhere in the admin path (shell pages + chart components + the system twin)", () => {
    const adminFiles = [
      ...listSourceFiles(resolve(process.cwd(), "src/pages/admin")),
      ...listSourceFiles(resolve(process.cwd(), "src/components/admin")),
    ];
    expect(adminFiles.length).toBeGreaterThan(0);
    for (const file of adminFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `static recharts import defeats the ChartsLoader boundary: ${file}`).not.toMatch(
        /from ["']recharts["']/,
      );
    }
  });
});
