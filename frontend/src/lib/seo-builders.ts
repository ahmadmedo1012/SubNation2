/**
 * Schema.org JSON-LD builders.
 *
 * All builders return a plain object that JsonLd will JSON.stringify-ify and
 * emit inside `<script type="application/ld+json">`. Keep these
 * deterministic (no randomness, no Date.now()) so identical inputs produce
 * identical hashes — useful for caching and Lighthouse comparison.
 */

const DEFAULT_ORIGIN = "https://subnation.ly";

function getOrigin(): string {
  const fromEnv = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();
  return (fromEnv?.replace(/\/$/, "") || DEFAULT_ORIGIN).replace(/\/$/, "");
}

// ── Organization ─────────────────────────────────────────────────────────────

export function buildOrganizationLd() {
  const origin = getOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "SubNation",
    alternateName: "سَب نيشن",
    url: origin,
    logo: `${origin}/subnation-logo.png`,
    sameAs: [],
    address: {
      "@type": "PostalAddress",
      addressCountry: "LY",
    },
    description:
      "سوق الاشتراكات الرقمية في ليبيا — Netflix، Spotify، PS Plus، Disney+ بالدينار الليبي.",
  };
}

// ── Product ──────────────────────────────────────────────────────────────────

export interface ProductLdInput {
  id: number | string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  category?: string | null;
  isActive?: boolean;
}

export function buildProductLd(p: ProductLdInput) {
  const origin = getOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${origin}/product/${p.id}`,
    name: p.name,
    description: p.description ?? p.name,
    image: p.imageUrl ?? `${origin}/subnation-logo.png`,
    sku: String(p.id),
    brand: {
      "@type": "Brand",
      name: p.category ?? "SubNation",
    },
    offers: {
      "@type": "Offer",
      price: Number(p.price).toFixed(2),
      priceCurrency: "LYD",
      url: `${origin}/product/${p.id}`,
      availability:
        p.isActive === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
  };
}

// ── BreadcrumbList ───────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  /** Path or absolute URL — relative paths get prefixed with origin. */
  href: string;
}

export function buildBreadcrumbLd(items: BreadcrumbItem[]) {
  const origin = getOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.href.startsWith("http")
        ? item.href
        : `${origin}${item.href.startsWith("/") ? item.href : "/" + item.href}`,
    })),
  };
}

// ── FAQPage ──────────────────────────────────────────────────────────────────

export interface FaqItem {
  question: string;
  answer: string;
}

export function buildFaqLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

// ── WebSite (with sitelinks SearchAction) ────────────────────────────────────
//
// Emitted on the homepage. The SearchAction declares the in-site search
// endpoint so Google can surface a sitelinks search box on brand SERP
// results. The target points back to `/` with a `?search={term}` query
// because home.tsx already drives its catalog filter from that param.

export function buildWebsiteLd() {
  const origin = getOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: origin,
    name: "SubNation",
    alternateName: "سَب نيشن",
    inLanguage: "ar",
    publisher: { "@id": `${origin}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

// ── ItemList (catalog grid) ──────────────────────────────────────────────────
//
// Emitted on the homepage when the catalog has loaded. Helps Google
// understand the rendered grid as a structured collection rather than
// guessing from the DOM. Each entry is a lightweight reference to the
// product detail URL — full Product LD lives on the detail page itself.

export interface ItemListEntry {
  id: number | string;
  name: string;
}

export function buildItemListLd(items: ItemListEntry[]) {
  const origin = getOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((p, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: `${origin}/product/${p.id}`,
      name: p.name,
    })),
  };
}
