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
 *
 * R-140-h (mechanism audit, meta-quality sweep): verified the contract
 * end-to-end — one <title> (setTitle collapses duplicates), one
 * description, one full og set, one canonical per route (the `path`
 * prop), og:locale ar_LY, og:site_name SubNation — all through
 * selector-based upserts that can never accumulate. The noindex
 * capability is the `robots` directive string on SeoInput (e.g.
 * "noindex,follow") — see MetaTags' R-140-h note for why a separate
 * boolean flag was deliberately NOT added: the App-level fallback
 * (robotsForPath) speaks the same string vocabulary, and every
 * robot-walled surface emits runtime meta robots noindex either from
 * its page block (cart/checkout/status/notifications/404) or from the
 * fallback (login/register/wallet/orders/loyalty/referrals/profile/
 * admin/auth flows). Pinned by meta-quality-r140.test.ts.
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
