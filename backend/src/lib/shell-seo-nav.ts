/**
 * R176 (SEO): the no-JS fallback heading + internal-link nav.
 *
 * The shipped SPA shell is a meta-only document: before hydration it has
 * ZERO `<a href>` and ZERO `<h1>`. Google's renderer executes the app, but
 * non-rendering crawlers (Bing, social unfurlers, archive crawlers, the
 * internal-link audit) saw an empty body — the R175 live probe measured
 * 0 anchors on /, /category/streaming and /product/netflix-premium, and
 * `internal_link_recommend` discovered just one page.
 *
 * This module injects a legitimate `<noscript>` fallback before
 * `</body>` (visible only when JavaScript is off — never hidden text for
 * JS users) carrying:
 *   • the page-specific H1 (home keyword headline, the pinned category
 *     h1, the Product-LD name for a PDP, a fixed map for static routes),
 *   • the page meta description,
 *   • links to all seven live categories, support, terms and the sitemap.
 *
 * The shell calls this with two added lines: lib/spa-shell.ts is
 * growth-banned at 1,039 lines (backend-size-gate-r143), so the behavior
 * lives here rather than growing the monolith.
 */
import { buildCategoryJsonLd } from "./shell-category-ld";
import { SHELL_CATEGORY_META, SHELL_HOME_META } from "./shell-meta";
import { injectJsonLdScript } from "./shell-product-ld";

interface SeoNavMeta {
  status: number;
  title?: string;
  description?: string;
  canonical?: string | null;
  robots?: string;
  jsonLd?: string | string[];
}

const DEFAULT_ORIGIN = "https://subnation.ly";

/** `… — SubNation` / `… | SubNation` → the copy without the brand tail. */
function stripBrand(title: string): string {
  return title.replace(/\s*(?:—|–|-|\|)\s*SubNation\s*$/i, "").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Fixed H1s for the shell's static public routes. */
const STATIC_H1: Record<string, string> = {
  "/flash-sales": "عروض فلاش",
  "/support": "الدعم والأسئلة الشائعة",
  "/terms": "الشروط والأحكام",
};

function resolveOrigin(canonical: string | null | undefined): { origin: string; path: string } {
  if (canonical) {
    try {
      const url = new URL(canonical);
      return { origin: url.origin, path: url.pathname.replace(/\/+$/, "") || "/" };
    } catch {
      // A malformed canonical falls back to the configured origin; the
      // page still gets the nav, and the canonical rewriter owns the tag.
    }
  }
  return {
    origin: (process.env.APP_URL || DEFAULT_ORIGIN).replace(/\/$/, ""),
    path: "/",
  };
}

/** The Product LD carries the UNCLAMPED row.name — the shell title may be cut. */
function productNameFromLd(jsonLd: string | string[] | undefined): string | null {
  const blocks = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block) as { "@type"?: unknown; name?: unknown };
      if (parsed["@type"] === "Product" && typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // Ignore a malformed block; the title fallback below still works.
    }
  }
  return null;
}

/**
 * Inject the fallback block. No-ops for 404/noindex shells (a dead URL
 * must not advertise a site map or a heading) and is idempotent.
 */
export function injectSeoNav(html: string, meta: SeoNavMeta): string {
  if (meta.status !== 200) return html;
  if (meta.robots?.toLowerCase().includes("noindex")) return html;
  if (html.includes('data-seo-nav="1"')) return html;

  const { origin, path } = resolveOrigin(meta.canonical);
  const categorySlug = /^\/category\/([^/]+)$/.exec(path)?.[1] ?? null;

  // R177 (RH-55): the raw category shell now carries BreadcrumbList +
  // CollectionPage. The guard keeps a second injectSeoNav call (or a
  // future shell arm) from emitting the pair twice.
  if (categorySlug && !html.includes('"@type":"CollectionPage"')) {
    for (const block of buildCategoryJsonLd(origin, categorySlug) ?? []) {
      html = injectJsonLdScript(html, block);
    }
  }

  let h1: string | null;
  if (path === "/") {
    h1 = stripBrand(SHELL_HOME_META.title);
  } else if (categorySlug) {
    const category = SHELL_CATEGORY_META[categorySlug];
    h1 = category ? category.h1 : meta.title ? stripBrand(meta.title) : null;
  } else if (path.startsWith("/product/")) {
    h1 = productNameFromLd(meta.jsonLd) ?? (meta.title ? stripBrand(meta.title) : null);
  } else {
    h1 = STATIC_H1[path] ?? (meta.title ? stripBrand(meta.title) : null);
  }
  if (!h1) return html;

  const links: Array<{ href: string; label: string; current: boolean }> = [
    { href: `${origin}/`, label: "الرئيسية", current: path === "/" },
    ...Object.entries(SHELL_CATEGORY_META).map(([slug, category]) => ({
      href: `${origin}/category/${slug}`,
      label: category.label,
      current: slug === categorySlug,
    })),
    { href: `${origin}/support`, label: "الدعم والأسئلة الشائعة", current: false },
    { href: `${origin}/terms`, label: "الشروط والأحكام", current: false },
    { href: `${origin}/sitemap.xml`, label: "خريطة الموقع", current: false },
  ];

  const items = links
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.href)}"${
          link.current ? ' aria-current="page"' : ""
        }>${escapeHtml(link.label)}</a></li>`,
    )
    .join("");
  const intro = meta.description ? `<p>${escapeHtml(meta.description)}</p>` : "";
  const block =
    `<noscript data-seo-nav="1">` +
    `<div style="max-width:72rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.9;color:#111">` +
    `<h1 style="font-size:1.5rem;margin:0 0 .75rem">${escapeHtml(h1)}</h1>` +
    intro +
    `<nav aria-label="روابط الموقع"><ul style="list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.5rem 1rem">${items}</ul></nav>` +
    `<p style="margin-top:1rem;font-size:.875rem;color:#555">هذه نسخة نصية مبسطة. فعّل JavaScript للحصول على التجربة الكاملة.</p>` +
    `</div></noscript>`;

  const close = /<\/body\s*>/i.exec(html);
  if (!close || close.index === undefined) return html;
  return html.slice(0, close.index) + block + html.slice(close.index);
}
