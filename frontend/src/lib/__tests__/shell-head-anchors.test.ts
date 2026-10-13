// @vitest-environment node
//
// NODE env on purpose (the preload-gate.test.ts idiom): this suite
// imports vite.config.ts for injectCriticalFontPreloads /
// injectPreloadGate, which transitively loads vite/esbuild — and
// esbuild asserts a TextEncoder/Uint8Array realm invariant that
// vitest's jsdom environment breaks. Everything here is pure string
// transforms + the real index.html fixture; no DOM needed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { indexOfOutsideComments, injectGoogleSiteVerification } from "../seo";
import { injectCriticalFontPreloads, injectPreloadGate } from "../../../vite.config";

/**
 * R141 — the regression suite for the r140 BOOT ORDER incident.
 *
 * r140 added a documentation comment to index.html whose prose spelled
 * out the literal head-close tag sequence («[build-injected, before …]»)
 * ~25 lines above the real element. Every injector in the build pipeline
 * anchored on the FIRST byte-level match of that sequence — comment or
 * not — so the ENTIRE injected payload (Vite's entry module + CSS +
 * vendor modulepreloads, criticalPreloadInject's font preloads, the PWA
 * registerSW script) landed INSIDE the comment and shipped as inert
 * text. The live result: a shell that can never boot — the
 * «يتطلب الموقع تشغيل JavaScript» reveal on desktop, a white screen on
 * mobile. (The backend hit the same class in its R120 hotfix —
 * spa-shell.ts rewrites only non-comment segments — and this suite
 * brings the frontend build pipeline to the same discipline.)
 *
 * Three layers are pinned here:
 *   1. the comment-aware primitive (indexOfOutsideComments),
 *   2. each injector built on it (font preloads, preload gate, GSC meta),
 *   3. the REAL index.html template itself — no comment in it may ever
 *      again contain a literal head open/close tag sequence (the
 *      tag-sequence ban documented in the BOOT ORDER comment).
 */

const FONT_TAGS = [
  '<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/readex-pro-arabic-600-normal-T3stHa5h.woff2" />',
  '<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/readex-pro-arabic-700-normal-T3stHa5h.woff2" />',
];

/** All HTML comment spans in `html` as [start, end) index pairs. */
function commentSpans(html: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /<!--[\s\S]*?-->/g;
  for (const m of html.matchAll(re)) spans.push([m.index!, m.index! + m[0].length]);
  return spans;
}

/** True when `index` sits inside any comment span of `html`. */
function insideComment(html: string, index: number): boolean {
  return commentSpans(html).some(([s, e]) => index >= s && index < e);
}

/**
 * The r140 shell shape, reconstructed: a head documenting the boot
 * order in a comment whose point-3 prose spells out the literal
 * head-close tag sequence — the exact decoy that swallowed every
 * injected tag live. Written EXACTLY as r140 shipped it (the decoy
 * sequence in the comment, the real element below it).
 */
const R140_INCIDENT_SHELL = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <!-- R-140-b — BOOT ORDER (the critical path this tag sits on):
         1. [build-injected, right after <head> opens] the external
            preload-gate script.
         2. THIS script (/init.js, below) — the theme class lands
            before first paint.
         3. [build-injected, before </head>] the CSS link, vendor
            modulepreloads and the 4 critical woff2 font preloads.
         4. body — #root carries the static-offline no-JS fallback.
         5. The entry module — ESM evaluation order, then render. -->
    <script src="/init.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

/** The REAL source template the Vite plugins transform at build time. */
function realIndexHtml(): string {
  // Vitest cwd is the frontend package root (the preload-gate /
  // seo-head-inject idiom).
  return readFileSync(resolve(process.cwd(), "index.html"), "utf8");
}

