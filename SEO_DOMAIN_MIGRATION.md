# SEO Domain Migration

Search-engine-facing changes for the `subnation2.onrender.com → subnation.ly`
migration. Pair with `DOMAIN_MIGRATION_REPORT.md` for code-level detail.

## 1. Canonical signals — every page tells crawlers `subnation.ly` is the truth

| Signal | Where emitted | What it now says |
|---|---|---|
| `<link rel="canonical">` | `frontend/src/components/seo/MetaTags.tsx` | always `https://subnation.ly/...` |
| `og:url` | same | `https://subnation.ly/...` |
| `twitter:url` (via `og:url` fallback) | same | `https://subnation.ly/...` |
| `og:locale` | same | `ar_LY` (Arabic routes) / `en_US` (English) |
| JSON-LD `Organization.url` | `frontend/src/lib/seo-builders.ts::buildOrganizationLd` | `https://subnation.ly` |
| JSON-LD `Product.@id` + `offers.url` | `buildProductLd` | `https://subnation.ly/product/<id>` |
| JSON-LD `BreadcrumbList.itemListElement[].item` | `buildBreadcrumbLd` | `https://subnation.ly/...` |

Every page emits the canonical regardless of which host the request hit, so
even a crawler that lands on `subnation2.onrender.com` (or `www.subnation.ly`)
sees the canonical URL pointing at the apex — and follows the 301 anyway.

## 2. 301 redirects — Google's site-move guidance compliance

Per [Google Search Central — Site move with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes):

> If you're permanently moving to a new domain or subdomain, use 301
> redirects to tell search engines and users that the new URLs are the
> definitive ones.

We do exactly that:

- `301 https://subnation2.onrender.com/<path>` → `https://subnation.ly/<path>`
- `301 https://www.subnation.ly/<path>` → `https://subnation.ly/<path>`
- Skipped: `/api/healthz/*` (so Render's health probe doesn't get a 301)

The redirect carries `Cache-Control: max-age=86400` so browsers and proxies
cache the redirect for a day, smoothing the transition.

## 3. `robots.txt` — single canonical sitemap reference

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/

Sitemap: https://subnation.ly/sitemap.xml
```

Both backend `/robots.txt` and the static SPA fallback reference the canonical
sitemap. The sitemap URL itself returns the dynamic XML built from
`backend/src/routes/seo.ts::buildSitemap`.

## 4. `sitemap.xml` — every `<loc>` uses canonical

Dynamic sitemap (`backend/src/routes/seo.ts`):

```xml
<url>
  <loc>https://subnation.ly/</loc>
  <lastmod>...</lastmod>
  <changefreq>daily</changefreq>
  <priority>1.0</priority>
  <xhtml:link rel="alternate" hreflang="ar" href="https://subnation.ly/" />
  <xhtml:link rel="alternate" hreflang="en" href="https://subnation.ly/" />
  <xhtml:link rel="alternate" hreflang="x-default" href="https://subnation.ly/" />
</url>
```

The `bumpSitemapCache()` invalidator continues to work — every product
create / update / delete forces the next sitemap fetch to rebuild with the
freshest `lastmod`.

## 5. JSON-LD structured data — sample emitted on `https://subnation.ly/`

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "SubNation",
  "alternateName": "سَب نيشن",
  "url": "https://subnation.ly",
  "logo": "https://subnation.ly/subnation-logo.png",
  "address": { "@type": "PostalAddress", "addressCountry": "LY" },
  "description": "سوق الاشتراكات الرقمية في ليبيا — Netflix، Spotify، PS Plus، Disney+ بالدينار الليبي."
}
```

Same pattern for `Product`, `BreadcrumbList`, `FAQPage` — every URL inside
the LD points at `subnation.ly`.

## 6. Hreflang — both Arabic and English on every page

The dynamic sitemap emits `<xhtml:link rel="alternate">` for `ar`, `en`,
and `x-default` on every URL. Combined with `<html lang="ar" dir="rtl">`
on Arabic routes (set by `MetaTags.tsx`), Google can serve the right
language to the right region.

## 7. What to do in Google Search Console after the migration

1. Verify the new property `subnation.ly` (DNS TXT or HTML file).
2. Open **Settings → Change of address** on the old `subnation2.onrender.com`
   property.
3. Select the new property and submit.
4. Submit the new sitemap: `https://subnation.ly/sitemap.xml`.
5. Use **URL inspection** to manually re-crawl key pages (home, top
   products, FAQ).

Google typically takes 7–30 days to fully re-index a moved site. The 301
redirects + canonical tags do the heavy lifting; this Console step just
hints to Google to prioritise the move.

## 8. What you do NOT need to do

- ❌ Don't delete the legacy `subnation2.onrender.com` domain from Render
  yet. Leaving it alive is what makes the 301 redirect possible — once you
  remove it, requests get a connection-refused / DNS error instead of a
  graceful redirect, which actively hurts SEO.
- ❌ Don't add `noindex` on the legacy host. The 301 is a stronger signal
  than `noindex` and combines with the canonical tag.
- ❌ Don't manually rewrite indexed URLs in third-party links. Google
  follows the 301 and updates its index automatically.

## 9. Verification recipes

```bash
# 1. Canonical URL on the home page
curl -s https://subnation.ly/ | grep -i 'rel="canonical"' | head -1
# expect: <link rel="canonical" href="https://subnation.ly">

# 2. Redirect from legacy host preserves the path
curl -sI https://subnation2.onrender.com/product/42 | head -5
# expect: HTTP/2 301
# expect: location: https://subnation.ly/product/42

# 3. Sitemap returns canonical URLs
curl -s https://subnation.ly/sitemap.xml | grep '<loc>' | head -5
# expect: each <loc> starts with https://subnation.ly

# 4. robots.txt points at canonical sitemap
curl -s https://subnation.ly/robots.txt
# expect: Sitemap: https://subnation.ly/sitemap.xml

# 5. Arabic page sets dir="rtl"
curl -s https://subnation.ly/ | grep -i '<html ' | head -1
# expect: <html lang="ar" dir="rtl">

# 6. Google Rich Results Test (manual)
# Paste a product URL into https://search.google.com/test/rich-results
# expect: Product schema valid, no errors
```

## 10. Lighthouse SEO targets (post-migration)

The Phase-4 / Phase-5 spec targets remain:

- Lighthouse SEO = 100 on home, product list, product detail, FAQ
  (mobile + desktop).
- Lighthouse Performance ≥ 90 mobile, ≥ 98 desktop (median of 3 runs).

Run against `https://subnation.ly/` (not the legacy host).
