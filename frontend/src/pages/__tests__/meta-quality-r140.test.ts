/**
 * R-140-h — META QUALITY pin suite (per-page meta emission + the
 * in-place upsert mechanism).
 *
 * Lane scope (agent 140-h): hooks/useSeo.tsx · components/seo/MetaTags
 * · pages/status · pages/notifications · pages/not-found · pages/terms
 * — the per-page meta-quality sweep. product/category/home/support
 * emission is 140-g's lane (seo-builders.ts untouched here).
 *
 * Three pin families:
 *
 *   1. MECHANISM (behavioral, jsdom): MetaTags upserts meta
 *      robots noindex when the directive is passed, defaults to
 *      index,follow otherwise, updates tags IN PLACE across a route
 *      change (never duplicates), emits exactly ONE of every managed
 *      tag, collapses leftover <title> duplicates, emits
 *      og:locale=ar_LY (NOT the generic ar_AR) + og:site_name +
 *      per-route canonical/og:url, and clamps title/desc to 60/160.
 *   2. PAGE SHAPES (source-scan, the r139/r140 LINE-COMMENTS-FIRST
 *      idiom): the four lane pages' useSeo({…}) calls carry the
 *      expected title / 50–160 description / path / robots shape;
 *      every description is pairwise unique; the 404 canonical stays
 *      the /404 self-path; terms deliberately carries NO robots key
 *      (public → index,follow default).
 *   3. BELT-AND-BRACES MAP: robotsForPath (the App-level fallback's
 *      directive source) stamps noindex,follow on every robots.txt
 *      walled family, and every page-level useSeo on a walled route
 *      stamps noindex ITSELF (the page block beats the fallback).
 *      cart/checkout are outside this lane's file set — READ-ONLY
 *      cross-lane pins in the R-140-b/vite.config.ts tradition,
 *      flagged in the worklog.
 *
 * No duplicate-emission regressions: both behavioral (singleton counts
 * after a render + in-place update across a route change) and source
 * pins (every managed selector has exactly ONE upsert call site; the
 * og:image dims pair is the one deliberate two-site selector — upsert
 * + evict; creation happens only inside the if(!el) guard).
 *
 * .ts (not .tsx): the behavioral renders use createElement — no JSX.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MetaTags } from "@/components/seo/MetaTags";
import { robotsForPath } from "@/app/route-shapes";
import NotFound from "@/pages/not-found";
import TermsPage from "@/pages/terms";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Line-comments-first stripper (the r139-i craft lesson: block-first
 * opens phantom comments on `/*`-bearing strings and swallows pinned
 * code lines). Handles //, block comments and bare ` * ` continuation
 * lines. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

const STATUS_SRC = stripComments(read("src/pages/status.tsx"));
const NOTIFICATIONS_SRC = stripComments(read("src/pages/notifications.tsx"));
const NOT_FOUND_SRC = stripComments(read("src/pages/not-found.tsx"));
const TERMS_SRC = stripComments(read("src/pages/terms.tsx"));
const CART_SRC = stripComments(read("src/pages/cart.tsx"));
const CHECKOUT_SRC = stripComments(read("src/pages/checkout.tsx"));
const META_TAGS_SRC = stripComments(read("src/components/seo/MetaTags.tsx"));

/** Extract a page's `useSeo({ … })` call block. Every lane page's call
 * is a flat object literal — the first `})` after `useSeo({` is the
 * call's own closer (no nested parens/braces inside). */
