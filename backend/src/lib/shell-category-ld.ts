/**
 * R177 (RH-55): category landing-page JSON-LD in the raw SPA shell.
 *
 * The hydrated /category/:slug page emits BreadcrumbList + FAQPage +
 * ItemList after JavaScript runs, but the initial HTML carried zero
 * structured data — the remaining RH-55 gap. This module mirrors the
 * crawler-critical BreadcrumbList in the shell and adds a CollectionPage
 * node that names the category, its canonical URL and its place in the
 * site hierarchy. It deliberately does NOT invent products: the ItemList
 * stays client-side until the shell can prove the live row set (the same
 * truth rule the Product/Offer shell arm follows).
 *
 * Pure functions only; the shell rewriter injects the returned blocks
 * with lib/shell-product-ld.ts's escaping helper.
 */
import { SHELL_CATEGORY_META } from "./shell-meta";

/** The crawler-visible BreadcrumbList, matching the hydrated page's shape. */
export function buildCategoryBreadcrumbLd(origin: string, slug: string): string | null {
  const meta = SHELL_CATEGORY_META[slug];
  if (!meta) return null;
  const url = `${origin}/category/${slug}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "الرئيسية",
        item: `${origin}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: meta.label,
        item: url,
      },
    ],
  });
}

/** CollectionPage: a real category entity for the initial HTML. */
export function buildCategoryCollectionLd(origin: string, slug: string): string | null {
  const meta = SHELL_CATEGORY_META[slug];
  if (!meta) return null;
  const url = `${origin}/category/${slug}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: meta.h1,
    description: meta.metaDescription,
    inLanguage: "ar",
    isPartOf: { "@id": `${origin}/#website` },
    breadcrumb: { "@id": `${url}#breadcrumb` },
  });
}

/** Both blocks, in injection order; null for an unknown/retired category. */
export function buildCategoryJsonLd(origin: string, slug: string): string[] | null {
  const breadcrumb = buildCategoryBreadcrumbLd(origin, slug);
  const collection = buildCategoryCollectionLd(origin, slug);
  return breadcrumb && collection ? [breadcrumb, collection] : null;
}
