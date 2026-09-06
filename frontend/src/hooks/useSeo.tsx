import { type ReactElement } from "react";
import { JsonLd } from "@/components/seo/JsonLd";
import { MetaTags, type SeoInput } from "@/components/seo/MetaTags";

/**
 * Hook for setting per-route SEO metadata.
 *
 * Returns a JSX element to render at the top of the page; the element is
 * cheap to render (a null-rendering MetaTags effect + JSON-LD scripts).
 *
 * V3-A1: head management is direct DOM (see MetaTags) — react-helmet-async
 * could not apply page-level tags under React 19.
 */
export function useSeo(input: SeoInput): ReactElement {
  // (MetaTags renders null — its effect owns the head writes.)
  const { jsonLd, ...meta } = input;

  return (
    <>
      <MetaTags {...meta} />
      <JsonLd blocks={jsonLd ?? []} />
    </>
  );
}

export type { SeoInput };
