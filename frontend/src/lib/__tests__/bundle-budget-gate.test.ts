// @vitest-environment node
//
// NODE env (not jsdom) on purpose — same reason as preload-gate.test.ts
// and budget-dsn-parity.test.ts: this suite imports vite.config.ts (the
// gate's pure HTML scans live there — single source of truth), which
// transitively loads vite/esbuild; esbuild asserts a TextEncoder/
// Uint8Array realm invariant that vitest's jsdom environment breaks.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectEagerFiles, findBundleEntry } from "../../../vite.config";

/**
 * B-2/M-1 (R142) regression tests for the bundle-budget gate's HTML
 * scans.
 *
 * The gate resolves WHAT to measure from the BUILT index.html: the
 * module-entry chunk (the R118 ground-truth lookup) and the eager link
 * set (the R120-B5 sum gate). Both used to scan the RAW html, so a
 * comment quoting a module script tag or a modulepreload/stylesheet
 * link — exactly how the r140 BOOT ORDER comment spelled out the
 * head-close sequence, the shape that shipped the R141 dead shell —
 * would make the gate measure a decoy file (silently vacuous, the R118
 * regression class) or fail on a chunk that doesn't exist. Both scans
 * now strip comments first, the same idiom the R125 CSP inline-script
 * gate established; these tests pin that discipline so the first
 * decoy-tag regression fails a unit test instead of a production boot.
 */

/** The REAL source template the Vite plugin transforms at build time. */
function realIndexHtml(): string {
  // Vitest cwd is the frontend package root.
  return readFileSync(resolve(process.cwd(), "index.html"), "utf8");
}

/** The BUILT head shape (mirrors preload-gate.test.ts's fixture). */
function builtHeadFixture(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head>
    <script src="/init.js"></script>
    <script type="module" crossorigin src="/assets/index-T3stHa5h.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-T3stHa5h.js">
    <link rel="stylesheet" crossorigin href="/assets/index-T3stHa5h.css">
  </head><body><div id="root"></div></body></html>`;
}

/** The incident shape: a comment quoting the injected tags, ABOVE them. */
function decoyCommentFixture(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head>
    <!-- example: <script type="module" crossorigin src="/assets/index-Dec0yHa5h.js"></script>
         <link rel="modulepreload" crossorigin href="/assets/old-DeaDBeeF.js">
         <link rel="stylesheet" crossorigin href="/assets/old-DeaDBeeF.css"> -->
    <script type="module" crossorigin src="/assets/index-T3stHa5h.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-T3stHa5h.js">
    <link rel="stylesheet" crossorigin href="/assets/index-T3stHa5h.css">
  </head><body><div id="root"></div></body></html>`;
}

describe("findBundleEntry — the gate's entry-chunk lookup", () => {
  it("resolves the module entry from the built head shape", () => {
    expect(findBundleEntry(builtHeadFixture())).toBe("index-T3stHa5h.js");
  });

  it("ignores a decoy entry script quoted inside a comment (B-2/M-1)", () => {
    // The OLD raw-html first match returned the decoy's index-Dec0yHa5h.js
    // — the gate would then measure (or fail on) a file nothing boots.
    expect(findBundleEntry(decoyCommentFixture())).toBe("index-T3stHa5h.js");
  });

  it("finds NOTHING when the only entry script sits inside a comment", () => {
    // The R141 dead-shell shape: every injected tag swallowed. The gate
    // must refuse to certify it — closeBundle exits 1 on undefined.
    const swallowed = `<!doctype html><html><head>
      <!-- <script type="module" crossorigin src="/assets/index-5wA11ow3d.js"></script> -->
    </head><body><div id="root"></div></body></html>`;
    expect(findBundleEntry(swallowed)).toBeUndefined();
  });

  it("never matches the SOURCE template's dev module script", () => {
    // The source's <script type="module" src="/src/main.tsx"> is not a
    // built entry chunk — only the BUILT shell satisfies the lookup.
    expect(findBundleEntry(realIndexHtml())).toBeUndefined();
  });
});

describe("collectEagerFiles — the R120-B5 eager-path set", () => {
  it("collects the live modulepreload JS + stylesheet CSS links", () => {
    expect(collectEagerFiles(builtHeadFixture(), "index-T3stHa5h.js")).toEqual(
      new Set(["index-T3stHa5h.js", "vendor-react-T3stHa5h.js", "index-T3stHa5h.css"]),
    );
  });

  it("ignores modulepreload/stylesheet links quoted inside a comment (B-2/M-1)", () => {
    const files = collectEagerFiles(decoyCommentFixture(), "index-T3stHa5h.js");
    expect(files).toEqual(
      new Set(["index-T3stHa5h.js", "vendor-react-T3stHa5h.js", "index-T3stHa5h.css"]),
    );
    expect(files.has("old-DeaDBeeF.js")).toBe(false);
    expect(files.has("old-DeaDBeeF.css")).toBe(false);
  });

  it("counts only modulepreload JS and stylesheet CSS — never icons, manifests, or fonts", () => {
    const files = collectEagerFiles(realIndexHtml(), "index-T3stHa5h.js");
    // The source template's icon/manifest/dns-prefetch links are not
    // eager bytes; Vite injects the modulepreload/stylesheet family at
    // build time, so the real template contributes only the entry.
    expect(files).toEqual(new Set(["index-T3stHa5h.js"]));
  });
});