describe("indexOfOutsideComments — the R141 primitive", () => {
  it("finds a needle that lives in plain (non-comment) markup", () => {
    expect(indexOfOutsideComments("<head></head>", "</head")).toBe(6);
  });

  it("returns -1 when the needle appears ONLY inside comments", () => {
    const html = "<!-- mention of </head> here --><p>nothing real</p>";
    expect(indexOfOutsideComments(html, "</head")).toBe(-1);
  });

  it("THE INCIDENT SHAPE: a decoy sequence inside a comment is skipped for the real tag below it", () => {
    const html = R140_INCIDENT_SHELL;
    const realAt = html.indexOf("</head>\n  <body>");
    expect(realAt).toBeGreaterThan(0);
    const found = indexOfOutsideComments(html, "</head");
    expect(found).toBe(realAt);
    expect(insideComment(html, found)).toBe(false);
  });

  it("fails safe (-1) on an unclosed comment: an anchor we cannot prove is real is refused", () => {
    expect(indexOfOutsideComments("<!-- unclosed, mentions </head>", "</head")).toBe(-1);
  });

  it("finds the needle in a later non-comment segment after intervening comments", () => {
    const html = "<!-- a --><!-- b --><title>x</title><!-- c --></head>";
    expect(indexOfOutsideComments(html, "</head")).toBe(html.indexOf("</head"));
  });

  it("returns -1 when the needle is absent entirely", () => {
    expect(indexOfOutsideComments("<body><p>hi</p></body>", "</head")).toBe(-1);
  });
});

describe("injectCriticalFontPreloads — the r140 incident regression", () => {
  it("lands the preloads OUTSIDE the decoy comment and before the REAL head close", () => {
    const out = injectCriticalFontPreloads(R140_INCIDENT_SHELL, FONT_TAGS);

    for (const tag of FONT_TAGS) {
      const at = out.indexOf(tag);
      expect(at).toBeGreaterThan(0);
      // Not inside any comment — the r140 payload died inside one.
      expect(insideComment(out, at)).toBe(false);
      // Before the real head close (and after the comment's decoy).
      expect(at).toBeLessThan(out.indexOf("</head>\n  <body>"));
    }
    // The decoy prose is untouched — the comment still documents (it is
    // only no longer an anchor).
    expect(out).toContain("[build-injected, before </head>]");
  });

  it("byte-shape parity with the pre-R141 replace on a healthy shell (no decoy)", () => {
    const healthy = `<!doctype html><html><head>
    <script src="/init.js"></script>
  </head><body><div id="root"></div></body></html>`;
    const tagBlock = FONT_TAGS.join("\n    ");
    const legacy = healthy.replace(/(\s*<\/head>)/, `\n    ${tagBlock}$1`);
    expect(injectCriticalFontPreloads(healthy, FONT_TAGS)).toBe(legacy);
  });

  it("injects into the REAL index.html before its head close, outside every comment", () => {
    const out = injectCriticalFontPreloads(realIndexHtml(), FONT_TAGS);
    for (const tag of FONT_TAGS) {
      const at = out.indexOf(tag);
      expect(at).toBeGreaterThan(0);
      expect(insideComment(out, at)).toBe(false);
    }
    // All tags sit between the last dns-prefetch hint and the head close.
    const firstAt = out.indexOf(FONT_TAGS[0]);
    expect(firstAt).toBeGreaterThan(out.indexOf('rel="dns-prefetch"'));
    expect(firstAt).toBeLessThan(out.indexOf("</head>"));
  });

  it("returns the input untouched with no tags (nothing to inject)", () => {
    expect(injectCriticalFontPreloads(R140_INCIDENT_SHELL, [])).toBe(R140_INCIDENT_SHELL);
  });

  it("returns the input untouched when no head close exists outside comments", () => {
    const noHead = "<!-- mentions </head> --><div>no real head</div>";
    expect(injectCriticalFontPreloads(noHead, FONT_TAGS)).toBe(noHead);
  });
});

describe("injectPreloadGate — head-open anchor hardening", () => {
  it("a decoy head-open sequence in a PROLOG comment no longer hijacks the gate", () => {
    // A future comment ABOVE the head element (license banner, doctype
    // note) spelling out the head-open tag text — the head-CLOSE twin
    // of the r140 incident. The old first-match replace injected the
    // gate inside that comment.
    const decoy = `<!doctype html>
<!-- license banner: everything between <head> and the close goes here -->
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body><div id="root"></div></body>
</html>`;
    const out = injectPreloadGate(decoy, ["assets/home-T3stHa5h.js"]);
    const gateAt = out.indexOf('data-home-chunk="/assets/home-T3stHa5h.js"');
    expect(gateAt).toBeGreaterThan(0);
    expect(insideComment(out, gateAt)).toBe(false);
    // After the REAL head open, before the first real head child.
    expect(gateAt).toBeGreaterThan(out.indexOf("<head>\n    <meta charset"));
    expect(gateAt).toBeLessThan(out.indexOf('<meta charset="UTF-8" />'));
  });

  it("keeps the pinned contract on the REAL template: right after the real head opens", () => {
    const out = injectPreloadGate(realIndexHtml(), ["assets/home-T3stHa5h.js"]);
    const gateAt = out.indexOf('data-home-chunk="/assets/home-T3stHa5h.js"');
    expect(gateAt).toBeGreaterThan(out.indexOf("<head>"));
    expect(gateAt).toBeLessThan(out.indexOf("<meta charset"));
    expect(gateAt).toBeLessThan(out.indexOf('src="/init.js"'));
  });
});

