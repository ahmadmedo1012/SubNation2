/**
 * R-140-b — BOOT CRITICAL PATH & FONTS pin suite.
 *
 * Lane scope (agent 140-b): index.html · main.tsx · app/boot-head-start ·
 * public/init.js — the four files the first 6 seconds of every visit run
 * through, plus the font-loading truth that replaced the retired
 * PageSpeed "Google Fonts 57 KB third-party" finding.
 *
 * Source-scan pins in the r139-c/f/i idiom (stripComments for negative
 * guards — rationale comments NAME the retired strings, so raw absence
 * checks would false-fail on the retirement's own documentation). What
 * each block freezes:
 *
 *   1. index.html — the static-offline no-JS reveal (98-F7): the 6 s
 *      CSS timer (R128-IMP-4 — 2.5 s flashed the message on healthy
 *      slow boots), the self-contained style block, the init.js
 *      reference (ordered before the entry module), and the no-JS
 *      SEO baseline (canonical/og) that scrapers see.
 *   2. index.html — FONTS: zero external font origins, and NO
 *      statically hardcoded woff2 preload. The critical-face preloads
 *      (arabic 400/600/700 + latin 400) are BUILD-time injected by
 *      criticalPreloadInject in vite.config.ts because @fontsource
 *      emits content-hashed filenames — a hand-baked href in this
 *      template would 404 after the next font bump (verified live +
 *      dist in R-140-b; the emitted tags carry crossorigin +
 *      type="font/woff2" and the faces carry font-display: swap).
 *   3. main.tsx — the boot chain: boot-sentry buffers installed and
 *      scheduled BEFORE createRoot, direction lock, the synchronous
 *      static-offline removal, the three buffered React error
 *      handlers, the CartProvider→App render tree, the CSS import,
 *      and the idle deferral of WebVitals + analytics.
 *   4. index.css — the @fontsource import set is EXACTLY the 6
 *      contract faces (arabic + latin × 400/600/700): no 200/300/500,
 *      no vietnamese/latin-ext subsets, no aggregate imports (those
 *      would ship dead bytes and break the preload-set parity).
 *   5. public/init.js — the pre-paint theme class (sn_theme ===
 *      "light" only, try/catch'd) with NO service-worker
 *      registration (Workbox's injected registerSW.js owns that).
 *   6. boot-head-start ↔ home parity — the seeded query key
 *      `getListProductsQueryKey({ fields: "list" })` must match
 *      home.tsx's params construction byte-for-byte, or the boot
 *      prefetch silently seeds a cache entry home never reads (the
 *      96-F3 head-start becomes dead traffic). Plus the test-mode and
 *      admin gates, and the first-4 card-image warm window matching
 *      ProductCard's eager window.
 *   7. vite.config.ts (READ-ONLY lane — 140-c owns the file; the pins
 *      are deliberately narrow, stable contracts): the font preload
 *      emission set + tag shape. Flagged to 140-c in the worklog.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const INDEX_HTML_RAW = read("index.html");
const MAIN_TSX_RAW = read("src/main.tsx");
const INDEX_CSS_RAW = read("src/index.css");
const INIT_JS_RAW = read("public/init.js");
const BOOT_HEAD_START_RAW = read("src/app/boot-head-start.ts");
const HOME_TSX_RAW = read("src/pages/home.tsx");
const PRODUCT_CARD_RAW = read("src/components/ProductCard.tsx");
const VITE_CONFIG_RAW = read("vite.config.ts");

/** Line-comments-first stripper (the 139-i lesson: block-first opens
 *  phantom comments on `/*`-bearing URL strings). Handles //, /* *\/
 *  and bare ` * ` continuation lines for TS sources. */
function stripTsComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

/** Strip HTML comments — negative guards must not false-fire on the
 *  rationale comments, which NAME the banned patterns they document. */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

const INDEX_HTML = stripHtmlComments(INDEX_HTML_RAW);
const MAIN_TSX = stripTsComments(MAIN_TSX_RAW);
const INDEX_CSS = stripTsComments(INDEX_CSS_RAW);
const INIT_JS = stripTsComments(INIT_JS_RAW);
const BOOT_HEAD_START = stripTsComments(BOOT_HEAD_START_RAW);
const VITE_CONFIG = stripTsComments(VITE_CONFIG_RAW);

/** The same detector the bundle-budget build gate uses (mirrored from
 *  preload-gate.test.ts): every <script> tag WITHOUT a src attribute is
 *  a guaranteed helmet CSP violation in production (script-src has no
 *  'unsafe-inline' — the R126-L1 lesson). */
