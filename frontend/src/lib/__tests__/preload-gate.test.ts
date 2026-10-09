// @vitest-environment node
//
// NODE env (not jsdom) on purpose: this suite imports vite.config.ts
// (the gate constants + pure transforms live there — single source of
// truth), which transitively loads vite/esbuild; esbuild asserts a
// TextEncoder/Uint8Array realm invariant that vitest's jsdom
// environment breaks. Nothing here needs the global jsdom env anyway —
// the runtime-gating tests construct their own JSDOM windows.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  PRELOAD_GATE_ASSET_FILE,
  PRELOAD_GATE_SOURCE,
  buildPreloadGateTag,
  injectPreloadGate,
} from "../../../vite.config";

/**
 * R126-L1 (A11-F1) regression tests for the EXTERNAL home-chunk preload
 * gate.
 *
 * R125 shipped the admin gate as an INLINE <script> injected right after
 * <head> in the built index.html; helmet's CSP (backend/src/app.ts
 * script-src, no 'unsafe-inline') blocked it on 100% of boots — a CSP
 * console error on every storefront visit, the 2 deterministic live e2e
 * failures (home.spec.ts "no console errors", desktop + mobile-390) and
 * a fully inert optimization. The gate is now an external, content-
 * hashed classic script under /assets/ (immutable cache) with the
 * per-build hashed home-chunk URL(s) delivered via a data-* attribute —
 * CSP-clean, no inline JS anywhere in the shell.
 *
 * Idiom: the seo-head-inject tests — the pure transform is fed the REAL
 * index.html template (plus a fixture with the built head shape), and
 * the emitted gate SOURCE is executed in a fresh JSDOM per path to pin
 * the runtime gating (append on storefront boots, nothing on /admin).
 * The build itself additionally hard-fails on any src-less <script> in
 * the built index.html (bundle-budget plugin, same detector as the
 * countInlineScripts helper below).
 */

/** The REAL source template the Vite plugin transforms at build time. */
function realIndexHtml(): string {
  // Vitest cwd is the frontend package root.
  return readFileSync(resolve(process.cwd(), "index.html"), "utf8");
}

/**
 * The BUILT head shape (dist-verified R126): Vite injects the entry
 * module script, the vendor modulepreload links and the stylesheet
 * AFTER the source's init.js tag. The gate tag must precede them all —
 * a classic script that FOLLOWS a pending stylesheet waits for that
 * stylesheet, which would push the home fetch behind the CSS.
 */