describe("injectGoogleSiteVerification — head-close fallback hardening", () => {
  it("the fallback (no viewport meta) stays outside a decoy comment's head-close prose", () => {
    const shell = `<!doctype html><html><head>
    <!-- docs: injected before </head> per the seo-head-inject plugin -->
    <title>t</title>
  </head><body><div id="root"></div></body></html>`;
    const out = injectGoogleSiteVerification(shell, "tok");
    const at = out.indexOf('name="google-site-verification"');
    expect(at).toBeGreaterThan(0);
    expect(insideComment(out, at)).toBe(false);
    // Inserted before the REAL close (the naive `indexOf` here would
    // find the decoy prose inside the comment at a SMALLER index — the
    // assertion itself must be comment-aware).
    expect(at).toBeGreaterThan(out.indexOf("<title>"));
    expect(at).toBeLessThan(indexOfOutsideComments(out, "</head"));
    expect(at).toBeGreaterThan(out.indexOf("</head")); // the decoy precedes it
  });

  // R142 B-1: the PRIMARY (viewport) anchor is comment-aware now too —
  // a decoy viewport meta quoted inside a comment above the REAL one
  // used to splice the GSC meta into the comment (the r140 BOOT ORDER
  // class; the R141 hotfix had hardened only the fallback path).
  it("the PRIMARY anchor skips a decoy viewport meta inside a comment and lands after the REAL one", () => {
    const shell = `<!doctype html><html><head>
    <!-- example snippet (do not copy):
         <meta name="viewport" content="width=device-width, initial-scale=1" />
         goes right here -->
    <meta charset="UTF-8" />
    <meta data-rh="true" name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>t</title>
  </head><body><div id="root"></div></body></html>`;
    const out = injectGoogleSiteVerification(shell, "tok");
    const at = out.indexOf('name="google-site-verification"');
    expect(at).toBeGreaterThan(0);
    expect(insideComment(out, at)).toBe(false);
    // After the REAL (multiline, data-rh) viewport tag…
    expect(at).toBeGreaterThan(
      out.indexOf('content="width=device-width, initial-scale=1, viewport-fit=cover"'),
    );
    // …before the title (the decoy inside the comment never anchored it).
    expect(at).toBeLessThan(out.indexOf("<title>"));
    // The decoy prose is untouched — the comment still documents.
    expect(out).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  });
});

describe("the REAL index.html — the tag-sequence ban (source hygiene)", () => {
  it("NO comment in the real template contains a literal head open/close tag sequence", () => {
    // The r140 BOOT ORDER comment violated exactly this. The ban is
    // documented inside the comment itself; this test is the gate that
    // enforces it forever — a reviewer re-adding the prose sequence
    // fails CI before any deploy can ship a dead shell.
    const html = realIndexHtml();
    for (const [start, end] of commentSpans(html)) {
      const text = html.slice(start, end).toLowerCase();
      expect(text).not.toContain("<head");
      expect(text).not.toContain("</head");
    }
  });

  it("the real head open/close anchors exist OUTSIDE comments (the anchors are live)", () => {
    const html = realIndexHtml();
    const openAt = indexOfOutsideComments(html, "<head");
    const closeAt = indexOfOutsideComments(html, "</head");
    expect(openAt).toBeGreaterThan(0);
    expect(closeAt).toBeGreaterThan(openAt);
  });

  it("the BOOT ORDER documentation survived the R141 hotfix (rewritten, not deleted)", () => {
    expect(realIndexHtml()).toContain("R-140-b — BOOT ORDER");
    expect(realIndexHtml()).toContain("R141 HOTFIX");
  });
});
