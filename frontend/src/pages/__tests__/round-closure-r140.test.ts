/**
 * R140-p — ROUND CLOSURE pins (the r140 consolidation freeze, part 2).
 *
 * THE RESIDUAL FIXES this suite freezes (both were open FLAGS the
 * round's waves left for the consolidation agent):
 *
 *   (a) MOBILENAV CART-ANNOUNCE DOUBLE (140-k's flag): the desktop
 *       Navbar's R-140-k sr-only announcer speaks «أُضيف إلى السلة —
 *       N منتجات» on EVERY viewport (the header's right-actions row
 *       is never display:none), so MobileNav's own bare-number polite
 *       region double-announced on phones (contextual sentence +
 *       contextless "3"). CLOSED with the same R-140-k treatment the
 *       Navbar's badge received: the badge span is aria-hidden visual
 *       chrome, the R128-IMP-4 wrapper keeps its polite contract (the
 *       storefront-chrome-r120 pin reads it), and the count's honest
 *       exposures are the tab's accessible name («السلة، N منتجات»)
 *       + the Navbar announcer — ONE sentence source across the nav
 *       fleet, no per-tab announcer region to drift from it.
 *
 *   (b) STATIC OG BASELINE (140-h's flag): the runtime MetaTags emits
 *       og:locale / og:site_name / og:url on every route; the static
 *       no-JS layer (link unfurlers, strict OG consumers) shipped
 *       none of the three. index.html now carries them beside the
 *       static og set, baked to the production origin exactly like
 *       the og:image line.
 *
 * THE CROSS-CUTTING GAINS frozen here (no suite protected them yet):
 *
 *   • SECTION-RULE /20 UNIFICATION — the storefront's non-money
 *     section rules joined the ONE documented hairline family (/20,
 *     the receipt-grade precedent; the 140-e flag the orchestrator
 *     closed): TrustFooter, RecentOrdersStrip bands+rows (skeleton +
 *     loaded twins), FaqSection, not-found. The CatalogFiltersBar
 *     mobile chrome seam deliberately STAYS /15 — it is functional
 *     chrome receding (the R138 softening verdict), not a section
 *     rule; pinned so nobody "finishes" the sweep past its boundary.
 *   • AUTHEDHERO — exactly one h1 (the page-anchor contract).
 *   • LyPayFlow — the R-140-j focus-retention twin (ref + flight
 *     effect): a failed submit re-lands focus on the re-enabled CTA.
 *   • SPA-SHELL — the backend static shell's /notifications noindex
 *     wall (the 140-m flag the orchestrator closed): the regex family
 *     keeps the non-rendering-crawler story in parity with robots.txt
 *     + the SPA's own MetaTags stamp.
 *
 * Source-scan craft (r139/r140 LINE-COMMENTS-FIRST stripper) — the
 * negative guards run against comment-stripped sources because the
 * rationale comments NAME the retired tokens; the comment pins read
 * raw. The MobileNav render test uses the createElement idiom (the
 * 140-g/140-h .ts harness — JSX-free on purpose).
 */
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "@/components/layout/MobileNav";

// ── Shared mock state (the storefront-chrome-r120 idiom) ───────────────────
const authState = vi.hoisted(() => ({ token: null as string | null }));
const cartState = vi.hoisted(() => ({ itemCount: 0 }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, logout: () => {} }),
}));

