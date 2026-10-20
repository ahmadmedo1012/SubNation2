/**
 * R177 (RH-55): the category shell's initial HTML carries a real
 * BreadcrumbList + CollectionPage pair — not zero JSON-LD.
 *
 * Pure injector tests (no DB): the route-level wiring is pinned in
 * spa-shell-rewrite.test.ts's /category/vpn case.
 */
import { describe, expect, it } from "vitest";
import {
  buildCategoryBreadcrumbLd,
  buildCategoryCollectionLd,
  buildCategoryJsonLd,
} from "../lib/shell-category-ld";
import { injectSeoNav } from "../lib/shell-seo-nav";

const ORIGIN = "https://subnation.ly";
const SHELL = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>stub</title>
<link rel="canonical" href="${ORIGIN}/">
</head>
<body><div id="root">shell</div></body>
</html>`;

function blocks(html: string): Array<Record<string, unknown>> {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  return [...html.matchAll(re)].map((m) => JSON.parse(m[1] as string));
}

describe("category shell JSON-LD (RH-55)", () => {
  it("emits BreadcrumbList + CollectionPage for a live category", () => {
    const html = injectSeoNav(SHELL, {
      status: 200,
      canonical: `${ORIGIN}/category/streaming`,
    });
    const ld = blocks(html);
    expect(ld).toHaveLength(2);

    const breadcrumb = ld.find((b) => b["@type"] === "BreadcrumbList");
    const collection = ld.find((b) => b["@type"] === "CollectionPage");
    expect(breadcrumb).toBeTruthy();
    expect(collection).toBeTruthy();

    const crumbUrl = `${ORIGIN}/category/streaming`;
    expect(breadcrumb?.["@id"]).toBe(`${crumbUrl}#breadcrumb`);
    const items = breadcrumb?.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0]?.item).toBe(`${ORIGIN}/`);
    expect(items[1]?.item).toBe(crumbUrl);

    expect(collection?.url).toBe(crumbUrl);
    expect(collection?.["@id"]).toBe(`${crumbUrl}#webpage`);
    expect(collection?.name).toBe("اشتراكات منصات المشاهدة في ليبيا");
    expect(collection?.description).toContain("Netflix");
    expect(collection?.inLanguage).toBe("ar");
    expect(collection?.isPartOf).toEqual({ "@id": `${ORIGIN}/#website` });
    expect(collection?.breadcrumb).toEqual({ "@id": `${crumbUrl}#breadcrumb` });
  });

  it("keeps the no-JS H1/nav intact beside the JSON-LD", () => {
    const html = injectSeoNav(SHELL, {
      status: 200,
      canonical: `${ORIGIN}/category/vpn`,
    });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("اشتراكات VPN في ليبيا");
    expect(html).toContain('data-seo-nav="1"');
    expect(html.match(/<a\b/g)).toHaveLength(11);
  });

  it("is idempotent (no duplicate JSON-LD or nav on a second call)", () => {
    const meta = {
      status: 200,
      canonical: `${ORIGIN}/category/music`,
    };
    const once = injectSeoNav(SHELL, meta);
    const twice = injectSeoNav(once, meta);
    expect(blocks(twice)).toHaveLength(2);
    expect(twice.match(/data-seo-nav="1"/g)).toHaveLength(1);
    expect(twice.match(/<h1\b/g)).toHaveLength(1);
  });

  it("adds nothing on the home/product surfaces or a 404 category", () => {
    expect(blocks(injectSeoNav(SHELL, { status: 200, canonical: `${ORIGIN}/` }))).toHaveLength(0);
    expect(
      blocks(
        injectSeoNav(SHELL, {
          status: 200,
          canonical: `${ORIGIN}/product/netflix-premium`,
          jsonLd: JSON.stringify({ "@type": "Product", name: "Netflix" }),
        }),
      ),
    ).toHaveLength(0);
    expect(
      blocks(
        injectSeoNav(SHELL, {
          status: 404,
          canonical: null,
          robots: "noindex,follow",
        }),
      ),
    ).toHaveLength(0);
  });

  it("returns null for an unknown/retired category slug", () => {
    expect(buildCategoryJsonLd(ORIGIN, "gaming")).toBeNull();
    expect(buildCategoryBreadcrumbLd(ORIGIN, "gaming")).toBeNull();
    expect(buildCategoryCollectionLd(ORIGIN, "gaming")).toBeNull();
  });
});
