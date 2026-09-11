import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GSC_VERIFICATION_META_NAME,
  buildGscVerificationMeta,
  escapeHtmlAttr,
  injectGoogleSiteVerification,
} from "../seo";

/**
 * 97-F6 (R97 J-2): regression tests for the seo-head-inject fix.
 *
 * The old inline regex in vite.config.ts — `/(<meta name="viewport"[^>]*>)/`
 * — never matched the real viewport tag (multiline, `data-rh` attributes
 * BEFORE `name`), so the google-site-verification meta was silently never
 * injected (reproduced live by R97-A1 §3.6 and on a local dist build).
 * These tests feed the REAL index.html template — plus the exact live
 * production HTML shape captured by R97-A1 — through the injector.
 */

const VERIFICATION_TAG_RE = new RegExp(
  `<meta\\b[^>]*\\sname=(["'])${GSC_VERIFICATION_META_NAME}\\1[^>]*>`,
  "gi",
);

function countVerificationMetas(html: string): number {
  return (html.match(VERIFICATION_TAG_RE) ?? []).length;
}

/** The REAL source template the Vite plugin transforms at build time. */
function realIndexHtml(): string {
  // Vitest cwd is the frontend package root.
  return readFileSync(resolve(process.cwd(), "index.html"), "utf8");
}

/**
 * The exact live production head shape (R97-A1 §3.1): multiline viewport
 * meta with data-rh FIRST — the shape the old regex never matched.
 */
const LIVE_PRODUCTION_HEAD = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta data-rh="true" name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <title data-rh="true">SubNation — سوق الاشتراكات الرقمية</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe("injectGoogleSiteVerification — real index.html template (J-2)", () => {
  const TOKEN = "gsc-test-token-123";

  it("injects the verification meta into the REAL index.html template", () => {
    const out = injectGoogleSiteVerification(realIndexHtml(), TOKEN);

    expect(countVerificationMetas(out)).toBe(1);
    expect(out).toContain(`content="${TOKEN}"`);
  });

  it("places the meta right after the (multiline, data-rh) viewport tag and before </head>", () => {
    const source = realIndexHtml();
    const out = injectGoogleSiteVerification(source, TOKEN);

    const viewportEnd = source.indexOf('name="viewport"') + 'name="viewport"'.length;
    const metaAt = out.indexOf(`name="${GSC_VERIFICATION_META_NAME}"`);
    const headCloseAt = out.indexOf("</head>");

    expect(metaAt).toBeGreaterThan(viewportEnd);
    expect(metaAt).toBeLessThan(headCloseAt);
  });

  it("injects into the live production HTML shape captured by R97-A1", () => {
    const out = injectGoogleSiteVerification(LIVE_PRODUCTION_HEAD, TOKEN);

    expect(countVerificationMetas(out)).toBe(1);
    expect(out.indexOf(`content="${TOKEN}"`)).toBeGreaterThan(0);
    expect(out.indexOf(`content="${TOKEN}"`)).toBeLessThan(out.indexOf("</head>"));
  });

  it("injects an empty-content meta when the token is unset (documented behavior)", () => {
    const out = injectGoogleSiteVerification(realIndexHtml(), "");

    // index.html's inline comment documents: unset token → content="" meta,
    // harmless and ignored by Search Console.
    expect(countVerificationMetas(out)).toBe(1);
    expect(out).toContain('content=""');
  });

  it("is idempotent: re-running the injector never duplicates the meta", () => {
    const once = injectGoogleSiteVerification(realIndexHtml(), TOKEN);
    const twice = injectGoogleSiteVerification(once, TOKEN);

    expect(countVerificationMetas(twice)).toBe(1);
    expect(twice).toBe(once);
  });

  it("is idempotent: an EXISTING verification meta (any shape) is left untouched", () => {
    const html = `<!doctype html><html><head>
      <meta charset="UTF-8" />
      <meta content="pre-existing-token" name="google-site-verification" data-rh="true">
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head><body></body></html>`;

    expect(injectGoogleSiteVerification(html, "a-new-token")).toBe(html);
  });

  it("does not confuse index.html's explanatory COMMENT for an existing meta", () => {
    // The template contains the comment "google-site-verification meta is
    // injected at build time by the seoHeadInject Vite plugin…" — a naive
    // substring idempotency check would false-positive on it and skip
    // injection. The injector must still emit the real tag.
    const source = realIndexHtml();
    expect(source).toContain("google-site-verification"); // the comment exists…

    const out = injectGoogleSiteVerification(source, TOKEN);
    expect(countVerificationMetas(out)).toBe(1); // …but only ONE real tag.
  });
});

describe("injectGoogleSiteVerification — tag-shape robustness", () => {
  const HEAD = (viewport: string): string =>
    `<!doctype html><html><head><meta charset="UTF-8" />${viewport}<title>t</title></head><body></body></html>`;

  it.each([
    ['<meta name="viewport" content="width=device-width, initial-scale=1" />', "plain single-line"],
    ["<meta name='viewport' content='width=device-width' />", "single quotes"],
    ['<meta content="width=device-width" name="viewport" />', "content before name"],
    [
      '<meta id="vp" data-rh="true"\n  name="viewport"\n  content="width=device-width"\n/>',
      "multiline data-rh (J-2 root cause)",
    ],
  ])("matches viewport variant: %s", (viewport) => {
    const out = injectGoogleSiteVerification(HEAD(viewport), "tok");
    expect(countVerificationMetas(out)).toBe(1);
  });

  it("falls back to injecting just before </head> when no viewport meta exists", () => {
    const html = `<!doctype html><html><head><meta charset="UTF-8" /><title>t</title></head><body></body></html>`;
    const out = injectGoogleSiteVerification(html, "tok");

    expect(countVerificationMetas(out)).toBe(1);
    expect(out.indexOf(`content="tok"`)).toBeLessThan(out.indexOf("</head>"));
  });

  it("returns the input untouched when there is no head structure to anchor against", () => {
    const html = "<div>no head here</div>";
    expect(injectGoogleSiteVerification(html, "tok")).toBe(html);
  });

  it('does not match data-name="viewport" or viewport mentions inside comments', () => {
    const html = HEAD(
      '<!-- the layout viewport shrinks --><meta data-name="viewport" content="x" />',
    );
    // No real viewport meta → fallback path (before </head>), proving the
    // comment and data-name did NOT count as a viewport tag match.
    const out = injectGoogleSiteVerification(html, "tok");
    expect(countVerificationMetas(out)).toBe(1);
    expect(out.indexOf(`content="tok"`)).toBeGreaterThan(out.indexOf("</title>"));
  });
});

describe("token escaping", () => {
  it("escapes HTML-special characters in the content attribute", () => {
    expect(escapeHtmlAttr(`a&<>"'z`)).toBe("a&amp;&lt;&gt;&quot;&#39;z");
  });

  it("builds a well-formed meta with the escaped token", () => {
    expect(buildGscVerificationMeta('evil" onload="x')).toBe(
      '<meta name="google-site-verification" content="evil&quot; onload=&quot;x" />',
    );
  });
});
