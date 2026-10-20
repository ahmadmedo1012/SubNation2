/**
 * Schema.org JSON-LD builders.
 *
 * All builders return a plain object that JsonLd will JSON.stringify-ify and
 * emit inside `<script type="application/ld+json">`. Keep these
 * deterministic (no randomness, no Date.now()) so identical inputs produce
 * identical hashes — useful for caching and Lighthouse comparison.
 */

import { categoryLabel } from "./utils";
import { productOgUrl } from "./product-art";

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
    // Geographic service area — declares to search engines that this
    // organization's services target Libya specifically. Helps local
    // intent queries ("اشتراك Netflix ليبيا") match the site.
    areaServed: {
      "@type": "Country",
      name: "Libya",
      sameAs: "https://www.wikidata.org/wiki/Q1016",
    },
    // R120-B3 (A7-F5): the description names what the catalog ACTUALLY
    // sells (streaming/VPN/Windows+software/AI — the live categories);
    // "PS Plus" advertised a retired family with zero results.
    // R161-C: «ومنصات المشاهدة» — the streaming family's honest name
    // (all 17 live products are on-demand viewing platforms).
    description:
      "سوق الاشتراكات الرقمية في ليبيا — Netflix ومنصات المشاهدة، اشتراكات VPN، تراخيص Windows والبرامج، أدوات الذكاء الاصطناعي بالدينار الليبي.",
  };
}

// ── Product ──────────────────────────────────────────────────────────────────

export interface ProductLdInput {
  id: number | string;
  /** SEO-friendly slug used to build the canonical URL when present. */
  slug?: string | null;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number;
  category?: string | null;
  isActive?: boolean;
  /**
   * R111 (D2-F2): the REAL deliverable-stock signal from the product
   * DTO — the same `is_available` the page's buy button gates on
   * (stock_count > 0). When false the Offer asserts OutOfStock even
   * for an is_active product (the live catalog: 45/45 active products
   * with zero deliverable stock all asserted InStock while the UI said
   * «نفد المخزون» — a rich-results honesty violation Google penalizes).
   */
  isAvailable?: boolean;
  /**
   * Optional long-form description (300-800 words). When present it
   * replaces `description` in the LD payload — Google rewards
   * substantive Product structured data and surfaces richer snippets.
   */
  descriptionLong?: string | null;
  /**
   * R-140-g (JSON-LD completeness audit — the AggregateRating judgment):
   * this input deliberately carries NO rating/review fields, and
   * buildProductLd therefore NEVER emits schema.org/AggregateRating.
   * The generated Product DTO (shared/api-client-react api.schemas.ts)
   * exposes no rating / review / reviewCount surface at all — its
   * `order_count` counts PURCHASES, not reviews, and no ratingValue
   * exists anywhere in the API shape. Dressing either up as review
   * stars would fabricate social proof (the rich-results spam class
   * Google penalizes harder than absent stars). When a real review
   * surface ships: extend THIS input with the API's own fields, guard
   * the emission (ratingValue bounded 1–5, reviewCount > 0), and
   * update the no-fabrication pin in
   * src/pages/__tests__/jsonld-completeness-r140.test.ts — it asserts
   * the built Product LD carries no aggregateRating/reviewCount/
   * ratingValue keys today.
   */
}

