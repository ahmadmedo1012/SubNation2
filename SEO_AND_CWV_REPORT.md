# SEO &amp; Core Web Vitals Report

## 1. Technical SEO

| Asset             | Implementation                                                        | Where                                                            |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `robots.txt`      | static, generated at boot from `APP_URL`                              | `backend/src/routes/seo.ts::ROBOTS_BODY`                         |
| `sitemap.xml`     | dynamic XML, 60 s in-memory cache, hreflang `ar` / `en` / `x-default` | `backend/src/routes/seo.ts::buildSitemap`                        |
| Canonical URL     | absolute, per route                                                   | `frontend/src/components/seo/MetaTags.tsx::link rel="canonical"` |
| Mobile viewport   | `width=device-width, initial-scale=1, viewport-fit=cover`             | both `index.html` and `MetaTags.tsx`                             |
| `<html lang dir>` | `ar/rtl` for Arabic routes, `en/ltr` for English                      | injected by `MetaTags.tsx` via `react-helmet-async`              |

### `sitemap.xml` freshness invariant

`backend/src/routes/admin/products.ts` calls `bumpSitemapCache()` after every
product `POST`, `PATCH`, and `DELETE`, so the next sitemap fetch rebuilds
within ≤ 60 s of the underlying change.

### `robots.txt` body (literal)

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/

Sitemap: https://subnation2.onrender.com/sitemap.xml
```

## 2. Structured data inventory

`frontend/src/lib/seo-builders.ts` provides four schema.org generators:

| Builder                    | Output type                | Applied to                                         |
| -------------------------- | -------------------------- | -------------------------------------------------- |
| `buildOrganizationLd()`    | `Organization`             | home (`/`)                                         |
| `buildProductLd(product)`  | `Product` + nested `Offer` | product detail (`/product/:id`)                    |
| `buildBreadcrumbLd(items)` | `BreadcrumbList`           | product detail                                     |
| `buildFaqLd(items)`        | `FAQPage`                  | (helper available; FAQ page wiring is a follow-up) |

### Sample: Organization LD (rendered on every page)

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "SubNation",
  "alternateName": "سَب نيشن",
  "url": "https://subnation2.onrender.com",
  "logo": "https://subnation2.onrender.com/subnation-logo.png",
  "address": { "@type": "PostalAddress", "addressCountry": "LY" },
  "description": "سوق الاشتراكات الرقمية في ليبيا — Netflix، Spotify، PS Plus، Disney+ بالدينار الليبي."
}
```

### Sample: Product LD

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://subnation2.onrender.com/product/42",
  "name": "Netflix Premium",
  "description": "Netflix Premium 1 month",
  "image": "https://…/netflix.png",
  "sku": "42",
  "brand": { "@type": "Brand", "name": "streaming" },
  "offers": {
    "@type": "Offer",
    "price": "32.00",
    "priceCurrency": "LYD",
    "url": "https://subnation2.onrender.com/product/42",
    "availability": "https://schema.org/InStock"
  }
}
```

## 3. Social SEO

| Tag family   | Coverage                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenGraph    | `og:title`, `og:description`, `og:type`, `og:url`, `og:image`, `og:locale`, `og:locale:alternate`, `og:site_name` — all rendered by `MetaTags.tsx` |
| Twitter Card | `twitter:card="summary_large_image"`, `twitter:title`, `twitter:description`, `twitter:image`                                                      |

`og:image` defaults to `/subnation-logo.png` per route until per-route hero
images are added.

## 4. Arabic SEO &amp; RTL

`MetaTags.tsx` toggles `<html lang dir>`, `og:locale`, `og:locale:alternate`
based on `locale: "ar" | "en"`. The current routing applies `useSeo({locale: "ar"})`
(home, product) — English locale support is staged for the next phase when
the i18n switcher lands.

## 5. Core Web Vitals

### Frontend collection

`frontend/src/lib/web-vitals.ts` (web-vitals **v4** API: `onCLS / onFCP /
onINP / onLCP / onTTFB`). Each sample is enriched with route, viewport
class (`mobile` if `innerWidth ≤ 768`, else `desktop`), connection type,
and a UUID v4 sessionId stored in `sessionStorage`. Beacons are sent via
`navigator.sendBeacon` with a `fetch keepalive` fallback, retried twice with
≥ 5 s spacing, and flushed on `visibilitychange` and `pagehide`.

Initialisation: `frontend/src/main.tsx` calls `initWebVitals()` inside
`requestIdleCallback` (fallback `setTimeout(0)`) so first paint is never
delayed by CWV setup.

### Backend ingestion

`POST /api/cwv` (`backend/src/routes/cwv.ts`) validates with a hand-rolled
type-guard, applies a per-session 30 / minute in-memory cap, observes
`cwv_sample_value{name,route,viewport}` and increments
`cwv_samples_total{name,route,viewport}`, emits a `category:"cwv"` Pino line,
returns `204`.

### Bundle budget

`frontend/vite.config.ts::bundleBudgetPlugin` runs at `closeBundle`:

- `>56,320` bytes gzip (55 KiB) on the main `index-*.js` entry → **fail
  build**.
- `>47,120` and `≤56,320` → warn.
- `≤47,120` → silent OK.

Latest measured size (this session): **21,729 bytes gzip** → silent OK.

### Lighthouse CI &amp; image / font optimisation

- `lighthouserc.cjs` is **not yet** in the repo. Phase 4 task 31 is
  P2-pending: it requires a deployable URL or a local Chromium runner.
- `fetchpriority="high"` + AVIF/WebP `<picture>` on the LCP image, and
  `loading="lazy"` on below-the-fold images, are P2-pending: they require
  re-encoded asset binaries that are not yet in the repo.
- `font-display: swap` on the critical font is in `index.html` already
  (`Readex Pro` via Google Fonts `&display=swap`).

### Live targets (R4.3)

| Metric | Mobile p75 | Desktop p75 |
| ------ | ---------- | ----------- |
| LCP    | ≤ 2.5 s    | ≤ 2.0 s     |
| FCP    | ≤ 1.8 s    | ≤ 1.2 s     |
| INP    | ≤ 200 ms   | ≤ 200 ms    |
| CLS    | ≤ 0.1      | ≤ 0.1       |

Pre-initiative baselines (from `web-check-report.md`): FCP 2.9 s, LCP 3.3 s,
CLS 0.125, total transfer 441,580 B. The baselines do not yet include the
new instrumentation; re-run Lighthouse against the deployed URL after
`VITE_SENTRY_DSN` and `VITE_RELEASE_SHA` are provisioned.

## 6. Trusted Types &amp; CSP preservation

`MetaTags.tsx` and `JsonLd.tsx` only emit `<meta>`, `<link>`, `<title>`, and
`<script type="application/ld+json">` (data, not script — CSP-safe).
HTML-escaping is applied to JSON-LD payloads to defuse any future
user-supplied field. The pre-existing `init.js` Trusted Types extraction is
unchanged.

## 7. Validation gate (after Phase 4 / 5 ships)

- Lighthouse SEO **= 100** on home, product list, product detail, FAQ
  (mobile + desktop).
- Lighthouse Performance **≥ 90 mobile**, **≥ 98 desktop** (median of 3
  runs).
- `robots.txt` and `sitemap.xml` reachable over HTTPS; sitemap passes XML
  schema validation.
- Arabic page returns `dir="rtl"`, `lang="ar"`, `og:locale="ar_LY"`.
- All four JSON-LD payloads validate cleanly in Google Rich Results Test /
  schema.org validator.
