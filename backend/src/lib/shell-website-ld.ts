/**
 * R166 (F4): the home URL's crawler-shell JSON-LD — the exact JSON of the
 * frontend's buildOrganizationLd()/buildWebsiteLd()
 * (frontend/src/lib/seo-builders.ts), mirrored into the raw shell so
 * non-rendering engines finally see the home's graph entities (both were
 * static constants emitted client-only — zero structured data on "/" in
 * the raw HTML). Same @ids (`${origin}/#organization`, `${origin}/#website`)
 * the hydrated page's JsonLd re-emits, so the raw and rendered nodes merge
 * into one entity (the R163 PDP @id-merge contract, applied to the home).
 *
 * The ItemList stays client-only by design: it needs the loaded catalog,
 * and the shell must stay a pure function of (origin) — no DB read, no
 * cache dependency (same discipline as SHELL_HOME_META in shell-meta.ts).
 *
 * Pure builders — no Express, no IO; spa-shell.ts owns the wiring.
 */

export function buildShellOrganizationLd(origin: string): string {
  return JSON.stringify({
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
    // organization's services target Libya specifically (mirrored from the
    // frontend builder verbatim, R120-B3 A7-F5 description included).
    areaServed: {
      "@type": "Country",
      name: "Libya",
      sameAs: "https://www.wikidata.org/wiki/Q1016",
    },
    description:
      "سوق الاشتراكات الرقمية في ليبيا — Netflix ومنصات المشاهدة، اشتراكات VPN، تراخيص Windows والبرامج، أدوات الذكاء الاصطناعي بالدينار الليبي.",
  });
}

export function buildShellWebsiteLd(origin: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: origin,
    name: "SubNation",
    alternateName: "سَب نيشن",
    inLanguage: "ar",
    publisher: { "@id": `${origin}/#organization` },
    // The SearchAction declares the in-site search endpoint (home.tsx
    // drives its catalog filter from ?search=) — mirrored verbatim.
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  });
}