function seoCall(src: string, label: string): string {
  const at = src.indexOf("useSeo({");
  expect(at, `${label}: no useSeo({ call found in source`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("})", at);
  expect(end, `${label}: unterminated useSeo({ call`).toBeGreaterThan(at);
  return src.slice(at, end + 2);
}

// ── The pinned copy (verbatim from the pages — Western digits, Arabic
//    copy byte-exact including diacritics and the «—» em-dash) ──────────

const STATUS_TITLE = "حالة المنصة — SubNation";
const STATUS_DESC = "حالة خدمات منصة SubNation المجمّعة، مع تحديث تلقائي دوري.";
const NOTIF_TITLE = "الإشعارات — SubNation";
const NOTIF_DESC = "كل تنبيهاتك — الطلبات، المحفظة، الدعم ونقاط الولاء — في مكان واحد.";
const NF_TITLE = "الصفحة غير موجودة — SubNation";
// R-140-h fix: was "الرابط الذي تحاول الوصول إليه غير موجود." — 40 chars,
// under the 50–160 quality band (WhatsApp unfurls read og:description).
const NF_DESC =
  "يبدو أن هذه الصفحة غير موجودة أو تم نقلها — تأكد من الرابط أو عد إلى الرئيسية لتتصفح المتجر.";
const TERMS_TITLE = "الشروط والأحكام — SubNation";
const PRIVACY_TITLE = "سياسة الخصوصية — SubNation";
const TERMS_DESC =
  "شروط استخدام منصة SubNation: سياسة الشراء، شحن المحفظة، الاشتراكات الرقمية، والاسترداد.";
const PRIVACY_DESC =
  "كيف يجمع SubNation بياناتك ويحميها أثناء استخدامك المتجر وشحن المحفظة وشراء الاشتراكات.";

// ── Head readers / reset (the seo-money-pages-r120 harness idiom) ──────

function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.content ?? null;
}

/** MetaTags never removes what it upserted on unmount (R122 A7) — start
 * every test from a clean managed-tag slate. Title first: jsdom's
 * document.title setter (re)creates the head's first <title>, which the
 * removal pass then clears. */
function resetHead(): void {
  document.title = "";
  document.head
    .querySelectorAll(
      [
        'meta[name="description"]',
        'meta[name="robots"]',
        'meta[name="viewport"]',
        'meta[name="theme-color"]',
        'meta[property^="og:"]',
        'meta[name^="twitter:"]',
        'link[rel="canonical"]',
        "title",
      ].join(", "),
    )
    .forEach((el) => el.remove());
}

beforeEach(() => {
  resetHead();
});

/** getAppOrigin()'s test-env path: no VITE_APP_ORIGIN override, so the
 * canonical/og URLs build on jsdom's own origin. */
const origin = (): string => window.location.origin;

// ── 1. MECHANISM — noindex + the in-place upsert contract ───────────────

