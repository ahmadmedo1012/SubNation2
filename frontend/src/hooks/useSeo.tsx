import { type ReactElement } from "react";
import { Helmet } from "react-helmet-async";
import { JsonLd } from "@/components/seo/JsonLd";
import { MetaTags, type SeoInput } from "@/components/seo/MetaTags";

/**
 * Hook for setting per-route SEO metadata.
 *
 * Returns a JSX element to render at the top of the page; the element is
 * cheap to render (just a Helmet block + JSON-LD scripts).
 *
 * Inline scripts are forbidden by the existing Trusted Types CSP. The only
 * exception schema.org allows is `<script type="application/ld+json">`,
 * which is treated as data, not script — JsonLd component enforces this.
 */
export function useSeo(input: SeoInput): ReactElement {
  const { jsonLd, ...meta } = input;
  const blocks = jsonLd ?? [];

  return (
    <>
      <MetaTags {...meta} />
      {blocks.length > 0 && <JsonLd blocks={blocks} />}
      {/* react-helmet-async needs a top-level Helmet to flush even if MetaTags
          renders an early-return; harmless to include a no-op block here. */}
      <Helmet />
    </>
  );
}

export type { SeoInput };
