import { type ReactElement } from "react";
import { Helmet } from "react-helmet-async";

interface JsonLdProps {
  blocks: object[];
}

/**
 * Render one or more JSON-LD blocks inside <head>.
 *
 * Trusted Types note: schema.org JSON-LD is the one inline-script form
 * permitted by our CSP because `type="application/ld+json"` is treated as
 * data, not executable script. We still HTML-escape `<`, `>`, `&`, `"`
 * inside the JSON payload to defuse a malicious injection in case a CMS
 * later inserts user-provided fields into the LD object.
 */
export function JsonLd({ blocks }: JsonLdProps): ReactElement | null {
  if (!blocks || blocks.length === 0) return null;

  const escape = (s: string) =>
    s
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/'/g, "\\u0027");

  return (
    <Helmet>
      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json">
          {escape(JSON.stringify(block))}
        </script>
      ))}
    </Helmet>
  );
}