function countInlineScripts(html: string): number {
  return (
    html.replace(/<!--[\s\S]*?-->/g, "").match(/<script\b(?![^>]*[\s"']src[\s]*=)[^>]*>/gi) ?? []
  ).length;
}

// ── 1. index.html — static-offline no-JS reveal (98-F7 / R128-IMP-4) ────

describe("R-140-b: index.html — the static-offline reveal (98-F7)", () => {
  it("carries the no-JS message div with role=status + dir=rtl", () => {
    expect(INDEX_HTML_RAW).toContain(
      '<div id="static-offline" dir="rtl" role="status">يتطلب الموقع تشغيل JavaScript</div>',
    );
  });

  it("reveals on the 6 s CSS timer — the R128-IMP-4 value, not the old 2.5 s", () => {
    // 2.5 s flashed the message on healthy bandwidth-bound boots while
    // the entry + vendors were still in flight; 6 s sits past every
    // realistic online first paint. A regression to any faster timer
    // re-opens the live cosmetic bug R128-IMP-4 closed.
    // (Pinned as the FULL animation shorthand — duration, easing, delay
    // AND fill-mode — because the 2.5 s value survives inside the CSS
    // /* */ rationale comment, where a raw absence check false-fires.)
    const timer = INDEX_HTML_RAW.match(/animation:\s*sn-offline-reveal[^;]*;/)?.[0] ?? "";
    expect(timer).toBe("animation: sn-offline-reveal 0.4s ease 6s forwards;");
  });

  it("starts hidden (opacity 0) and animates to visible — pure CSS, no JS", () => {
    expect(INDEX_HTML_RAW).toMatch(/#static-offline\s*\{[^}]*opacity:\s*0;/);
    expect(INDEX_HTML_RAW).toMatch(
      /@keyframes sn-offline-reveal\s*\{\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
  });

  it("is self-contained — system-ui stack, no CSS-chunk dependency", () => {
    // A no-JS boot cannot rely on the bundled CSS: the style block
    // declares its own font stack and follows the OS color scheme.
    expect(INDEX_HTML_RAW).toMatch(/#static-offline\s*\{[^}]*font-family:[^}]*system-ui/);
    expect(INDEX_HTML_RAW).toMatch(/#static-offline\s*\{[^}]*color-scheme:\s*light dark/);
  });
});

// ── 1b. index.html — init.js + script order + CSP cleanliness ────────────

describe("R-140-b: index.html — init.js reference and script hygiene", () => {
  it("references /init.js (the pre-paint theme boot)", () => {
    expect(INDEX_HTML_RAW).toContain('<script src="/init.js"></script>');
  });

  it("init.js executes before the entry module is even fetched", () => {
    // The theme class must beat first paint; the entry module script
    // sits at the end of body. (The build-injected preload-gate script
    // ahead of init.js is pinned by preload-gate.test.ts.)
    const initAt = INDEX_HTML_RAW.indexOf('<script src="/init.js"></script>');
    const entryAt = INDEX_HTML_RAW.indexOf('<script type="module" src="/src/main.tsx"></script>');
    expect(initAt).toBeGreaterThanOrEqual(0);
    expect(entryAt).toBeGreaterThan(initAt);
  });

  it("ships ZERO inline scripts (helmet CSP has no unsafe-inline)", () => {
    expect(countInlineScripts(INDEX_HTML_RAW)).toBe(0);
  });

  it("declares the RTL Arabic document root", () => {
    expect(INDEX_HTML_RAW).toContain('<html lang="ar" dir="rtl">');
  });
});

// ── 1c. index.html — canonical / og no-JS baseline ────────────────────────

describe("R-140-b: index.html — the no-JS SEO baseline (canonical + og)", () => {
  it("canonical points at the apex origin (R117 consolidation signal)", () => {
    expect(INDEX_HTML_RAW).toContain(
      '<link data-rh="true" rel="canonical" href="https://subnation.ly/" />',
    );
  });

  it("og:image is absolute with real 1200×630 dims + large card", () => {
    // WhatsApp/Facebook scrapers silently DROP relative image URLs;
    // dims must declare the real file size (R120-B3 / R128-L2).
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:image" content="https://subnation.ly/opengraph.jpg" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:image:width" content="1200" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:image:height" content="630" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" name="twitter:card" content="summary_large_image" />',
    );
  });

  it("og:title/type present and the default title survives", () => {
    expect(INDEX_HTML_RAW).toContain(
      '<title data-rh="true">SubNation — سوق الاشتراكات الرقمية</title>',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:type" content="website" />',
    );
    expect(INDEX_HTML_RAW).toContain(
      '<meta data-rh="true" property="og:title" content="SubNation — سوق الاشتراكات الرقمية" />',
    );
  });
});

// ── 2. index.html — fonts: no external origins, no static preloads ───────

describe("R-140-b: index.html — font truth (self-hosted, pipeline preloads)", () => {
  it("references ZERO external font origins (Google Fonts fully retired)", () => {
    // The old PageSpeed report billed Google Fonts as a 57 KB
    // third-party; @fontsource self-hosting removed it entirely.
    // These guards keep any <link href="https://fonts.…"> from ever
    // creeping back into the shell.
    expect(INDEX_HTML).not.toContain("fonts.googleapis.com");
    expect(INDEX_HTML).not.toContain("fonts.gstatic.com");
    expect(INDEX_HTML).not.toMatch(/<link[^>]+href="https:\/\/fonts\./i);
  });

  it("carries NO statically hardcoded woff2 URL or font preload link", () => {
    // @fontsource emits content-hashed filenames that change on every
    // font bump — a hardcoded href would 404 (stale bytes + console
    // error on every boot). The critical-face preloads are injected at
    // BUILD time by criticalPreloadInject (vite.config.ts — pinned in
    // section 7 below). If this guard ever blocks a deliberate switch
    // to stable public/fonts/ URLs, replace it with a pin of THAT
    // decision — do not delete it silently.
    expect(INDEX_HTML).not.toMatch(/readex-pro-[^"']+\.woff2/);
    expect(INDEX_HTML).not.toMatch(/<link[^>]+rel="preload"[^>]+as="font"/);
  });
});

// ── 3. main.tsx — the boot chain ──────────────────────────────────────────

describe("R-140-b: main.tsx — boot chain integrity", () => {
  it("imports the boot-sentry trio and the app entry graph", () => {
    expect(MAIN_TSX).toContain('from "./lib/boot-sentry"');
    expect(MAIN_TSX).toContain("installBootErrorBuffer");
    expect(MAIN_TSX).toContain("bufferedReactErrorHandler");
    expect(MAIN_TSX).toContain("scheduleSentryBoot");
    expect(MAIN_TSX).toContain('import App from "./App"');
    expect(MAIN_TSX).toContain('import "./index.css"');
    expect(MAIN_TSX).toContain('from "./lib/cart"');
  });

  it("installs the error buffer and schedules Sentry BEFORE createRoot", () => {
    const install = MAIN_TSX.indexOf("installBootErrorBuffer();");
    const schedule = MAIN_TSX.indexOf("scheduleSentryBoot();");
    const root = MAIN_TSX.indexOf("createRoot(");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(schedule).toBeGreaterThan(install);
    expect(root).toBeGreaterThan(schedule);
  });

  it("removes the static-offline fallback synchronously before render", () => {
    const removal = MAIN_TSX.indexOf('document.getElementById("static-offline")?.remove();');
    const root = MAIN_TSX.indexOf("createRoot(");
    expect(removal).toBeGreaterThanOrEqual(0);
    expect(root).toBeGreaterThan(removal);
  });

  it("locks document direction to ar before React renders", () => {
    const dir = MAIN_TSX.indexOf('applyDocumentDirection("ar");');
    const root = MAIN_TSX.indexOf("createRoot(");
    expect(dir).toBeGreaterThanOrEqual(0);
    expect(root).toBeGreaterThan(dir);
  });

  it("wires all three React 19 error handlers to the buffering wrapper", () => {
    expect(MAIN_TSX).toContain("onUncaughtError: bufferedReactErrorHandler()");
    expect(MAIN_TSX).toContain("onCaughtError: bufferedReactErrorHandler()");
    expect(MAIN_TSX).toContain("onRecoverableError: bufferedReactErrorHandler()");
  });

  it("renders the CartProvider → App tree", () => {
    expect(MAIN_TSX).toMatch(
      /createRoot\([\s\S]*\.render\(\s*[\s\S]*<CartProvider>\s*<App \/>\s*<\/CartProvider>/,
    );
  });

  it("defers WebVitals + analytics past initial paint (idle tick)", () => {
    expect(MAIN_TSX).toMatch(
      /scheduleIdle\(\(\) => \{[\s\S]*?initWebVitals[\s\S]*?initAnalytics\(\);/,
    );
  });

  it("carries no stale 2.5 s reveal reference (the timer is 6 s)", () => {
    // The stale-comment class this round fixed: main.tsx documented a
    // 2.5 s reveal that index.html retired in R128-IMP-4. Comments
    // that lie about boot timers get audited against the CSS truth.
    expect(MAIN_TSX).not.toContain("2.5s");
  });
});

// ── 4. index.css — the @fontsource import set ─────────────────────────────

describe("R-140-b: index.css — fontsource faces = the contract set", () => {
  const FACES = [
    "arabic-400",
    "arabic-600",
    "arabic-700",
    "latin-400",
    "latin-600",
    "latin-700",
  ] as const;

  it.each([...FACES])("imports @fontsource/readex-pro/%s.css", (face) => {
    expect(INDEX_CSS).toContain(`@import "@fontsource/readex-pro/${face}.css";`);
  });

  it("imports EXACTLY the 6 contract faces — no other subset or weight", () => {
    // The design contract loads 400/600/700 only (font-medium /
    // font-black are banned because those weights never ship). Any
    // extra import (200/300/500, vietnamese, latin-ext, or the
    // aggregate 400.css — which pulls ALL subsets + unicode-ranges)
    // ships dead bytes AND desyncs the build-time preload set.
    const imported = [
      ...INDEX_CSS.matchAll(/@import\s+"@fontsource\/readex-pro\/([a-z-]+)-(\d+)\.css";/g),
    ].map((m) => `${m[1]}-${m[2]}`);
    expect(imported.sort()).toEqual([...FACES].sort());
  });
});

// ── 5. public/init.js — the pre-paint theme boot ──────────────────────────

describe("R-140-b: public/init.js — early theme class, nothing else", () => {
  it("reads sn_theme and adds .light ONLY on the light value", () => {
    // Dark is the no-class default; anything but the exact "light"
    // string must leave the document untouched.
    expect(INIT_JS).toContain('localStorage.getItem("sn_theme")');
    expect(INIT_JS).toContain('t === "light"');
    expect(INIT_JS).toContain('document.documentElement.classList.add("light")');
  });

  it("is storage-failure-safe (try/catch — private mode boots dark)", () => {
    expect(INIT_JS).toMatch(/try\s*\{[\s\S]*\}\s*catch\s*\([a-z]*\)\s*\{\s*\}/);
  });

  it("registers NO service worker (Workbox's registerSW.js owns that)", () => {
    // A second hand-rolled register() here raced the Workbox build
    // once before — the exact regression this file's header documents.
    expect(INIT_JS).not.toContain("serviceWorker");
  });
});

// ── 6. boot-head-start ↔ home parity (the silent-seeding guard) ───────────

describe("R-140-b: boot-head-start — gates and the home key parity", () => {
  it("seeds the EXACT key home's useListProducts consumes", () => {
    expect(BOOT_HEAD_START).toContain('getListProductsQueryKey({ fields: "list" })');
    // The consumer side: home builds its params object with the same
    // projection — a one-character drift ({} params, a missing fields
    // key, a different projection) hashes to a different key and the
    // boot prefetch becomes dead traffic home re-fetches anyway.
    expect(HOME_TSX_RAW).toContain('const params: Record<string, string> = { fields: "list" };');
    expect(HOME_TSX_RAW).toContain("getListProductsQueryKey(params)");
  });

  it("fires at module-eval time but never inside the test runner", () => {
    expect(BOOT_HEAD_START).toContain('import.meta.env.MODE !== "test"');
  });

  it("skips admin boots (the pre-leg admin gate)", () => {
    expect(BOOT_HEAD_START).toContain("bootPath.startsWith(`${routerBase}/admin/`)");
  });

  it("warms the same first-4 card images ProductCard renders eager", () => {
    // R127-L10: the warm window must match ProductCard's eager window
    // — warming more wastes cellular bytes, warming less leaves the
    // LCP cards paying the render-hop discovery cost again.
    expect(BOOT_HEAD_START).toContain("const BOOT_CARD_IMAGE_WARM_COUNT = 4;");
    expect(PRODUCT_CARD_RAW).toContain('loading={index < 4 ? "eager" : "lazy"}');
  });
});

// ── 7. vite.config.ts — the build-time font preload delegation ────────────
// Cross-lane pin (140-c owns vite.config.ts — flagged in the R-140-b
// worklog): these two contracts are what make the shell's font story
// complete, and no other suite pins them. Deliberately narrow.

describe("R-140-b: vite.config.ts — criticalPreloadInject emits the font preloads", () => {
  it("targets exactly arabic 400/600/700 + latin 400/700 (the above-the-fold set — R143 L3-3 added latin-700 for the Navbar wordmark)", () => {
    expect(VITE_CONFIG).toContain(
      "readex-pro-arabic-(400|600|700)-normal-[A-Za-z0-9_-]+\\.woff2$|readex-pro-latin-(400|700)-normal-[A-Za-z0-9_-]+\\.woff2$",
    );
  });

  it("emits preload links with as=font + type + crossorigin", () => {
    // crossorigin is REQUIRED: @font-face fetches are anonymous CORS
    // requests — a no-cors preload is a wasted double download.
    expect(VITE_CONFIG).toContain(
      '<link rel="preload" as="font" type="font/woff2" crossorigin href="/${name}" />',
    );
  });
});
