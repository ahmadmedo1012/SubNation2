/**
 * Build-time SEO head injection helpers.
 *
 * 97-F6 (R97 J-2): the google-site-verification meta is injected into the
 * built index.html by the `seo-head-inject` Vite plugin (vite.config.ts).
 * The old inline implementation matched the viewport tag with
 * `/<meta name="viewport"[^>]*>/` — a pattern that can never match the REAL
 * tag shape: index.html declares it multiline with legacy `data-rh`
 * attributes BEFORE `name`:
 *
 *   <meta
 *     data-rh="true"
 *     name="viewport"
 *     content="width=device-width, …"
 *   />
 *
 * `[^>]*` does span newlines, but the literal `<meta name="viewport"` prefix
 * fails the moment any attribute (data-rh, charset, http-equiv, id …)
 * precedes `name`. The live production HTML (R97-A1 §3.6) and a local dist
 * build both reproduced it: the verification meta was never emitted, so
 * Google Search Console's HTML-tag verification method can never be
 * activated. The logic lives here — as a pure function, not inside the
 * plugin — so it is unit-testable without booting Vite (see
 * src/lib/__tests__/seo-head-inject.test.ts, which feeds the REAL index.html
 * template plus the live production tag shape through it).
 */

/** <meta name="..."> this module injects for Search Console verification. */
export const GSC_VERIFICATION_META_NAME = "google-site-verification";

/**
 * A `<meta>` tag whose `name` attribute equals `viewport`.
 *
 * - attribute-order agnostic (`data-rh`, `charset`, `content`, arbitrary
 *   attributes may precede/follow `name`) — the root cause of J-2;
 * - multiline-safe: `[^>]*` matches newlines inside the tag (no `>` may
 *   legally appear inside a meta tag body);
 * - quote-style agnostic: `name="viewport"` and `name='viewport'`, with a
 *   backreference so mixed quotes can't match;
 * - requires whitespace before `name=` so `data-name="viewport"`-style
 *   attributes can't produce a false positive.
 */
const VIEWPORT_META_RE = /<meta\b[^>]*\sname=(["'])viewport\1[^>]*>/i;

/** Any existing verification meta, in any attribute order/quote style. */
const GSC_META_RE = new RegExp(
  `<meta\\b[^>]*\\sname=(["'])${GSC_VERIFICATION_META_NAME}\\1[^>]*>`,
  "i",
);

/**
 * R141 hotfix (the r140 boot-order incident): find the first occurrence of
 * `needle` that sits OUTSIDE any HTML comment.
 *
 * WHY this exists: r140 added a BOOT ORDER documentation comment to
 * index.html whose prose spelled out the literal head-close tag sequence
 * («[build-injected, before …]»). Every injector in the build pipeline
 * anchored on the FIRST byte-level match of that sequence — comment or
 * not — so the entire injected payload (Vite's entry module + CSS +
 * vendor modulepreloads, criticalPreloadInject's font preloads, the PWA
 * registerSW script) landed INSIDE the comment and shipped as inert text:
 * a dead shell that can never boot (live «يتطلب الموقع تشغيل JavaScript»
 * outage, white screen on mobile). The backend learned this exact lesson
 * in its R120 hotfix (spa-shell.ts rewrites only non-comment segments);
 * the frontend build pipeline now gets the same comment-aware discipline.
 *
 * Semantics: walks the document in alternating non-comment / comment
 * segments and searches only the non-comment ones. Returns the index of
 * the first non-comment hit, or -1 when the needle never appears outside
 * comments (including the degenerate unclosed-comment case, treated as a
 * comment to the end of input — fail-safe: an anchor we cannot prove is
 * real is an anchor we refuse to use). A needle that would straddle a
 * comment boundary cannot match — acceptable: none of our anchors
 * (tag sequences) can be legally split by a comment.
 */
export function indexOfOutsideComments(html: string, needle: string): number {
  let cursor = 0;
  while (cursor < html.length) {
    const commentOpen = html.indexOf("<!--", cursor);
    const segmentEnd = commentOpen === -1 ? html.length : commentOpen;
    const hit = html.indexOf(needle, cursor);
    if (hit !== -1 && hit + needle.length <= segmentEnd) return hit;
    if (commentOpen === -1) return -1;
    const commentClose = html.indexOf("-->", commentOpen + 4);
    if (commentClose === -1) return -1;
    cursor = commentClose + 3;
  }
  return -1;
}

const HTML_ATTR_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
export function escapeHtmlAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ATTR_ESCAPES[ch] ?? ch);
}

/** The exact tag emitted for a (possibly empty) verification token. */
export function buildGscVerificationMeta(token: string): string {
  return `<meta name="${GSC_VERIFICATION_META_NAME}" content="${escapeHtmlAttr(token)}" />`;
}

/**
 * Insert the google-site-verification meta into an HTML document.
 *
 * Placement: immediately AFTER the viewport meta (near the top of <head>
 * where Search Console looks for it), falling back to just before </head>
 * when no viewport meta exists. An empty token still emits
 * `content=""` — harmless, ignored by Search Console — matching the
 * documented behavior in index.html's inline comment.
 *
 * Idempotent: if ANY verification meta already exists (any attribute
 * order/quote style — including ones injected by earlier plugin passes or
 * hand-added to the template), the input is returned untouched, so repeated
 * builds / double transforms can never emit a duplicate. NB: a bare
 * substring test would false-positive on index.html's explanatory comment
 * ("google-site-verification meta is injected at build time…") — the
 * meta-tag-shaped regex below only matches real tags.
 *
 * @param html full HTML document (or at least the <head> section).
 * @param token raw `content` value; HTML-escaped before interpolation.
 */
export function injectGoogleSiteVerification(html: string, token: string): string {
  if (GSC_META_RE.test(html)) return html;

  const tag = buildGscVerificationMeta(token);

  const viewport = VIEWPORT_META_RE.exec(html);
  if (viewport) {
    const at = viewport.index + viewport[0].length;
    return html.slice(0, at) + `\n    ${tag}` + html.slice(at);
  }

  // R141: comment-aware head-close anchor. The old HEAD_CLOSE_RE.exec picked
  // the FIRST byte-level match — a prose mention of the tag inside a comment
  // (the r140 BOOT ORDER decoy) would have swallowed this meta into the
  // comment too. Dormant while the viewport path above matches, but the
  // fallback must be as decoy-proof as the primary path. Insertion happens
  // BEFORE the tag start, so the `>`-spacing tolerance of the old regex is
  // irrelevant — the "</head" needle finds the start in every legal shape.
  const headCloseAt = indexOfOutsideComments(html, "</head");
  if (headCloseAt !== -1) {
    return html.slice(0, headCloseAt) + `    ${tag}\n  ` + html.slice(headCloseAt);
  }

  // No <head> structure to anchor against — leave the document untouched
  // rather than corrupting an unknown shape.
  return html;
}
