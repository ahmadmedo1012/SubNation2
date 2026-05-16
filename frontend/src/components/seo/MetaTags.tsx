import { type ReactElement } from "react";
import { Helmet } from "react-helmet-async";

export interface SeoInput {
  /** ≤ 60 chars title shown in `<title>` and og:title */
  title: string;
  /** 120-160 chars description for meta description and og:description */
  description: string;
  /** Absolute or relative URL of the canonical image (1200×630 PNG ideal) */
  image?: string;
  /** OpenGraph type — defaults to "website"; "product" for product detail */
  type?: "website" | "product" | "article";
  /** Public path for canonical link, e.g. "/" or "/product/42" */
  path: string;
  /** Locale code: "ar" forces dir=rtl + og:locale=ar_LY */
  locale?: "ar" | "en";
  /** Optional robots directive override */
  robots?: string;
  /** Optional JSON-LD blocks rendered by JsonLd component */
  jsonLd?: object[];
}

const DEFAULT_IMAGE = "/subnation-logo.png";

function getAppOrigin(): string {
  // Vite-injected build-time origin, falling back to runtime origin.
  const fromEnv = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location) return window.location.origin;
  return "https://subnation.ly";
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)).trim() + "…";
}

/**
 * Renders the canonical SEO `<head>` block for a route.
 *
 * Trusted Types policy: this component never renders an inline `<script>` —
 * only `<meta>`, `<link>`, `<title>`, and `<html>` attribute mutations through
 * react-helmet-async, which is CSP-safe.
 */
export function MetaTags(input: Omit<SeoInput, "jsonLd">): ReactElement {
  const origin = getAppOrigin();
  const url = `${origin}${input.path.startsWith("/") ? input.path : "/" + input.path}`;
  const image = input.image ?? `${origin}${DEFAULT_IMAGE}`;
  const lang = input.locale ?? "ar";
  const dir = lang === "ar" ? "rtl" : "ltr";
  const ogLocale = lang === "ar" ? "ar_LY" : "en_US";
  const ogLocaleAlt = lang === "ar" ? "en_US" : "ar_LY";
  const title = clamp(input.title.trim(), 60);
  const description = clamp(input.description.trim(), 160);

  return (
    <Helmet>
      {/*
        NOTE: We intentionally do NOT declare `<html lang dir>` here.
        react-helmet-async strips attributes it declared on unmount,
        which caused the document direction to flip on every route
        change that left a SEO-aware page. Document direction is now
        locked once at App boot via `lib/direction.ts`. The static
        `<html lang="ar" dir="rtl">` from index.html provides the
        baseline; the boot effect re-confirms it.
      */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#5c7cfa" />
      <meta name="robots" content={input.robots ?? "index,follow"} />
      <link rel="canonical" href={url} />

      {/* OpenGraph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={input.type ?? "website"} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:locale" content={ogLocale} />
      <meta property="og:locale:alternate" content={ogLocaleAlt} />
      <meta property="og:site_name" content="SubNation" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
}
