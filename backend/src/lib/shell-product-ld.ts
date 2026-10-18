/**
 * R163 (size-gate carve): the crawler-shell's Product JSON-LD arm moved
 * VERBATIM from lib/spa-shell.ts (the growth-banned register). Pure
 * builders — no Express, no IO; spa-shell.ts owns the wiring.
 */
import type { ShareSurfaceProduct } from "./spa-shell";

/**
 * R163: insert ONE <script type="application/ld+json"> block immediately
 * before </head> — the same comment-aware anchor discipline as the
 * frontend's seo-head-inject (the R141 lesson: never splice into or
 * next to comment prose). The payload is escaped so a `</script>`
 * sequence can never terminate the block early (the frontend JsonLd
 * component's escape set — inside a JSON string, \uXXXX escapes stay
 * valid JSON).
 */
export function injectJsonLdScript(segment: string, jsonLd: string): string {
  const headCloseAt = segment.indexOf("</head");
  if (headCloseAt === -1) return segment;
  const escaped = jsonLd.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const tag = `    <script type="application/ld+json">${escaped}</script>\n  `;
  return segment.slice(0, headCloseAt) + tag + segment.slice(headCloseAt);
}

/**
 * R163: the shell's Product JSON-LD — mirrors the frontend's
 * buildProductLd (frontend/src/lib/seo-builders.ts) field-for-field on
 * the subset the shell can prove from the DB row: same @id/url
 * (`${origin}/product/${slug}` — the node the hydrated page re-emits,
 * so Google merges them), same sku dialect (`subnation-<slug>`), same
 * Brand honesty (SubNation the SELLER), same description preference
 * (descriptionLong ?? description ?? name, sliced 5000), same Offer
 * shape (LYD, 2-dp, priceValidUntil end-of-next-year, NewCondition)
 * and the same stock honesty (OutOfStock when the deliverable pool is
 * empty — never InStock against a «نفد المخزون» page).
 *
 * Returns undefined when the numeric price is not finite — a price we
 * cannot honestly assert means NO Offer block ships (the hydrated
 * page's LD still carries its own); an unparseable price must never
 * become a fabricated structured-data claim.
 */
export function buildShellProductLd(args: {
  row: ShareSurfaceProduct;
  origin: string;
  numericPrice: number;
  absoluteImage: string;
}): string | undefined {
  const { row, origin, numericPrice, absoluteImage } = args;
  if (!Number.isFinite(numericPrice)) return undefined;
  const productUrl = `${origin}/product/${row.slug ?? row.id}`;
  const priceValidUntil = `${new Date().getUTCFullYear() + 1}-12-31`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productUrl,
    url: productUrl,
    name: row.name,
    description: (row.descriptionLong ?? row.description ?? row.name).slice(0, 5000),
    image: absoluteImage,
    sku: row.slug ? `subnation-${row.slug}` : String(row.id),
    brand: { "@type": "Brand", name: "SubNation" },
    offers: {
      "@type": "Offer",
      price: numericPrice.toFixed(2),
      priceCurrency: "LYD",
      priceValidUntil,
      url: productUrl,
      availability:
        !row.isActive || row.stockCount <= 0
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  return JSON.stringify(ld);
}
