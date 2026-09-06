import { useEffect } from "react";

interface JsonLdProps {
  blocks: object[];
}

/**
 * Render one or more JSON-LD blocks inside <head>.
 *
 * V3-A1 (SEO audit 2026-09-06): previously rendered through
 * react-helmet-async, which under React 19 never reliably applied
 * page-level <head> content — structured data silently vanished on
 * product/category pages. Blocks are now inserted directly and removed
 * on unmount (route change).
 *
 * Trusted Types note: schema.org JSON-LD is the one inline-script form
 * permitted by our CSP because `type="application/ld+json"` is treated as
 * data, not executable script. We still HTML-escape `<`, `>`, `&`, `"`
 * inside the JSON payload to defuse a malicious injection in case a CMS
 * later inserts user-provided fields into the LD object.
 */
export function JsonLd({ blocks }: JsonLdProps): null {
  const serialized = JSON.stringify(blocks ?? []);

  useEffect(() => {
    const parsed = JSON.parse(serialized) as object[];
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const escape = (s: string) =>
      s
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/'/g, "\\u0027");

    const nodes = parsed.map((block) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.managedBy = "seo-jsonld";
      script.textContent = escape(JSON.stringify(block));
      document.head.appendChild(script);
      return script;
    });

    return () => {
      for (const node of nodes) node.remove();
    };
  }, [serialized]);

  return null;
}