function builtHeadFixture(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head>
    <script src="/init.js"></script>
    <script type="module" crossorigin src="/assets/index-T3stHa5h.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-T3stHa5h.js">
    <link rel="stylesheet" crossorigin href="/assets/index-T3stHa5h.css">
  </head><body><div id="root"></div></body></html>`;
}

/**
 * The same detector the bundle-budget build gate uses: every <script>
 * tag WITHOUT a src attribute is a guaranteed helmet CSP violation in
 * production (inline code + script-src without 'unsafe-inline').
 */
function countInlineScripts(html: string): number {
  return (
    html.replace(/<!--[\s\S]*?-->/g, "").match(/<script\b(?![^>]*[\s"']src[\s]*=)[^>]*>/gi) ?? []
  ).length;
}

/**
 * Execute the gate source inside a fresh JSDOM at the given URL and
 * return the modulepreload hrefs it appended to document.head.
 * runScripts:"outside-only" keeps the fixture page inert; the gate runs
 * via window.eval — hermetic, no network, exactly the source the build
 * emits as /assets/preload-gate-*.js.
 */
function runGate(url: string, scriptTag: string): string[] {
  const dom = new JSDOM(`<!doctype html><html><head>${scriptTag}</head><body></body></html>`, {
    url,
    runScripts: "outside-only",
  });
  dom.window.eval(PRELOAD_GATE_SOURCE);
  return Array.from(dom.window.document.querySelectorAll('link[rel="modulepreload"]')).map(
    (link) => link.getAttribute("href") ?? "",
  );
}

/** A realistic bundle key — the hash charset includes `_` (base64url). */
const HOME = "assets/home-CSpReFIX.js";

describe("buildPreloadGateTag — the injected tag shape", () => {
  it("emits an EXTERNAL script: src + data-home-chunk, empty body (no inline JS)", () => {
    expect(buildPreloadGateTag([HOME])).toBe(
      `<script src="/${PRELOAD_GATE_ASSET_FILE}" data-home-chunk="/${HOME}"></script>`,
    );
  });

  it("references the emitted /assets/ gate asset, not an unhashed public path", () => {
    // /assets/* is the backend's immutable 1y cache family (app.ts
    // express.static "/assets" maxAge 1y immutable); the gate code is
    // only ever fetched uncached on a visitor's FIRST boot.
    expect(buildPreloadGateTag([HOME])).toMatch(
      new RegExp(`<script src="/assets/preload-gate-[A-Za-z0-9_-]{8}\\.js" `),
    );
  });

  it("joins multiple home chunks space-separated (plural-proof like the R125 loop)", () => {
    const tag = buildPreloadGateTag([HOME, "assets/home-Zz9_.js"]);
    expect(tag).toContain(`data-home-chunk="/${HOME} /assets/home-Zz9_.js"`);
  });
});

describe("PRELOAD_GATE_ASSET_FILE — content-addressed asset name", () => {
  it("lives under assets/ with an 8-char hash (matches Vite's own charset)", () => {
    expect(PRELOAD_GATE_ASSET_FILE).toMatch(/^assets\/preload-gate-[A-Za-z0-9_-]{8}\.js$/);
  });

  it("hashes the SOURCE, not the build — stable across builds until the code changes", () => {
    const expected = `assets/preload-gate-${createHash("sha256")
      .update(PRELOAD_GATE_SOURCE)
      .digest("base64url")
      .slice(0, 8)}.js`;
    expect(PRELOAD_GATE_ASSET_FILE).toBe(expected);
  });
});

describe("injectPreloadGate — anchor + CSP cleanliness", () => {
  it("injects into the REAL index.html right after <head> opens, before every other head child", () => {
    const out = injectPreloadGate(realIndexHtml(), [HOME]);
    const gateAt = out.indexOf(buildPreloadGateTag([HOME]));

    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeGreaterThan(out.indexOf("<head>"));
    // Before the template's first real head child AND before init.js.
    expect(gateAt).toBeLessThan(out.indexOf("<meta charset"));
    expect(gateAt).toBeLessThan(out.indexOf('src="/init.js"'));
  });

  it("precedes the Vite-injected stylesheet in the built head shape (R125 wait-on-stylesheet rule)", () => {
    const out = injectPreloadGate(builtHeadFixture(), [HOME]);
    const gateAt = out.indexOf(buildPreloadGateTag([HOME]));

    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(out.indexOf('<link rel="stylesheet"'));
    expect(gateAt).toBeLessThan(out.indexOf('type="module"'));
  });

  it("leaves ZERO src-less inline scripts — helmet CSP has nothing to block", () => {
    expect(countInlineScripts(injectPreloadGate(realIndexHtml(), [HOME]))).toBe(0);
    expect(countInlineScripts(injectPreloadGate(builtHeadFixture(), [HOME]))).toBe(0);
  });

  it("returns the input untouched with no home chunks (nothing to gate)", () => {
    expect(injectPreloadGate(realIndexHtml(), [])).toBe(realIndexHtml());
  });

  it("returns the input untouched when there is no <head> to anchor against", () => {
    const noHead = "<div>no head here</div>";
    expect(injectPreloadGate(noHead, [HOME])).toBe(noHead);
  });
});

describe("the inline-script detector (canary for the build-time rule)", () => {
  it("flags the R125 inline gate — the exact regression A11-F1 found live", () => {
    const r125Gate = `<head><script>if(!location.pathname.startsWith("/admin")){document.head.appendChild(Object.assign(document.createElement("link"),{rel:"modulepreload",href:"/assets/home-x.js"}));}</script></head>`;
    expect(countInlineScripts(r125Gate)).toBe(1);
  });

  it("does not flag scripts WITH a src (init.js, entry module, registerSW, the gate itself)", () => {
    const builtScripts = [
      buildPreloadGateTag([HOME]),
      '<script src="/init.js"></script>',
      '<script type="module" crossorigin src="/assets/index-T3stHa5h.js"></script>',
      '<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>',
    ].join("\n");
    expect(countInlineScripts(builtScripts)).toBe(0);
  });

  it("ignores <script> mentions inside HTML comments (no false positives)", () => {
    expect(countInlineScripts("<!-- <script>example</script> --><p>ok</p>")).toBe(0);
  });
});

describe("PRELOAD_GATE_SOURCE — runtime gating (executed in JSDOM)", () => {
  it("appends the modulepreload link on the storefront root", () => {
    expect(runGate("https://subnation.ly/", buildPreloadGateTag([HOME]))).toEqual([`/${HOME}`]);
  });

  it("appends on every non-admin path (product, category, unknown routes)", () => {
    expect(
      runGate("https://subnation.ly/product/netflix-premium", buildPreloadGateTag([HOME])),
    ).toEqual([`/${HOME}`]);
    expect(runGate("https://subnation.ly/category/streaming", buildPreloadGateTag([HOME]))).toEqual(
      [`/${HOME}`],
    );
  });

  it("appends NOTHING on /admin and /admin/* — the R125-I2 admin gate, byte-equivalent", () => {
    expect(runGate("https://subnation.ly/admin", buildPreloadGateTag([HOME]))).toEqual([]);
    expect(runGate("https://subnation.ly/admin/users", buildPreloadGateTag([HOME]))).toEqual([]);
  });

  it("appends EVERY space-separated chunk (plural-proof)", () => {
    const tag = buildPreloadGateTag([HOME, "assets/home-Zz9_.js"]);
    expect(runGate("https://subnation.ly/", tag)).toEqual([`/${HOME}`, "/assets/home-Zz9_.js"]);
  });

  it("no-ops (no throw, no links) when the data attribute is absent", () => {
    expect(
      runGate("https://subnation.ly/", '<script src="/assets/preload-gate-deadbeef.js"></script>'),
    ).toEqual([]);
  });

  it("is a classic, console-clean script (no modules, no boot noise)", () => {
    expect(PRELOAD_GATE_SOURCE).not.toMatch(/console\./);
    expect(PRELOAD_GATE_SOURCE).not.toMatch(/\b(import|export)\b/);
  });
});