export function buildProductLd(p: ProductLdInput) {
  const origin = getOrigin();
  // Stable absolute path: prefer slug (canonical for SEO) over numeric
  // id. Falls through to id when slug is missing (legacy rows pre-
  // backfill — should be impossible after the migration but keeps the
  // builder defensive).
  const path = `/product/${p.slug ?? p.id}`;
  const productUrl = `${origin}${path}`;

  // priceValidUntil: Google Merchant requires a future date on Offer LD
  // to consider the product structured data eligible for rich pricing
  // snippets. We use end-of-current-year + 1 — long enough that crawlers
  // never see an expired offer, short enough that operators are nudged
  // to refresh seasonal pricing.
  //
  // Computed from a fixed reference (build-time `Date()` would invalidate
  // every render; this stays deterministic per request render).
  const now = new Date();
  const priceValidUntil = `${now.getUTCFullYear() + 1}-12-31`;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productUrl,
    // R123-E4b (P3-n): schema.org/Product.url — the canonical product
    // URL at the TOP level of the Product node (only @id and offers.url
    // carried it before). The page's runtime og:url/og:type=product
    // (MetaTags) and this LD url now agree; Google's Product rich-result
    // docs list url among the recommended product-snippet properties.
    url: productUrl,
    name: p.name,
    description: (p.descriptionLong ?? p.description ?? p.name).slice(0, 5000),
    // AUD103-6-F1 (r103): Google's Product rich-result validator (and
    // every OG-style unfurler) expects a fully-qualified URL — the DB
    // stores site-relative /products/<slug>.webp, so absolutize like
    // MetaTags does for og:image.
    image: p.imageUrl
      ? p.imageUrl.startsWith("http")
        ? p.imageUrl
        : // R178: crawlers read the OPAQUE /products-og/ family
          // (productOgUrl) — transparent art composites on unpredictable
          // scraper grounds, so Product-LD keeps the pearl/charcoal tile
          // (the same story as og:image + the backend shell).
          (productOgUrl(`${origin}${p.imageUrl}`) ?? `${origin}${p.imageUrl}`)
      : `${origin}/subnation-logo.png`,
    // R120-B3 (A7-F20): sku = slug-based, not the raw DB id — "1" told
    // Google Shopping nothing and leaked row identity. Legacy slug-less
    // rows keep the numeric fallback.
    sku: p.slug ? `subnation-${p.slug}` : String(p.id),
    // R120-B3 (A7-F11): brand = the SELLER (SubNation) — the old
    // categoryLabel (the streaming category's name, «منصات المشاهدة»
    // for a Netflix product) asserted the marketplace's own taxonomy as
    // the MANUFACTURER, polluting knowledge-graph association. The
    // category still ships — as the Product LD `category` field, which
    // is what it actually is.
    brand: {
      "@type": "Brand",
      name: "SubNation",
    },
    category: categoryLabel(p.category) || undefined,
    offers: {
      "@type": "Offer",
      price: Number(p.price).toFixed(2),
      priceCurrency: "LYD",
      priceValidUntil,
      url: productUrl,
      availability:
        p.isActive === false || p.isAvailable === false
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      // R166 (F2): Google's Product docs list Offer.seller among the
      // recommended fields — SubNation IS the seller (no fabrication;
      // field-mirrored with the backend shell builder, shell-product-ld.ts).
      seller: { "@type": "Organization", name: "SubNation" },
    },
  };
}

// ── BreadcrumbList ───────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  /** Path or absolute URL — relative paths get prefixed with origin. */
  href: string;
}

export function buildBreadcrumbLd(items: BreadcrumbItem[], id?: string) {
  const origin = getOrigin();
  // R178 (RH-55): the raw shell already emits the same BreadcrumbList with
  // this @id. Reusing it lets the hydrated page merge into ONE node instead
  // of shipping a second, anonymous BreadcrumbList beside the shell's.
  const absoluteId = id
    ? id.startsWith("http")
      ? id
      : `${origin}${id.startsWith("/") ? id : "/" + id}`
    : null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    ...(absoluteId ? { "@id": absoluteId } : {}),
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
  /**
   * SEO slug — preferred over the numeric id for the canonical
   * /product/<slug> URL (mirrors buildProductLd and the backend sitemap
   * builder, routes/seo.ts, which emits slug URLs for every active row).
   */
  slug?: string | null;
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
      // 110-F (R110 — 109-n P3): slug-canonical URL form — matches
      // buildProductLd above and the sitemap. The id remains the
      // defensive fallback for slug-less legacy rows. (Both live callers
      // already stuffed the slug into `id`, so emitted URLs were
      // slug-shaped in practice — this makes the builder correct by
      // construction instead of by caller convention.)
      url: `${origin}/product/${p.slug ?? p.id}`,
      name: p.name,
    })),
  };
}
