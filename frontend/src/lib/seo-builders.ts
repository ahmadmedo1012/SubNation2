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