vi.mock("@/lib/cart", () => ({
  // MobileNav rides the state-only context split (R111-F4-F1) —
  // useCartState is the only cart import it owns.
  useCartState: () => ({
    items: [],
    itemCount: cartState.itemCount,
    totalLYD: 0,
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/use-keyboard-visibility", () => ({
  useKeyboardVisibility: () => false,
}));

beforeEach(() => {
  authState.token = "test-token";
  cartState.itemCount = 2;
  window.history.pushState({}, "", "/");
});

// ── Source-scan fixtures ───────────────────────────────────────────────────
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** LINE-COMMENTS-FIRST stripper (the 140-g lesson: prose globs must
 *  never open phantom block comments). */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function live(rel: string): string {
  return stripComments(read(rel));
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

const MOBILE_NAV_RAW = read("src/components/layout/MobileNav.tsx");
const MOBILE_NAV = stripComments(MOBILE_NAV_RAW);
const NAVBAR = live("src/components/layout/Navbar.tsx");
const INDEX_HTML_RAW = read("index.html");
const INDEX_HTML = stripHtmlComments(INDEX_HTML_RAW);
const META_TAGS = live("src/components/seo/MetaTags.tsx");
const TRUST_FOOTER_RAW = read("src/components/home/TrustFooter.tsx");
const TRUST_FOOTER = stripComments(TRUST_FOOTER_RAW);
const RECENT_ORDERS_STRIP = live("src/components/home/RecentOrdersStrip.tsx");
const RECENT_ORDERS_STRIP_RAW = read("src/components/home/RecentOrdersStrip.tsx");
const FAQ_SECTION = live("src/components/support/FaqSection.tsx");
const NOT_FOUND = live("src/pages/not-found.tsx");
const CATALOG_FILTERS_BAR = live("src/components/home/CatalogFiltersBar.tsx");
const AUTHED_HERO = live("src/components/home/AuthedHero.tsx");
const LY_PAY_FLOW = live("src/components/wallet/LyPayFlow.tsx");
// The backend static shell — read cross-repo from the frontend cwd
// (vitest runs from frontend/; spa-shell.ts is the orchestrator-owned
// backend source the task's source-scan explicitly licenses).
const SPA_SHELL = read("../backend/src/lib/spa-shell.ts");

// ── (a) MobileNav — ONE announcement source across the nav fleet ───────────

describe("R-140-p (a) — MobileNav cart tab: no double announcement (140-k's flag, closed)", () => {
  it("the tab keeps the R128-IMP-4 wrapper contract: stable polite region, textContent = the badge number", () => {
    // storefront-chrome-r120:373 parity — the STABLE icon wrapper (not
    // the key-remounted badge span) carries aria-live="polite".
    const { container } = render(createElement(Router, null, createElement(MobileNav)));
    expect(container.querySelector("nav")).not.toBeNull();
    const cartTab = screen.getByRole("link", { name: "السلة، 2 منتجان" });
    const liveRegion = cartTab.querySelector('span[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe("2");
  });

  it("the badge span is aria-hidden visual chrome — the bare number cannot double-announce on phones", () => {
    // The Navbar's R-140-k sr-only announcer speaks the contextual
    // sentence on EVERY viewport; a second, contextless "2" from this
    // tab was the pre-r140 double. Same treatment the Navbar's badge
    // received (byte-consistent idiom): the span is hidden from AT.
    const { container } = render(createElement(Router, null, createElement(MobileNav)));
    expect(container.querySelector("nav")).not.toBeNull();
    const cartTab = screen.getByRole("link", { name: "السلة، 2 منتجان" });
    const badgeSpan = cartTab.querySelector('span[aria-live="polite"]')!.querySelector("span");
    expect(badgeSpan).toHaveAttribute("aria-hidden", "true");
    // The count's OTHER honest exposure survives: the tab's accessible
    // name (focus/navigation) — same plural words as the announcer.
    expect(cartTab).toHaveAttribute("href", "/cart");
  });

  it("source: NO per-tab announcer — no sr-only region, no assertive literal, no cartChangeAnnouncement import", () => {
    // The single-sentence-source contract: the Navbar owns the
    // cartChangeAnnouncement wiring; a per-tab copy would drift (two
    // effects, two plural tables, two load gates) AND re-open the
    // double on phones. The wrapper's polite contract above stays —
    // it is silent (its only text-bearing child is aria-hidden).
    expect(MOBILE_NAV).not.toContain("sr-only");
    expect(MOBILE_NAV).not.toContain("cartChangeAnnouncement");
    expect(MOBILE_NAV).not.toContain('role="alert"');
    expect(MOBILE_NAV).not.toContain('aria-live="assertive"');
    // The fix marker + the aria-hidden badge exist in the live markup.
    expect(MOBILE_NAV).toContain('aria-hidden="true"');
    expect(MOBILE_NAV_RAW).toContain("R-140-p: aria-hidden — see the wrapper comment above.");
  });

  it("source: the Navbar keeps the ONE sentence source — the fleet contract is Navbar-owns, MobileNav-never", () => {
    // live-regions-r140 pins the full wiring (effect, load gate,
    // region); this pin closes the loop from the MobileNav side: the
    // announcer call site exists in Navbar and nowhere else in the
    // bottom nav.
    expect(NAVBAR).toContain("cartChangeAnnouncement(prevCartCountRef.current, itemCount)");
    expect(NAVBAR).toContain('div aria-live="polite" role="status" className="sr-only"');
  });
});

// ── (b) index.html — the static og identity baseline ───────────────────────

describe("R-140-p (b) — the static og baseline carries locale + site_name + url (140-h's flag, closed)", () => {
  it("og:locale ar_LY, og:site_name SubNation, og:url https://subnation.ly/ — the data-rh static-marker style", () => {
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:locale" content="ar_LY" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:site_name" content="SubNation" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:url" content="https://subnation.ly/" />',
    );
    // The territory form, NOT Facebook's generic ar_AR pseudo-locale
    // (the R-140-h verdict; comment-stripped so this pin can never
    // false-fire on the rationale comment that names ar_AR).
    expect(INDEX_HTML).not.toContain("ar_AR");
  });

  it("the three sit NEXT to the static og set — after og:type, mirroring the runtime emission order", () => {
    const ogType = INDEX_HTML_RAW.indexOf('property="og:type"');
    const ogLocale = INDEX_HTML_RAW.indexOf('property="og:locale"');
    const ogSiteName = INDEX_HTML_RAW.indexOf('property="og:site_name"');
    const ogUrl = INDEX_HTML_RAW.indexOf('property="og:url"');
    expect(ogType).toBeGreaterThanOrEqual(0);
    expect(ogLocale).toBeGreaterThan(ogType);
    expect(ogSiteName).toBeGreaterThan(ogLocale);
    expect(ogUrl).toBeGreaterThan(ogSiteName);
    // og:url agrees with the static canonical + the og:image origin
    // (the R117 apex consolidation signal).
    expect(INDEX_HTML_RAW).toContain(
      '<link data-rh="true" rel="canonical" href="https://subnation.ly/" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:image" content="https://subnation.ly/opengraph.jpg" />',
    );
  });

  it("runtime parity: MetaTags upserts the SAME three selectors in place — the static layer stays the no-JS mirror", () => {
    // The static tags are not a second vocabulary: each carries the
    // exact property key the runtime upsertMeta finds by selector, so
    // a JS boot rewrites them per route in place (no duplicate og set
    // ever ships — the V3-A1 upsert contract).
    expect(META_TAGS).toContain(
      'upsertMeta(\'meta[property="og:url"]\', "property", "og:url", url)',
    );
    expect(META_TAGS).toContain(
      'upsertMeta(\'meta[property="og:locale"]\', "property", "og:locale", ogLocale)',
    );
    expect(META_TAGS).toContain(
      'upsertMeta(\'meta[property="og:site_name"]\', "property", "og:site_name", "SubNation")',
    );
    // The runtime locale emission stays the territory form.
    expect(META_TAGS).toContain('const ogLocale = lang === "ar" ? "ar_LY" : "en_US";');
  });
});

// ── Section rules — the ONE /20 hairline family ────────────────────────────

describe("R140 central — non-money section rules joined the /20 hairline family (140-e's flag, closed)", () => {
  it("TrustFooter's band + RecentOrdersStrip's bands & rows (skeleton + loaded twins) ride /20", () => {
    // The family value: /20, the FINAL_UX_SYSTEM receipt-grade
    // precedent terms + Footer band already rode — no second value
    // invented, hairline weight never encodes money-ness.
    expect(TRUST_FOOTER).toContain("border-t border-border/20");
    expect(TRUST_FOOTER_RAW).toContain(
      "R140 central: the section rule joins the ONE hairline family",
    );
    expect(RECENT_ORDERS_STRIP.match(/border-b border-border\/20/g)).toHaveLength(2);
    expect(RECENT_ORDERS_STRIP.match(/divide-y divide-border\/20/g)).toHaveLength(2);
    expect(RECENT_ORDERS_STRIP_RAW.match(/R140 central/g)).toHaveLength(4);
    // The retired /25 band value is gone (the avatar image-well's
    // border-border/25 at :101 is a card-internal element border, not
    // a section rule — the negative is scoped to the band shape).
    expect(RECENT_ORDERS_STRIP).not.toContain("border-b border-border/25");
    expect(TRUST_FOOTER).not.toContain("border-t border-border/25");
    // The pre-fix nested-row grade (/15) joined the family too.
    expect(RECENT_ORDERS_STRIP).not.toContain("divide-border/15");
  });

  it("FaqSection's answer divider + not-found's quick-links rule ride /20 (the /40 scatter is gone)", () => {
    expect(FAQ_SECTION).toContain("border-t border-border/20");
    expect(FAQ_SECTION).not.toContain("border-t border-border/40");
    expect(NOT_FOUND).toContain("border-t border-border/20");
    expect(NOT_FOUND).not.toContain("border-t border-border/40");
  });

  it("CatalogFiltersBar's mobile chrome seam STAYS /15 — functional chrome receding, not a section rule", () => {
    // The R138 live-audit verdict: the sticky bar reads as functional
    // navigation, so its resting seam sits one step BELOW the family
    // on purpose. The sweep's boundary is deliberate — completing it
    // blindly would re-weigh the chrome the softening round retired.
    expect(CATALOG_FILTERS_BAR).toContain("border-b border-border/15");
    expect(CATALOG_FILTERS_BAR).not.toContain("border-border/20");
  });
});

// ── AuthedHero — exactly one h1 ────────────────────────────────────────────

describe("R140 — AuthedHero: the page anchor is exactly one h1", () => {
  it("the component source mounts a single <h1> (no twin anchors, no heading demotion)", () => {
    // The home route renders GuestHero OR AuthedHero — one hero, one
    // h1, the document's anchor heading (semantics-depth-r140 owns
    // the page-level contract; this freezes the component's shape).
    expect(AUTHED_HERO.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(AUTHED_HERO).toContain("text-fluid-2xl font-bold text-primary-text");
  });
});

// ── LyPayFlow — the focus-retention twin ───────────────────────────────────

describe("R140-j — LyPayFlow: the focus-retention twin survives (ref + flight effect)", () => {
  it("a failed submit re-lands focus on the re-enabled CTA (the MobileTransferForm twin)", () => {
    // The bank flow's CTA disabled on flight drops focus to <body>;
    // the twin effect re-lands it when the flight clears with an
    // error mounted — immediate Enter retries ride the idempotency
    // key. Both halves of the twin (the refs + the effect) must stay.
    expect(LY_PAY_FLOW).toContain("const submitRef = useRef<HTMLButtonElement>(null);");
    expect(LY_PAY_FLOW).toContain("const flightRef = useRef(false);");
    expect(LY_PAY_FLOW).toContain("if (error) submitRef.current?.focus();");
    expect(LY_PAY_FLOW).toContain(
      "if (submitting || mutationPending) {\n      flightRef.current = true;",
    );
  });
});

// ── spa-shell — the /notifications noindex wall ────────────────────────────

describe("R140 central — the backend static shell walls /notifications (140-m's flag, closed)", () => {
  it("SHELL_NOINDEX_RES carries the /notifications regex beside its family", () => {
    // The hydrated SPA stamps noindex,follow (MetaTags) and robots.txt
    // Disallows /notifications, but the static shell stamped
    // index,follow — telling non-rendering engines the opposite. The
    // wall keeps the three layers in parity; `noindex,follow` (not
    // none) so crawlers keep walking outbound links.
    expect(SPA_SHELL).toContain("/^\\/notifications(\\/|$)/");
    expect(SPA_SHELL).toContain("R140 central (140-m flag): the notifications wall");
    // The family shape stays intact (the same walls the frontend
    // NOINDEX_ROUTES + robots.txt mirror).
    expect(SPA_SHELL).toContain("/^\\/login$/");
    expect(SPA_SHELL).toContain("/^\\/admin(\\/|$)/");
    expect(SPA_SHELL).toContain("SHELL_NOINDEX_RES");
  });
});