describe("R-140-h mechanism — MetaTags robots + in-place upsert contract", () => {
  it("upserts EXACTLY ONE meta[name=robots] carrying the noindex directive (the runtime belt-and-braces)", () => {
    render(
      createElement(MetaTags, {
        title: STATUS_TITLE,
        description: STATUS_DESC,
        path: "/status",
        locale: "ar",
        robots: "noindex,follow",
      }),
    );

    const robots = document.head.querySelectorAll('meta[name="robots"]');
    expect(robots).toHaveLength(1);
    expect(robots[0].getAttribute("content")).toBe("noindex,follow");
  });

  it("default (no robots key) emits index,follow — the public-page default", () => {
    render(
      createElement(MetaTags, {
        title: TERMS_TITLE,
        description: TERMS_DESC,
        path: "/terms",
        locale: "ar",
      }),
    );

    expect(metaContent('meta[name="robots"]')).toBe("index,follow");
  });

  it("a route change UPDATES the surviving tags in place — never duplicates them", () => {
    // Page A (private) mounts, writes, unmounts — tags survive on purpose.
    const first = render(
      createElement(MetaTags, {
        title: NOTIF_TITLE,
        description: NOTIF_DESC,
        path: "/notifications",
        robots: "noindex,follow",
      }),
    );
    first.unmount();
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(metaContent('meta[name="robots"]')).toBe("noindex,follow");

    // Page B (public) upserts over them: still exactly ONE of each, with
    // B's values — the whole point of the V3-A1 head manager.
    render(
      createElement(MetaTags, {
        title: TERMS_TITLE,
        description: TERMS_DESC,
        path: "/terms",
        locale: "ar",
      }),
    );
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(metaContent('meta[name="robots"]')).toBe("index,follow");
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(metaContent('meta[name="description"]')).toBe(TERMS_DESC);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${origin()}/terms`,
    );
    expect(document.title).toBe(TERMS_TITLE);
  });

  it("one render writes EXACTLY ONE of every managed tag (single title/desc/og emission)", () => {
    render(
      createElement(MetaTags, {
        title: STATUS_TITLE,
        description: STATUS_DESC,
        path: "/status",
        locale: "ar",
        robots: "noindex,follow",
      }),
    );

    const singletons = [
      'meta[name="description"]',
      'meta[name="robots"]',
      'meta[name="viewport"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:type"]',
      'meta[property="og:url"]',
      'meta[property="og:image"]',
      'meta[property="og:image:width"]',
      'meta[property="og:image:height"]',
      'meta[property="og:locale"]',
      'meta[property="og:site_name"]',
      'meta[name="twitter:card"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
      'meta[name="twitter:image"]',
      'link[rel="canonical"]',
    ];
    for (const sel of singletons) {
      expect(document.head.querySelectorAll(sel), sel).toHaveLength(1);
    }
    // theme-color is the one two-value family (dark base + light media).
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("og:locale is ar_LY (the Libyan territory form, NOT the generic ar_AR) + og:site_name SubNation", () => {
    render(
      createElement(MetaTags, {
        title: TERMS_TITLE,
        description: TERMS_DESC,
        path: "/terms",
        locale: "ar",
      }),
    );

    expect(metaContent('meta[property="og:locale"]')).toBe("ar_LY");
    expect(metaContent('meta[property="og:site_name"]')).toBe("SubNation");
    // Per-route canonical + og:url ride the same path prop.
    expect(metaContent('meta[property="og:url"]')).toBe(`${origin()}/terms`);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${origin()}/terms`,
    );
  });

  it("omitting locale defaults to ar → og:locale=ar_LY (the notifications-page call shape)", () => {
    render(
      createElement(MetaTags, {
        title: NOTIF_TITLE,
        description: NOTIF_DESC,
        path: "/notifications",
        robots: "noindex,follow",
      }),
    );

    expect(metaContent('meta[property="og:locale"]')).toBe("ar_LY");
  });

  it("collapses duplicate <title> elements left behind by history (the one-title Lighthouse contract)", () => {
    const stale1 = document.createElement("title");
    stale1.textContent = "stale-1";
    const stale2 = document.createElement("title");
    stale2.textContent = "stale-2";
    document.head.appendChild(stale1);
    document.head.appendChild(stale2);

    render(
      createElement(MetaTags, {
        title: STATUS_TITLE,
        description: STATUS_DESC,
        path: "/status",
        robots: "noindex,follow",
      }),
    );

    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(document.title).toBe(STATUS_TITLE);
  });

  it("og:image dims are declared for the default card and EVICTED for an unknown-size caller image (R122 A7)", () => {
    const withDefault = render(
      createElement(MetaTags, {
        title: "عنوان",
        description: "وصف الاختبار الطويل بما يكفي",
        path: "/",
      }),
    );
    expect(metaContent('meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent('meta[property="og:image:height"]')).toBe("630");
    withDefault.unmount();

    render(
      createElement(MetaTags, {
        title: "عنوان",
        description: "وصف الاختبار الطويل بما يكفي",
        path: "/p",
        image: "/products/x.webp",
      }),
    );
    expect(document.head.querySelectorAll('meta[property="og:image:width"]')).toHaveLength(0);
    expect(document.head.querySelectorAll('meta[property="og:image:height"]')).toHaveLength(0);
    // …and the caller image is absolutized (AUD103-6-F1 — scrapers drop
    // relative image URLs).
    expect(metaContent('meta[property="og:image"]')).toBe(`${origin()}/products/x.webp`);
  });

  it("titles/descriptions are clamped to 60/160 at a word boundary (the bands are enforced mechanically)", () => {
    const longTitle = "عنوان طويل جداً ".repeat(10).trim();
    const longDesc = "وصف طويل جداً للصفحة ".repeat(20).trim();
    render(
      createElement(MetaTags, {
        title: longTitle,
        description: longDesc,
        path: "/",
      }),
    );

    expect(document.title.length).toBeLessThanOrEqual(60);
    expect(document.title.endsWith("…")).toBe(true);
    const desc = metaContent('meta[name="description"]');
    expect(desc).not.toBeNull();
    expect(desc!.length).toBeLessThanOrEqual(160);
    expect(desc!.endsWith("…")).toBe(true);
  });
});

// ── 2. PAGE SHAPES — the four lane pages' useSeo calls ─────────────────

describe("R-140-h page shapes — status (robot-walled, still titled for the tab + unfurls)", () => {
  it("noindex,follow + real tab title + 50–160 description + /status path + ar locale", () => {
    const call = seoCall(STATUS_SRC, "status");
    expect(call).toContain(`title: "${STATUS_TITLE}"`);
    expect(call).toContain(`description: "${STATUS_DESC}"`);
    expect(call).toContain('path: "/status"');
    expect(call).toContain('locale: "ar"');
    expect(call).toContain('robots: "noindex,follow"');
    // The 50–160 description band (57 chars today).
    expect(STATUS_DESC.length).toBeGreaterThanOrEqual(50);
    expect(STATUS_DESC.length).toBeLessThanOrEqual(160);
  });
});

describe("R-140-h page shapes — notifications (user-private)", () => {
  it("noindex,follow + sane tab title + 50–160 description + /notifications path", () => {
    const call = seoCall(NOTIFICATIONS_SRC, "notifications");
    expect(call).toContain(`title: "${NOTIF_TITLE}"`);
    expect(call).toContain(`description: "${NOTIF_DESC}"`);
    expect(call).toContain('path: "/notifications"');
    expect(call).toContain('robots: "noindex,follow"');
    expect(NOTIF_DESC.length).toBeGreaterThanOrEqual(50);
    expect(NOTIF_DESC.length).toBeLessThanOrEqual(160);
  });
});

describe("R-140-h page shapes — not-found (soft-404)", () => {
  it("real «الصفحة غير موجودة» title + noindex,follow + ar locale", () => {
    const call = seoCall(NOT_FOUND_SRC, "not-found");
    expect(call).toContain(`title: "${NF_TITLE}"`);
    expect(call).toContain('locale: "ar"');
    expect(call).toContain('robots: "noindex,follow"');
  });

  it("the description sits in the 50–160 band (R-140-h fix: was 40 chars)", () => {
    const call = seoCall(NOT_FOUND_SRC, "not-found");
    expect(call).toContain(`description: "${NF_DESC}"`);
    expect(NF_DESC.length).toBeGreaterThanOrEqual(50);
    expect(NF_DESC.length).toBeLessThanOrEqual(160);
    // and mirrors the visible body copy family (unfurl coherence).
    expect(NF_DESC).toContain("تم نقلها");
    expect(NF_DESC).toContain("الرئيسية");
  });

  it("canonical stays the /404 self-path — phantom URLs never consolidate onto the homepage canonical", () => {
    const call = seoCall(NOT_FOUND_SRC, "not-found");
    expect(call).toContain('path: "/404"');
    expect(call).not.toContain('path: "/"');
  });
});

describe("R-140-h page shapes — terms (public legal page, full meta)", () => {
  it("both tab titles + both tab descriptions, inside the ≤60 / 50–160 bands", () => {
    const call = seoCall(TERMS_SRC, "terms");
    expect(call).toContain(`title: isPrivacy ? "${PRIVACY_TITLE}" : "${TERMS_TITLE}"`);
    expect(call).toContain(`"${PRIVACY_DESC}"`);
    expect(call).toContain(`"${TERMS_DESC}"`);
    for (const t of [TERMS_TITLE, PRIVACY_TITLE]) {
      expect(t.length).toBeLessThanOrEqual(60);
    }
    for (const d of [TERMS_DESC, PRIVACY_DESC]) {
      expect(d.length).toBeGreaterThanOrEqual(50);
      expect(d.length).toBeLessThanOrEqual(160);
    }
    // Legal-intent keywords present (SERP/WA-quality check).
    expect(TERMS_DESC).toContain("شروط");
    expect(TERMS_DESC).toContain("الاسترداد");
    expect(PRIVACY_DESC).toContain("بياناتك");
  });

  it("carries the /terms path + ar locale + website type — and deliberately NO robots key (public default)", () => {
    const call = seoCall(TERMS_SRC, "terms");
    expect(call).toContain('path: "/terms"');
    expect(call).toContain('locale: "ar"');
    expect(call).toContain('type: "website"');
    expect(call).not.toContain("robots");
  });

  it("all five lane descriptions are pairwise unique (no shared boilerplate)", () => {
    const descs = [STATUS_DESC, NOTIF_DESC, NF_DESC, TERMS_DESC, PRIVACY_DESC];
    expect(new Set(descs).size).toBe(descs.length);
  });
});

// ── 3. BELT-AND-BRACES — the runtime noindex inventory ─────────────────

describe("R-140-h belt-and-braces — robotsForPath mirrors the robots.txt walls", () => {
  it("every robots.txt-walled family stamps noindex,follow through the App fallback", () => {
    const walled = [
      "/login",
      "/register",
      "/forgot-password",
      "/onboarding",
      "/auth/telegram-callback",
      "/cart",
      "/checkout",
      "/wallet",
      "/wallet/topup",
      "/orders",
      "/orders/ABC123",
      "/loyalty",
      "/referrals",
      "/profile",
      "/notifications",
      "/admin",
      "/admin/products",
      "/status",
    ];
    for (const p of walled) {
      expect(robotsForPath(p), p).toBe("noindex,follow");
    }
  });

  it("the public surface keeps index,follow", () => {
    const publicPaths = [
      "/",
      "/product/netflix-premium",
      "/category/streaming",
      "/support",
      "/terms",
      "/flash-sales",
    ];
    for (const p of publicPaths) {
      expect(robotsForPath(p), p).toBe("index,follow");
    }
  });

  it("every page-level useSeo on a robot-walled route stamps noindex ITSELF (the page block beats the fallback)", () => {
    // cart/checkout sources are READ-ONLY cross-lane pins (no r140 lane
    // owns their meta emission; flagged in the worklog for the
    // orchestrator) — the walled pages that mount a page-level block
    // must carry the directive themselves, or they would override the
    // fallback's noindex with the index,follow default.
    const lanes: Array<[string, string]> = [
      ["cart", CART_SRC],
      ["checkout", CHECKOUT_SRC],
      ["notifications", NOTIFICATIONS_SRC],
      ["status", STATUS_SRC],
    ];
    for (const [label, src] of lanes) {
      expect(seoCall(src, label)).toContain('robots: "noindex,follow"');
    }
  });
});

// ── 4. NO DUPLICATE-EMISSION PATH — source pins on the upsert code ─────

describe("R-140-h upsert code — no duplicate-emission path (source pins)", () => {
  it("every managed selector has EXACTLY ONE upsert call site", () => {
    const selectors = [
      'meta[name="description"]',
      'meta[name="robots"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:type"]',
      'meta[property="og:url"]',
      'meta[property="og:image"]',
      'meta[property="og:locale"]',
      'meta[property="og:site_name"]',
      'meta[name="twitter:card"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
      'meta[name="twitter:image"]',
    ];
    for (const sel of selectors) {
      // NB: 'meta[property="og:image"]' does NOT substring-match the
      // dims pair 'meta[property="og:image:width"]' — the closing quote
      // anchors it.
      expect(META_TAGS_SRC.split(sel).length - 1, sel).toBe(1);
    }
  });

  it("the og:image dims pair is the ONE deliberate two-site selector: upsert + evict", () => {
    for (const sel of ['meta[property="og:image:width"]', 'meta[property="og:image:height"]']) {
      // one upsertMeta call site + one removeMeta eviction call site —
      // the R122 A7 contract (a page without known dims must actively
      // evict the previous page's stale declaration).
      expect(META_TAGS_SRC.split(sel).length - 1, sel).toBe(2);
    }
  });

  it("setTitle collapses leftover <title> duplicates (the one-title contract)", () => {
    expect(META_TAGS_SRC).toContain('document.head.querySelectorAll("title")');
    expect(META_TAGS_SRC).toContain("if (i > 0) t.remove();");
  });

  it("tag creation happens ONLY inside the if(!el) guard — update-in-place otherwise", () => {
    expect(META_TAGS_SRC).toMatch(/if \(!el\) \{\s*el = document\.createElement\("meta"\);/);
    expect(META_TAGS_SRC).toMatch(/if \(!el\) \{\s*el = document\.createElement\("link"\);/);
  });

  it("the canonical is upserted through ONE upsertLink call site", () => {
    expect(META_TAGS_SRC.split('upsertLink("canonical"').length - 1).toBe(1);
  });
});

// ── 5. REAL PAGE RENDERS — the 404 and the legal page emit their meta ──

describe("R-140-h real render — the 404 page emits its meta (noindex + /404 canonical)", () => {
  it("title, noindex,follow, shareable description, /404 canonical, og mirrors", () => {
    render(createElement(NotFound));

    expect(document.title).toBe(NF_TITLE);
    expect(metaContent('meta[name="robots"]')).toBe("noindex,follow");
    expect(metaContent('meta[name="description"]')).toBe(NF_DESC);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${origin()}/404`,
    );
    // The og set mirrors title/desc (a mistyped-link WhatsApp share
    // still unfurls coherently — R-140-h's desc fix).
    expect(metaContent('meta[property="og:title"]')).toBe(NF_TITLE);
    expect(metaContent('meta[property="og:description"]')).toBe(NF_DESC);
    expect(metaContent('meta[property="og:locale"]')).toBe("ar_LY");
  });
});

describe("R-140-h real render — the public terms page emits full indexable meta", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/terms");
  });

  it("terms tab: title, 50–160 description, index,follow default, fragment-free /terms canonical, og set", () => {
    render(createElement(TermsPage));

    expect(document.title).toBe(TERMS_TITLE);
    expect(metaContent('meta[name="robots"]')).toBe("index,follow");
    expect(metaContent('meta[name="description"]')).toBe(TERMS_DESC);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${origin()}/terms`,
    );
    expect(metaContent('meta[property="og:locale"]')).toBe("ar_LY");
    expect(metaContent('meta[property="og:site_name"]')).toBe("SubNation");
    expect(metaContent('meta[property="og:type"]')).toBe("website");
    expect(metaContent('meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent('meta[property="og:image:height"]')).toBe("630");
  });

  it("the #privacy deep-link reports the privacy title/description (the CTR signal)", () => {
    window.history.pushState({}, "", "/terms#privacy");
    render(createElement(TermsPage));

    expect(document.title).toBe(PRIVACY_TITLE);
    expect(metaContent('meta[name="description"]')).toBe(PRIVACY_DESC);
    // Canonical stays fragment-free /terms (R124-I4 A10 #4).
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${origin()}/terms`,
    );
    expect(metaContent('meta[property="og:url"]')).toBe(`${origin()}/terms`);
  });

  it("switching tabs live-switches the title/description (MetaTags' effect re-runs on input change)", () => {
    render(createElement(TermsPage));

    fireEvent.click(screen.getByRole("button", { name: /سياسة الخصوصية/ }));

    expect(document.title).toBe(PRIVACY_TITLE);
    expect(metaContent('meta[name="description"]')).toBe(PRIVACY_DESC);
    expect(metaContent('meta[name="robots"]')).toBe("index,follow");
  });
});
